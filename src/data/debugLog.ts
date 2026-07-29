export type ExplorerLogLevel = "debug" | "info" | "warn" | "error";

export interface ExplorerLogEntry {
  id: string;
  timestamp: string;
  level: ExplorerLogLevel;
  scope: string;
  message: string;
  details?: Record<string, unknown>;
}

type LogListener = (entries: ExplorerLogEntry[]) => void;
type ExplorerOperationOutcome = "ok" | "error" | "cancelled";

interface ExplorerOperationFinish {
  outcome: ExplorerOperationOutcome;
  level?: ExplorerLogLevel;
  httpStatus?: number | null;
  error?: unknown;
  details?: Record<string, unknown>;
}

interface FetchLoggingState {
  originalFetch: typeof fetch;
  wrappedFetch: typeof fetch;
  origins: Set<string>;
}

const MAX_ENTRIES = 300;
const REDACTED = "[redacted]";
const FETCH_LOGGING_STATE_KEY = "__tinycloudExplorerFetchLogging__";
const sensitiveKey =
  /authorization|bearer|cookie|credential|private.?key|secret|signature|siwe|token|value/i;
const listeners = new Set<LogListener>();
let entries: ExplorerLogEntry[] = [];
let sequence = 0;
let operationSequence = 0;

function redact(value: unknown, key = "", depth = 0): unknown {
  if (sensitiveKey.test(key)) return REDACTED;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, "", depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, item]) => [
        nestedKey,
        redact(item, nestedKey, depth + 1),
      ]),
    );
  }
  if (typeof value === "string") {
    if (
      value.includes("wants you to sign in with your Ethereum account") ||
      value.startsWith("urn:recap:")
    ) {
      return REDACTED;
    }
    const cleaned = value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, `Bearer ${REDACTED}`)
      .replace(
        /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        REDACTED,
      )
      .replace(/\b0x[a-fA-F0-9]{128,}\b/g, REDACTED);
    return cleaned.length > 1_000 ? `${cleaned.slice(0, 1_000)}…` : cleaned;
  }
  return value;
}

function publish() {
  const snapshot = getExplorerLogs();
  for (const listener of listeners) listener(snapshot);
}

export function explorerLog(
  level: ExplorerLogLevel,
  scope: string,
  message: string,
  details?: Record<string, unknown>,
) {
  const entry: ExplorerLogEntry = {
    id: `log-${Date.now()}-${sequence++}`,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(details ? { details: redact(details) as Record<string, unknown> } : {}),
  };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  publish();

  const consoleMethod =
    level === "debug" ? console.debug : level === "warn" ? console.warn : level === "error" ? console.error : console.info;
  consoleMethod(`[TinyCloud Explorer] ${scope}: ${message}`, entry.details ?? "");
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function elapsedMilliseconds(started: number): number {
  return Math.max(0, Math.round((monotonicNow() - started) * 10) / 10);
}

export function httpStatusFrom(error: unknown): number | undefined {
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number): number | undefined => {
    if (depth > 5 || value === null || value === undefined) return undefined;
    if (typeof value === "string") {
      const match =
        value.match(/\bHTTP\s+([1-5]\d{2})\b/i) ??
        value.match(/(?:^|[\s:])([1-5]\d{2})\s+-\s+/);
      return match ? Number(match[1]) : undefined;
    }
    if (typeof value !== "object") return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);

    const object = value as Record<string, unknown>;
    for (const key of ["status", "statusCode", "httpStatus"]) {
      const status = Number(object[key]);
      if (Number.isInteger(status) && status >= 100 && status <= 599) {
        return status;
      }
    }
    for (const key of ["message", "response", "error", "cause", "details"]) {
      const status = visit(object[key], depth + 1);
      if (status !== undefined) return status;
    }
    return undefined;
  };

  return visit(error, 0);
}

export function startExplorerOperation(
  scope: string,
  label: string,
  details?: Record<string, unknown>,
): (finish: ExplorerOperationFinish) => void {
  const operationId = `operation-${Date.now()}-${operationSequence++}`;
  const startedAt = new Date().toISOString();
  const started = monotonicNow();
  let finished = false;

  explorerLog("debug", scope, `${label} started`, {
    ...details,
    operationId,
    phase: "start",
    startedAt,
  });

  return ({
    outcome,
    level = outcome === "ok" ? "info" : "error",
    httpStatus,
    error,
    details: finishDetails,
  }) => {
    if (finished) return;
    finished = true;
    const stoppedAt = new Date().toISOString();
    const elapsedMs = elapsedMilliseconds(started);
    const resolvedStatus = httpStatus ?? httpStatusFrom(error) ?? null;
    const statusLabel =
      resolvedStatus === null ? "" : ` · HTTP ${resolvedStatus}`;

    explorerLog(
      level,
      scope,
      `${label} ${outcome === "ok" ? "completed" : outcome}${statusLabel} · ${elapsedMs} ms`,
      {
        ...details,
        ...finishDetails,
        operationId,
        phase: "stop",
        outcome,
        startedAt,
        stoppedAt,
        elapsedMs,
        httpStatus: resolvedStatus,
      },
    );
  };
}

function fetchUrl(input: RequestInfo | URL): URL | null {
  try {
    const value =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new URL(
      value,
      typeof location === "undefined" ? undefined : location.href,
    );
  } catch {
    return null;
  }
}

export function installExplorerHttpLogging(origins: string[]): () => void {
  const loggingGlobal = globalThis as typeof globalThis & {
    [FETCH_LOGGING_STATE_KEY]?: FetchLoggingState;
  };
  const resolvedOrigins = origins.flatMap((origin) => {
    try {
      return [new URL(origin).origin];
    } catch {
      return [];
    }
  });
  const existing = loggingGlobal[FETCH_LOGGING_STATE_KEY];
  if (existing) {
    for (const origin of resolvedOrigins) existing.origins.add(origin);
    return () => undefined;
  }
  if (typeof globalThis.fetch !== "function") return () => undefined;

  const originalFetch = globalThis.fetch.bind(globalThis);
  const allowedOrigins = new Set(resolvedOrigins);
  const wrappedFetch: typeof fetch = async (input, init) => {
    const url = fetchUrl(input);
    if (!url || !allowedOrigins.has(url.origin)) {
      return originalFetch(input, init);
    }

    const method = (
      init?.method ??
      (typeof Request !== "undefined" && input instanceof Request
        ? input.method
        : "GET")
    ).toUpperCase();
    const requestUrl = `${url.origin}${url.pathname}`;
    const finish = startExplorerOperation(
      "http",
      `${method} ${url.pathname}`,
      { method, url: requestUrl },
    );

    try {
      const response = await originalFetch(input, init);
      finish({
        outcome: response.ok ? "ok" : "error",
        level: response.ok ? "info" : "error",
        httpStatus: response.status,
        details: {
          responseType: response.type,
        },
      });
      return response;
    } catch (error) {
      finish({
        outcome:
          error instanceof DOMException && error.name === "AbortError"
            ? "cancelled"
            : "error",
        error,
        details: {
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  };

  const state: FetchLoggingState = {
    originalFetch,
    wrappedFetch,
    origins: allowedOrigins,
  };
  loggingGlobal[FETCH_LOGGING_STATE_KEY] = state;
  globalThis.fetch = wrappedFetch;

  return () => {
    if (
      loggingGlobal[FETCH_LOGGING_STATE_KEY] === state &&
      globalThis.fetch === wrappedFetch
    ) {
      globalThis.fetch = originalFetch;
      delete loggingGlobal[FETCH_LOGGING_STATE_KEY];
    }
  };
}

export function getExplorerLogs(): ExplorerLogEntry[] {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.details ? { details: structuredClone(entry.details) } : {}),
  }));
}

export function subscribeExplorerLogs(listener: LogListener): () => void {
  listeners.add(listener);
  listener(getExplorerLogs());
  return () => listeners.delete(listener);
}

export function clearExplorerLogs() {
  entries = [];
  publish();
}

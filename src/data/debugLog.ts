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

const MAX_ENTRIES = 300;
const REDACTED = "[redacted]";
const sensitiveKey =
  /authorization|bearer|cookie|credential|private.?key|secret|signature|siwe|token|value/i;
const listeners = new Set<LogListener>();
let entries: ExplorerLogEntry[] = [];
let sequence = 0;

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

// One Apps embed contract v1 (child side). When TinyCloud One frames Explorer
// with `?embed=one`, Explorer receives a silent delegation from One over
// postMessage instead of opening the OpenKey popup. Outside that case none of
// this runs and Explorer behaves as before.
import type { PermissionEntry } from "@tinycloud/web-sdk";
import {
  ONE_DEV_ORIGIN,
  ONE_NATIVE_ORIGINS,
  ONE_PREVIEW_ORIGIN,
  ONE_PRODUCTION_ORIGIN,
} from "./framing";

export const EMBED_VERSION = 1;
export const EXPLORER_APP_ID = "xyz.tinycloud.explorer";

function oneOriginsForThisBuild(): readonly string[] {
  // Inline `import.meta.env` conditions so Vite folds them and the preview/dev
  // origins are absent from production bundles. Unset or any other kind of
  // VITE_EXPLORER_BUILD_KIND is production.
  const origins: string[] = [ONE_PRODUCTION_ORIGIN, ...ONE_NATIVE_ORIGINS];
  if (import.meta.env.VITE_EXPLORER_BUILD_KIND === "preview") {
    origins.push(ONE_PREVIEW_ORIGIN);
  }
  if (import.meta.env.DEV) origins.push(ONE_DEV_ORIGIN);
  return origins;
}

/** One origins this build accepts. Exact match only: no patterns, no wildcards. */
export const ONE_ORIGINS: readonly string[] = oneOriginsForThisBuild();

export function isOneOrigin(
  origin: unknown,
  origins: readonly string[] = ONE_ORIGINS,
): origin is string {
  return typeof origin === "string" && origins.includes(origin);
}

/** Origin of a referrer URL, or null when it is empty or not a URL. */
export function originOf(url: string): string | null {
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export interface EmbedEnvironment {
  isFramed: boolean;
  search: string;
  referrer: string;
  /** The direct parent's origin from `location.ancestorOrigins`, where the browser has it. */
  ancestorOrigin?: string;
}

/**
 * Parent origin if Explorer must run embedded: framed, `embed=one`, and the
 * parent is one of One's. The referrer names the parent; when it is empty (One's
 * iOS app: WebKit sends no referrer from its `capacitor://` or `tinycloudone://`
 * page, and such a URL has no origin to parse) the browser's own
 * `ancestorOrigins` entry does, matched as an exact string. Anything else
 * returns null (normal flow).
 */
export function resolveOneParentOrigin(
  env: EmbedEnvironment,
  origins: readonly string[] = ONE_ORIGINS,
): string | null {
  if (!env.isFramed) return null;
  if (new URLSearchParams(env.search).get("embed") !== "one") return null;
  const origin = env.referrer ? originOf(env.referrer) : (env.ancestorOrigin ?? null);
  return origin !== null && isOneOrigin(origin, origins) ? origin : null;
}

export function readEmbedEnvironment(win: Window, doc: Document): EmbedEnvironment {
  return {
    isFramed: win.parent !== win,
    search: win.location.search,
    referrer: doc.referrer,
    ancestorOrigin: win.location.ancestorOrigins?.[0],
  };
}

export type EmbedTheme = "light" | "dark";

/** One delegation per space; `delegation` is `serializeDelegation` output. */
export interface SpaceGrant {
  spaceId: string;
  delegation: string;
  cid: string;
}

export interface EmbedGrant {
  nonce: string;
  grants: SpaceGrant[];
  /** Epoch ms. */
  expiresAt: number;
  theme: EmbedTheme;
}

export type EmbedRequestResult =
  | { kind: "grant"; grant: EmbedGrant }
  | { kind: "denied" }
  | { kind: "revoked" };

type ParentMessage =
  | ({ type: "tc-embed/grant" } & EmbedGrant)
  | { type: "tc-embed/denied"; nonce: string }
  | { type: "tc-embed/revoke" }
  | { type: "tc-embed/theme"; theme: EmbedTheme };

function isTheme(value: unknown): value is EmbedTheme {
  return value === "light" || value === "dark";
}

export function parseParentMessage(data: unknown): ParentMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.v !== EMBED_VERSION) return null;
  switch (m.type) {
    case "tc-embed/grant":
      if (
        typeof m.nonce !== "string" ||
        !Array.isArray(m.grants) ||
        typeof m.expiresAt !== "number" ||
        // Epoch milliseconds; a seconds value would read as 1970 and re-hello in a loop.
        !(m.expiresAt > 1e11 && Number.isFinite(m.expiresAt)) ||
        !isTheme(m.theme)
      ) {
        return null;
      }
      {
        const grants: SpaceGrant[] = [];
        for (const entry of m.grants as unknown[]) {
          const g = entry as Record<string, unknown> | null;
          if (
            !g ||
            typeof g !== "object" ||
            typeof g.spaceId !== "string" ||
            typeof g.cid !== "string" ||
            typeof g.delegation !== "string" ||
            g.delegation === ""
          ) {
            return null;
          }
          grants.push({ spaceId: g.spaceId, delegation: g.delegation, cid: g.cid });
        }
        return {
          type: "tc-embed/grant",
          nonce: m.nonce,
          grants,
          expiresAt: m.expiresAt,
          theme: m.theme,
        };
      }
    case "tc-embed/denied":
      return typeof m.nonce === "string"
        ? { type: "tc-embed/denied", nonce: m.nonce }
        : null;
    case "tc-embed/revoke":
      return { type: "tc-embed/revoke" };
    case "tc-embed/theme":
      return isTheme(m.theme) ? { type: "tc-embed/theme", theme: m.theme } : null;
    default:
      return null;
  }
}

export function randomNonce(
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => {
    crypto.getRandomValues(bytes);
  },
): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Child re-sends hello this long before the grant expires so One can re-grant. */
export const REGRANT_LEAD_MS = 6 * 60 * 1000;

export interface OneEmbedControllerOptions {
  /** The frame's window; `win.parent` is the only accepted sender. */
  win: Window;
  /** Validated parent origin from `resolveOneParentOrigin`. */
  parentOrigin: string;
  /** Accepted One origins; defaults to this build's list. */
  origins?: readonly string[];
  appId: string;
  /** The child's in-memory session key DID (`did:key:z6Mk…`); never persisted. */
  sessionDid: string;
  onGrant: (grant: EmbedGrant) => void;
  onRevoke: () => void;
  onTheme?: (theme: EmbedTheme) => void;
  /** A denial for the hello (not for a request, which resolves its promise). */
  onDenied?: () => void;
  now?: () => number;
  nonce?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface OneEmbedController {
  start(): void;
  /** Re-send hello after start(), e.g. when One stayed silent the first time. */
  repeatHello(): void;
  stop(): void;
  /** Ask One for more access; resolves on grant, denied or revoke. */
  request(permissions: PermissionEntry[]): Promise<EmbedRequestResult>;
}

interface PendingRequest {
  nonce: string;
  resolve: (result: EmbedRequestResult) => void;
}

export function createOneEmbedController(
  options: OneEmbedControllerOptions,
): OneEmbedController {
  const {
    win,
    parentOrigin,
    appId,
    sessionDid,
    onGrant,
    onRevoke,
    onTheme,
    onDenied,
  } = options;
  const now = options.now ?? Date.now;
  const newNonce = options.nonce ?? (() => randomNonce());
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

  if (!isOneOrigin(parentOrigin, options.origins)) {
    throw new Error("OneEmbed: parent origin is not a One origin");
  }

  let started = false;
  let latestNonce: string | null = null;
  let pending: PendingRequest | null = null;
  let refreshTimer: unknown = null;

  const post = (message: Record<string, unknown>) => {
    win.parent.postMessage({ v: EMBED_VERSION, ...message }, parentOrigin);
  };

  const clearRefresh = () => {
    if (refreshTimer !== null) clearTimer(refreshTimer);
    refreshTimer = null;
  };

  const settle = (result: EmbedRequestResult) => {
    const current = pending;
    pending = null;
    current?.resolve(result);
  };

  const hello = () => {
    latestNonce = newNonce();
    post({ type: "tc-embed/hello", appId, sessionDid, nonce: latestNonce });
  };

  const scheduleRefresh = (expiresAt: number) => {
    clearRefresh();
    const delay = Math.max(0, expiresAt - REGRANT_LEAD_MS - now());
    refreshTimer = setTimer(() => {
      refreshTimer = null;
      // A pending request already carries the nonce One will answer.
      if (started && pending === null) hello();
    }, delay);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent) return;
    if (event.origin !== parentOrigin) return;
    const message = parseParentMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case "tc-embed/grant": {
        if (latestNonce === null || message.nonce !== latestNonce) return;
        const grant: EmbedGrant = {
          nonce: message.nonce,
          grants: message.grants,
          expiresAt: message.expiresAt,
          theme: message.theme,
        };
        onGrant(grant);
        scheduleRefresh(grant.expiresAt);
        if (pending && pending.nonce === message.nonce) {
          settle({ kind: "grant", grant });
        }
        return;
      }
      case "tc-embed/denied": {
        if (latestNonce === null || message.nonce !== latestNonce) return;
        if (pending && pending.nonce === message.nonce) {
          settle({ kind: "denied" });
        } else {
          onDenied?.();
        }
        return;
      }
      case "tc-embed/revoke": {
        latestNonce = null;
        clearRefresh();
        settle({ kind: "revoked" });
        onRevoke();
        return;
      }
      case "tc-embed/theme": {
        onTheme?.(message.theme);
        return;
      }
    }
  };

  return {
    /** Repeat hello (same session DID, fresh nonce): asks One again for a grant. */
    repeatHello() {
      if (started) hello();
    },
    start() {
      if (started) return;
      started = true;
      win.addEventListener("message", onMessage);
      hello();
    },
    stop() {
      if (!started) return;
      started = false;
      win.removeEventListener("message", onMessage);
      clearRefresh();
      latestNonce = null;
      settle({ kind: "revoked" });
    },
    request(permissions) {
      if (!started) return Promise.resolve({ kind: "revoked" });
      settle({ kind: "denied" });
      const nonce = newNonce();
      latestNonce = nonce;
      return new Promise<EmbedRequestResult>((resolve) => {
        pending = { nonce, resolve };
        post({ type: "tc-embed/request", nonce, permissions });
      });
    },
  };
}

// Build-kind-dependent One origins and the framing header. Pure and free of
// `import.meta.env` so vite.config.ts can import it in Node. The browser side
// (oneEmbed.ts) picks its list with inline `import.meta.env` conditions so the
// preview/dev origins are compiled out of production bundles.

/** The one production One origin. */
export const ONE_PRODUCTION_ORIGIN = "https://tinycloud.one";
/** Preview builds only. */
export const ONE_PREVIEW_ORIGIN = "https://feat-one-apps.tinychat.pages.dev";
/** Dev builds only (mkcert https). */
export const ONE_DEV_ORIGIN = "https://localhost:5190";
/**
 * One's phone app (Capacitor's default WebView origins): iOS, then Android. Production list, exact strings only: no
 * other scheme, port or host.
 */
export const ONE_NATIVE_ORIGINS: readonly string[] = ["capacitor://localhost", "https://localhost"];

/** Env signal that selects a preview build. Anything else is production (fail closed). */
export const BUILD_KIND_ENV = "VITE_EXPLORER_BUILD_KIND";

export type BuildKind = "production" | "preview";

export function buildKindFromEnv(value: string | undefined): BuildKind {
  return value === "preview" ? "preview" : "production";
}

export function frameAncestorsFor(kind: BuildKind): string[] {
  return kind === "preview"
    ? [ONE_PRODUCTION_ORIGIN, ...ONE_NATIVE_ORIGINS, ONE_PREVIEW_ORIGIN]
    : [ONE_PRODUCTION_ORIGIN, ...ONE_NATIVE_ORIGINS];
}

/**
 * Cloudflare Pages `_headers`. Explorer is an SPA with a fallback, so every
 * HTML route a user can reach inside the frame is served by index.html: the
 * One policy goes on `/*`.
 */
export function headersFileFor(kind: BuildKind): string {
  const csp = `Content-Security-Policy: frame-ancestors ${frameAncestorsFor(kind).join(" ")}`;
  return `/*\n  ${csp}\n`;
}

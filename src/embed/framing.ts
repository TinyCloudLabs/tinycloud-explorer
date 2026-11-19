// Build-kind-dependent One origins and the framing header. Pure and free of
// `import.meta.env` so vite.config.ts can import it in Node. The browser side
// (oneEmbed.ts) picks its list with inline `import.meta.env` conditions so the
// preview/dev origins are compiled out of production bundles.

/** The one production One origin. tinycloud.chat 302s here; home.tinycloud.xyz is legacy and not listed. */
export const ONE_PRODUCTION_ORIGIN = "https://tinycloud.one";
/** Preview builds only. Anyone who can push a tinychat branch controls this origin. */
export const ONE_PREVIEW_ORIGIN = "https://feat-one-apps.tinychat.pages.dev";
/** Dev builds only (mkcert https). */
export const ONE_DEV_ORIGIN = "https://localhost:5186";

/** Env signal that selects a preview build. Anything else is production (fail closed). */
export const BUILD_KIND_ENV = "VITE_EXPLORER_BUILD_KIND";

export type BuildKind = "production" | "preview";

export function buildKindFromEnv(value: string | undefined): BuildKind {
  return value === "preview" ? "preview" : "production";
}

export function frameAncestorsFor(kind: BuildKind): string[] {
  return kind === "preview"
    ? ["'self'", ONE_PRODUCTION_ORIGIN, ONE_PREVIEW_ORIGIN]
    : ["'self'", ONE_PRODUCTION_ORIGIN];
}

/**
 * Cloudflare Pages `_headers`. Only the routes One frames carry the policy;
 * every other path keeps today's (no) headers.
 */
export function headersFileFor(kind: BuildKind): string {
  const csp = `Content-Security-Policy: frame-ancestors ${frameAncestorsFor(kind).join(" ")}`;
  return ["/", "/index.html"].map((path) => `${path}\n  ${csp}\n`).join("\n");
}

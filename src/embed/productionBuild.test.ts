import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BUILD_KIND_ENV,
  buildKindFromEnv,
  frameAncestorsFor,
  headersFileFor,
} from "./framing";

const ROOT = resolve(__dirname, "../..");

interface BuildOutput {
  /** Concatenated text of every emitted file except sourcemaps. */
  text: string;
  headers: string;
  embedText: string;
  files: string[];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Real `vite build`s with the repo's vite.config.ts: the app, plus the embed
// module as a library entry so its origin list is in the output even before
// the app imports it. NODE_ENV=production, as `bun run build` runs.
const BUILD_SCRIPT = `
import { build } from "vite";
const [root, out, embedOut] = process.argv.slice(1);
const configFile = root + "/vite.config.ts";
await build({ root, configFile, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
await build({
  root,
  configFile,
  logLevel: "silent",
  build: {
    outDir: embedOut,
    emptyOutDir: true,
    lib: { entry: root + "/src/embed/oneEmbed.ts", formats: ["es"], fileName: "embed" },
  },
});
`;

function runBuild(base: string, kind: string | undefined): BuildOutput {
  const out = join(base, "app");
  const embedOut = join(base, "embed");
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "production",
    [BUILD_KIND_ENV]: kind,
  };
  if (kind === undefined) delete env[BUILD_KIND_ENV];
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", BUILD_SCRIPT, ROOT, out, embedOut],
    { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`vite build failed: ${result.stderr || result.stdout}`);
  }
  const read = (dir: string) =>
    walk(dir).filter((file) => !file.endsWith(".map"));
  const appFiles = read(out);
  return {
    text: appFiles
      .filter((file) => !file.endsWith(".woff2") && !file.endsWith(".woff"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n"),
    headers: readFileSync(join(out, "_headers"), "utf8"),
    embedText: read(embedOut)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n"),
    files: appFiles,
  };
}

describe("framing headers by build kind", () => {
  it("is fail-closed: only the exact value 'preview' selects the preview list", () => {
    expect(buildKindFromEnv(undefined)).toBe("production");
    expect(buildKindFromEnv("")).toBe("production");
    expect(buildKindFromEnv("Preview")).toBe("production");
    expect(buildKindFromEnv("production")).toBe("production");
    expect(buildKindFromEnv("preview")).toBe("preview");
  });

  it("production frame-ancestors is exactly 'self' + tinycloud.one", () => {
    expect(frameAncestorsFor("production")).toEqual(["'self'", "https://tinycloud.one"]);
  });

  it("preview adds only the pages.dev preview origin", () => {
    expect(frameAncestorsFor("preview")).toEqual([
      "'self'",
      "https://tinycloud.one",
      "https://feat-one-apps.tinychat.pages.dev",
    ]);
  });

  it("frames only / and /index.html, with a CSP and nothing else", () => {
    for (const kind of ["production", "preview"] as const) {
      const lines = headersFileFor(kind).split("\n").filter(Boolean);
      expect(lines.filter((line) => /^\S/.test(line))).toEqual(["/", "/index.html"]);
      for (const line of lines.filter((l) => /^\s/.test(l))) {
        expect(line.trim()).toMatch(/^Content-Security-Policy: frame-ancestors [^;*]+$/);
      }
      expect(headersFileFor(kind)).not.toMatch(/x-frame-options/i);
    }
  });
});

describe("real vite build output", () => {
  let base: string;
  let production: BuildOutput;
  let previewBuild: BuildOutput;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "explorer-build-"));
    production = runBuild(join(base, "production"), undefined);
    previewBuild = runBuild(join(base, "preview"), "preview");
  }, 280_000);

  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("production build contains no pages.dev and no One localhost origin", () => {
    for (const text of [production.text, production.embedText, production.headers]) {
      expect(text).not.toContain("pages.dev");
      expect(text).not.toContain("https://localhost");
      expect(text).not.toMatch(/localhost:51(8|9)\d/);
    }
  });

  it("production build trusts tinycloud.one only (non-vacuous: the origin is present)", () => {
    expect(production.embedText).toContain("https://tinycloud.one");
    expect(production.headers).toBe(headersFileFor("production"));
    expect(production.headers).not.toContain("tinychat");
  });

  it("production build ignores a bogus build-kind signal (fail closed)", () => {
    const base2 = mkdtempSync(join(tmpdir(), "explorer-build-"));
    try {
      const bogus = runBuild(base2, "PREVIEW");
      expect(bogus.headers).toBe(headersFileFor("production"));
      expect(bogus.embedText).not.toContain("pages.dev");
    } finally {
      rmSync(base2, { recursive: true, force: true });
    }
  }, 120_000);

  it("preview build adds the pages.dev preview origin to headers and bundle, still no localhost", () => {
    expect(previewBuild.headers).toBe(headersFileFor("preview"));
    expect(previewBuild.embedText).toContain("https://feat-one-apps.tinychat.pages.dev");
    expect(previewBuild.embedText).not.toContain("https://localhost");
  });

  it("emits _headers at the output root only", () => {
    expect(production.files.filter((file) => file.endsWith("_headers"))).toHaveLength(1);
  });
});

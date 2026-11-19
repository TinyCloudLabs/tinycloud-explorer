import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import {
  BUILD_KIND_ENV,
  buildKindFromEnv,
  headersFileFor,
} from "./src/embed/framing";

// `bun run dev:one` serves https://localhost:5193 so One (https) can frame it.
// Point these at an mkcert pair; unset keeps the default http dev server.
const tlsCert = process.env.EXPLORER_DEV_TLS_CERT;
const tlsKey = process.env.EXPLORER_DEV_TLS_KEY;

export default defineConfig(({ mode }) => {
  // Fail closed: only VITE_EXPLORER_BUILD_KIND=preview selects the preview
  // origin; anything else is a production build.
  const buildKind = buildKindFromEnv(loadEnv(mode, process.cwd(), "VITE_")[BUILD_KIND_ENV]);

  return {
    plugins: [
      react(),
      {
        // Cloudflare Pages reads `_headers` from the output root. Only the
        // routes One frames get a policy; the origins depend on the build kind.
        name: "explorer-framing-headers",
        apply: "build" as const,
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "_headers",
            source: headersFileFor(buildKind),
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      ...(tlsCert && tlsKey
        ? { https: { cert: readFileSync(tlsCert), key: readFileSync(tlsKey) } }
        : {}),
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
    },
  };
});

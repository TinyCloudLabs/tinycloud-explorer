import { defineConfig, devices } from "@playwright/test";

// Real Explorer suite. Drives the live OpenKey iframe + TinyCloud SDK against a
// dedicated, non-reused dev server so it can never inherit state from the mock
// run. The deterministic account's hosted `public` space is used because the
// live external-wallet flow cannot provision a new owned space during sign-in;
// records remain isolated under a dedicated per-run KV key prefix.
export default defineConfig({
  testDir: "e2e",
  testMatch: "explorer.real.pw.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    // Same origin the OpenKey embed is registered against; a fresh server (never
    // reused from a mock run) is guaranteed by reuseExistingServer:false below.
    baseURL: "http://127.0.0.1:4188",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  expect: {
    timeout: 15_000,
  },
  timeout: 240_000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 4188",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_EXPLORER_DATA_SOURCE: "real",
      VITE_TINYCLOUD_SPACE_PREFIX:
        process.env.VITE_TINYCLOUD_SPACE_PREFIX ?? "public",
      VITE_TINYCLOUD_SESSION_PREFIX:
        process.env.VITE_TINYCLOUD_SESSION_PREFIX ?? "tinycloud-explorer-e2e",
      VITE_TINYCLOUD_KV_PREFIX:
        process.env.VITE_TINYCLOUD_KV_PREFIX ?? "tinycloud-explorer-e2e/",
      ...(process.env.VITE_OPENKEY_HOST
        ? { VITE_OPENKEY_HOST: process.env.VITE_OPENKEY_HOST }
        : {}),
      ...(process.env.VITE_TINYCLOUD_HOST
        ? { VITE_TINYCLOUD_HOST: process.env.VITE_TINYCLOUD_HOST }
        : {}),
    },
  },
});

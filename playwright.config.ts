import { defineConfig, devices } from "@playwright/test";

// Mock Explorer suite. Runs the seeded SDK mock data source against a dedicated
// dev server so it never shares state with the real OpenKey + TinyCloud run.
export default defineConfig({
  testDir: "e2e",
  testMatch: "explorer.pw.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4188",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  expect: {
    timeout: 10_000,
  },
  timeout: 30_000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 4188",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_EXPLORER_DATA_SOURCE: "mock",
    },
  },
});

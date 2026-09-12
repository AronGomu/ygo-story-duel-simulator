import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-content",
  outputDir: "artifacts/CORE_ACCEPTANCE/T4/test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["line"],
    [
      "json",
      { outputFile: "artifacts/CORE_ACCEPTANCE/T4/playwright-report.json" },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4402",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4402 --strictPort",
    url: "http://127.0.0.1:4402",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

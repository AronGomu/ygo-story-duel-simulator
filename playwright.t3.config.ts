import { defineConfig, devices } from "@playwright/test";

const port = 4420;
if (!process.env.CONTENT_RUN)
  throw new Error("CONTENT_RUN is required for T3 browser acceptance");

export default defineConfig({
  testDir: "./e2e-core",
  testMatch: "chapter-content-delivery.spec.ts",
  outputDir: "artifacts/CORE_ACCEPTANCE/T3/test-results",
  workers: 1,
  timeout: 180_000,
  reporter: [
    ["line"],
    [
      "json",
      { outputFile: "artifacts/CORE_ACCEPTANCE/T3/playwright-report.json" },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}/`,
    trace: "on",
    screenshot: "on",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});

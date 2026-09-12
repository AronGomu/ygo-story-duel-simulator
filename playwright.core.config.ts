import { defineConfig, devices } from "@playwright/test";

const rootPort = 4400;
const subpathPort = 4401;
const subpath = "/ygo-story-duel/";

export default defineConfig({
  testDir: "./e2e-core",
  globalTeardown: "./scripts/core-source-only-teardown.ts",
  outputDir: "artifacts/CORE_ACCEPTANCE/T2/test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["line"],
    [
      "json",
      { outputFile: "artifacts/CORE_ACCEPTANCE/T2/playwright-report.json" },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: `exec env CORE_SOURCE_ID=root CORE_SOURCE_PORT=${rootPort} BASE_PATH=/ node scripts/core-source-only-server.ts`,
      url: `http://127.0.0.1:${rootPort}/`,
      reuseExistingServer: false,
      timeout: 600_000,
    },
    {
      command: `exec env CORE_SOURCE_ID=subpath CORE_SOURCE_PORT=${subpathPort} BASE_PATH=${subpath} node scripts/core-source-only-server.ts`,
      url: `http://127.0.0.1:${subpathPort}${subpath}`,
      reuseExistingServer: false,
      timeout: 600_000,
    },
  ],
});

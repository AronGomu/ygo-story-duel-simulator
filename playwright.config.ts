import { defineConfig, devices } from "@playwright/test";

const basePath = "/ygo-story-duel/";
const baseURL = `http://127.0.0.1:4173${basePath}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-smoke",
      grep: /production bundle initializes/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-smoke",
      grep: /production bundle initializes/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command:
      "npm run vendor:verify && npm run snapshot:verify && npm run build:app -- --base=/ygo-story-duel/ && npm run build:verify && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --base=/ygo-story-duel/",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

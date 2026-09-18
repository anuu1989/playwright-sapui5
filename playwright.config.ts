import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });

// Demo app used by this repo's own example suite - see docs/multi-environment-config.md for how
// to point this whole setup at your own app instead, via a `.env` file (copy `.env.example`).
const DEMO_APP_URL = 'https://ui5.sap.com/test-resources/sap/m/demokit/cart/webapp/index.html';

export default defineConfig({
  testDir: './examples/tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL ?? DEMO_APP_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'verify',
  testMatch: '*.spec.ts',
  globalSetup: './verify/global-setup.ts',
  retries: 0, // retries come from the hourly tick, not from Playwright
  workers: 1, // one run's checks never race another's state update
  reporter: [['junit', { outputFile: 'results/junit.xml' }], ['html', { open: 'never' }], ['list']],
  use: {
    trace: 'retain-on-failure',
  },
});

import { defineConfig } from '@playwright/test';
import config, { TEST_ENV } from './config/index.js';

export default defineConfig({
  testDir: './tests',
  outputDir: './reports/test-results',
  globalSetup: './src/setup/global-setup.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: config.run.workers,
  retries: config.run.retries,
  timeout: config.run.testTimeoutMs,
  metadata: { environment: TEST_ENV, dataSeed: config.data.seed },
  projects: [
    // Framework self-tests: fast, offline, run first in CI.
    { name: 'unit', testDir: './tests/unit' },
    { name: 'api', testIgnore: '**/unit/**' },
  ],
  reporter: [
    [process.env.CI ? 'dot' : 'list'],
    ['html', { outputFolder: 'reports/html', open: config.report.htmlOpen }],
    ['./src/reporters/chat-reporter.js'],
  ],
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: './reports/test-results',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never', outputFolder: './reports/playwright-html-report' }],
        ['json', { outputFile: './reports/results.json' }],
        ['junit', { outputFile: './reports/junit.xml' }],
        ['./reporters/markdown-reporter.cjs', { outputFile: 'e2e/reports/latest.md' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: './reports/playwright-html-report' }],
        ['json', { outputFile: './reports/results.json' }],
        ['junit', { outputFile: './reports/junit.xml' }],
        ['./reporters/markdown-reporter.cjs', { outputFile: 'e2e/reports/latest.md' }],
      ],
  use: {
    baseURL: 'http://localhost:17573',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'OD_DATA_DIR=e2e/.od-data OD_PORT=17456 VITE_PORT=17573 npm run dev:all',
    url: 'http://localhost:17573',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

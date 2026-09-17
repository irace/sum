import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:5175', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -w @sum/web',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});

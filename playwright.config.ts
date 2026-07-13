import { defineConfig } from '@playwright/test';

const runtime = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};
const baseURL = runtime.process?.env?.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4175';

export default defineConfig({
  globalSetup: './e2e/viteServer.ts',
  testDir: './e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  use: {
    baseURL,
    launchOptions: {
      args: ['--use-angle=swiftshader'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});

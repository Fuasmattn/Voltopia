import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    launchOptions: {
      args: [
        '--no-proxy-server',
        '--no-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
      ],
    },
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

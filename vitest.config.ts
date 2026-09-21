import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The multi-day simulation integration tests take a few seconds
    // locally and 2-3x that on shared CI runners — the 5s default
    // timeout is too tight.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/sim/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/sim/worker.ts', 'src/**/*.test.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});

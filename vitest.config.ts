import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    // Browser and git tests run in parallel with the rest; 5 s is too tight under that load.
    testTimeout: 30_000,
  },
});

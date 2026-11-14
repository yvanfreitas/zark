import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // UI modules import the pure core helpers as '@core/...' (same alias as Vite).
  resolve: { alias: { '@core': fileURLToPath(new URL('./packages/core/src', import.meta.url)) } },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    // Browser and git tests run in parallel with the rest; 5 s is too tight under that load.
    testTimeout: 30_000,
  },
});

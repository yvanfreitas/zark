import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const exclude = ['**/node_modules/**', '**/dist/**', '.claude/**'];
// Tests that launch headless Chromium (UI, render, PR with images). Run one file
// at a time after the unit tests: several browsers at once starve the CPU and
// the Fase 2 latency acceptance (< 1 s) stops measuring the product.
const browser = [
  'packages/server/test/phase2.test.ts',
  'packages/server/test/phase5-ui.test.ts',
  'packages/server/test/icons.test.ts',
  'packages/server/test/render-status.test.ts',
  'packages/server/test/pr-e2e.test.ts',
  'packages/server/test/pr-gitlab-e2e.test.ts',
];

export default defineConfig({
  // UI modules import the pure core helpers as '@core/...' (same alias as Vite).
  resolve: { alias: { '@core': fileURLToPath(new URL('./packages/core/src', import.meta.url)) } },
  test: {
    // Git tests still share the machine with the unit run; 5 s is too tight.
    testTimeout: 30_000,
    projects: [
      { extends: true, test: { name: 'unit', exclude: [...exclude, ...browser], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'browser', include: browser, exclude, fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
  },
});

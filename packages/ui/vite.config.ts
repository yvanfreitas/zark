import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative asset paths so `zark build` works from any subfolder (GitHub Pages).
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    // Only pure modules of the core (no Node imports) are used by the UI.
    alias: { '@core': fileURLToPath(new URL('../core/src', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});

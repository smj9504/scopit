/**
 * Build-time-only Vite config for the SEO SSR bundle (src/entrySeo.tsx).
 *
 * Kept separate from vite.config.ts so the SSR build skips the PWA plugin and
 * app chunking. Output lands in dist-ssr/ and is consumed by
 * scripts/prerender-seo.mjs — it is never deployed.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
      '@stores': fileURLToPath(new URL('./src/stores', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/hooks', import.meta.url)),
      '@types': fileURLToPath(new URL('./src/types', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
    },
  },
  build: {
    ssr: 'src/entrySeo.tsx',
    outDir: 'dist-ssr',
    sourcemap: false,
    // Keep the shell's own scripts untouched; this bundle is Node-only.
    rollupOptions: {
      output: { entryFileNames: 'entrySeo.js' },
    },
  },
});

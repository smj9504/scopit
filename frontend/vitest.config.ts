import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Unit tests for pure functions — the Cabinet and Bathroom Estimators'
 * sketch geometry, 3D models, takeoffs and choices, and their company
 * prices page's edits. No DOM and no Konva, so the node
 * environment is right and fast. Test files import what they need from
 * 'vitest' explicitly (no globals).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: [
      'src/components/features/tools/cabinet-estimate/**/*.test.ts',
      'src/components/features/tools/bathroom-estimate/**/*.test.ts',
      'src/components/features/tools/unit-prices/**/*.test.ts',
    ],
  },
});

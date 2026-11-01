import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests cover plain TypeScript: the protocol packages, the probe's helpers,
// the push relay and the app's non-UI logic. Screens are checked by the type checker and by bundling.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'apps/mobile/src') },
  },
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'tools/*/src/**/*.test.ts',
      'apps/mobile/src/**/*.test.ts',
      'services/*/src/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
  },
});

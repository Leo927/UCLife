import { defineConfig } from 'vitest/config'

// Standalone config for the unit-test layer. The Vite dev plugins from
// vite.config.ts (LPC asset middleware, etc.) are intentionally excluded —
// unit tests run pure logic in node, no dev server, no LPC mount. Vitest
// handles `?raw` JSON5 imports natively via Vite's core resolver, so the
// existing `import raw from './*.json5?raw'` config loaders work unchanged.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})

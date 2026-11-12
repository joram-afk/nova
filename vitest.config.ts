import { defineConfig } from 'vitest/config'

// Keep tests independent of the PWA and theme plugins used by the production build.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
})

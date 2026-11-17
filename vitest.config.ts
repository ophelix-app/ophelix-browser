import { defineConfig } from 'vitest/config'

// Les tests ne sortent pas du processus : `fetch` est remplacé, la page n'existe pas.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})

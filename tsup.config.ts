import { defineConfig } from 'tsup'

// ESM et CommonJS pour un outil de build. Aucune dépendance.
// Le script autonome, pour une page sans outil, a son entrée : `<script src="ophelix-browser.global.js">`
// pose `window.OphelixBrowser`, la classe elle-même, et non un module qui la contiendrait.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2020',
    platform: 'browser',
    sourcemap: true,
  },
  {
    entry: { 'ophelix-browser': 'src/global.ts' },
    format: ['iife'],
    target: 'es2020',
    platform: 'browser',
    sourcemap: true,
  },
])

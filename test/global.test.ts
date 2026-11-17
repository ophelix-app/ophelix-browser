import { describe, expect, it } from 'vitest'
import { OphelixBrowser, OphelixBrowserError } from '../src'
import type { OphelixBrowserGlobal } from '../src/global'

describe('le script autonome', () => {
  it('pose la classe elle-même sur window, avec la classe d’erreur', async () => {
    await import('../src/global')
    const global = (globalThis as { OphelixBrowser?: typeof OphelixBrowserGlobal }).OphelixBrowser

    expect(global).toBe(OphelixBrowser)
    expect(global?.OphelixBrowserError).toBe(OphelixBrowserError)
    expect(global?.create({ fetchClientSecret: async () => 'bss_1_secret_1', storage: null })).toBeInstanceOf(OphelixBrowser)
  })
})

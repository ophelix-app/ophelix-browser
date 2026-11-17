import { DEFAULT_API_URL, OphelixBrowser } from './client'
import { OphelixBrowserError } from './errors'

/**
 * Le script autonome, pour une page sans outil de build : `<script src="ophelix-browser.global.js">`
 * pose `window.OphelixBrowser`, la classe elle-même, qui porte aussi la classe d'erreur.
 *
 *   const reader = OphelixBrowser.create({ fetchClientSecret })
 *   error instanceof OphelixBrowser.OphelixBrowserError
 */
export const OphelixBrowserGlobal = Object.assign(OphelixBrowser, { OphelixBrowserError, DEFAULT_API_URL })

;(globalThis as { OphelixBrowser?: typeof OphelixBrowserGlobal }).OphelixBrowser = OphelixBrowserGlobal

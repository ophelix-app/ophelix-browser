// Le paquet bâti se charge par import, sans dépendance, et donne un composant utilisable.
import assert from 'node:assert/strict'
import { DEFAULT_API_URL, OphelixBrowser, OphelixBrowserError } from '../dist/index.js'

const reader = OphelixBrowser.create({ fetchClientSecret: async () => 'bss_smoke_secret_smoke' })
assert.equal(typeof reader.connect, 'function')
assert.equal(typeof reader.readVitale, 'function')
assert.equal(typeof reader.secureClaim, 'function')
assert.equal(typeof DEFAULT_API_URL, 'string')
assert.ok(new OphelixBrowserError('workstation_offline', 'smoke') instanceof Error)
console.log('ESM : ok')

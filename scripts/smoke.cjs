// Le paquet bâti se charge par require, et le script autonome pose la classe sur la page.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const { OphelixBrowser, OphelixBrowserError } = require('../dist/index.cjs')

const reader = OphelixBrowser.create({ fetchClientSecret: async () => 'bss_smoke_secret_smoke' })
assert.equal(typeof reader.readCps, 'function')
assert.ok(new OphelixBrowserError('workstation_offline', 'smoke') instanceof Error)
console.log('CommonJS : ok')

// Les champs du paquet désignent des fichiers bâtis.
const manifest = require('../package.json')
for (const path of [manifest.main, manifest.module, manifest.types, manifest.unpkg, manifest.jsdelivr]) {
  assert.ok(readFileSync(join(__dirname, '..', path)).length > 0, path)
}

const page = vm.createContext({})
vm.runInContext(readFileSync(join(__dirname, '..', manifest.unpkg), 'utf8'), page)
assert.equal(typeof page.OphelixBrowser.create, 'function')
assert.equal(typeof page.OphelixBrowser.OphelixBrowserError, 'function')
console.log('Script autonome : ok')

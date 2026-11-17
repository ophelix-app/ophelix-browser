import { describe, expect, it } from 'vitest'
import { type LinkStorage, OphelixBrowser, OphelixBrowserError } from '../src'

type Call = { method: string; url: string; body: Record<string, unknown> | null; authorization: string | null }
type Reply = { status?: number; body: unknown }

const SESSION = {
  id: 'bss_1',
  object: 'browser_session',
  origin: 'https://app.exemple.fr',
  workstation: null,
  expires_at: 0,
  livemode: false,
}
const LINKED = { ...SESSION, workstation: { id: 'ws_1', name: 'Accueil', online: true, cards: ['vitale'] } }
const action = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'wsa_1',
  object: 'workstation_action',
  type: 'read_vitale',
  status,
  result: null,
  failure_code: null,
  failure_message: null,
  ...extra,
})

/** Un faux `fetch` qui répond dans l'ordre, et note chaque appel. */
function fakeApi(replies: Reply[]) {
  const calls: Call[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      authorization: headers.get('Authorization'),
    })
    const reply = replies.shift()
    if (!reply) throw new Error(`appel inattendu : ${init?.method} ${url}`)
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'Request-Id': 'req_1' } })
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

function memoryStorage(initial: Record<string, string> = {}): LinkStorage & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value
    },
    removeItem: key => {
      delete values[key]
    },
  }
}

function browser(replies: Reply[], storage = memoryStorage(), secrets = ['bss_1_secret_a']) {
  const api = fakeApi(replies)
  const reader = OphelixBrowser.create({
    apiUrl: 'https://api.test/',
    fetch: api.fetch,
    storage,
    sleep: async () => {},
    fetchClientSecret: async () => secrets.shift() ?? 'bss_1_secret_z',
  })
  return { reader, calls: api.calls, storage }
}

describe('OphelixBrowser', () => {
  it('appelle les routes des composants embarqués, avec leur méthode', async () => {
    const claim = { id: 'clm_1', object: 'claim', lines: [] }
    const { reader, calls } = browser([
      { body: LINKED },
      { body: { data: [], has_more: false } },
      { status: 201, body: claim },
      { body: claim },
      { body: claim },
      { body: claim },
    ])

    await reader.searchActs('consult', '2026-11-08')
    await reader.createClaim({ coverage: 'cov_1', context: { care_pathway: 'treating_doctor' } })
    await reader.addClaimLine('clm_1', { nomenclature: 'ngap', code: 'ZC', service_date: '2026-11-08' })
    await reader.updateClaim('clm_1', { context: {} })
    await reader.removeClaimLine('clm_1', 'cli_1')

    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.test/browser/v1/session',
      'GET https://api.test/browser/v1/acts?query=consult&service_date=2026-11-08&limit=8',
      'POST https://api.test/browser/v1/claims',
      'POST https://api.test/browser/v1/claims/clm_1/lines',
      'PATCH https://api.test/browser/v1/claims/clm_1',
      'DELETE https://api.test/browser/v1/claims/clm_1/lines/cli_1',
    ])
    expect(calls[2]?.body).toEqual({ coverage: 'cov_1', context: { care_pathway: 'treating_doctor' } })
  })

  it('associe la page par le code de l’agent, et garde le jeton pour la visite suivante', async () => {
    const { reader, calls, storage } = browser([{ body: SESSION }, { body: { ...LINKED, link_token: 'wbl_jeton' } }])

    expect((await reader.connect()).workstation).toBeNull()
    const linked = await reader.link('K7P-4QX')

    expect(linked.workstation?.name).toBe('Accueil')
    expect(linked).not.toHaveProperty('link_token')
    expect(storage.values['ophelix.browser-link.test']).toBe('wbl_jeton')
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.test/browser/v1/session',
      'POST https://api.test/browser/v1/session/link',
    ])
    expect(calls[1]?.body).toEqual({ code: 'K7P-4QX' })
    expect(calls[0]?.authorization).toBe('Bearer bss_1_secret_a')
  })

  it('rouvre l’association gardée, et l’oublie si le poste l’a retirée', async () => {
    const kept = browser([{ body: SESSION }, { body: LINKED }], memoryStorage({ 'ophelix.browser-link.test': 'wbl_jeton' }))
    expect((await kept.reader.connect()).workstation?.id).toBe('ws_1')
    expect(kept.calls[1]?.body).toEqual({ link_token: 'wbl_jeton' })

    const gone = browser(
      [{ body: SESSION }, { status: 404, body: { error: { code: 'browser_link_invalid', message: 'partie' } } }],
      memoryStorage({ 'ophelix.browser-link.test': 'wbl_jeton' }),
    )
    expect((await gone.reader.connect()).workstation).toBeNull()
    expect(gone.storage.values).toEqual({})
  })

  it('lit une carte en relisant la demande jusqu’à son terme', async () => {
    const statuses: string[] = []
    const { reader, calls } = browser([
      { body: LINKED },
      { status: 201, body: action('pending') },
      { body: action('pending') },
      { body: action('in_progress') },
      { body: action('succeeded', { result: { coverage: 'cov_1', patient: 'pat_1' } }) },
    ])

    const done = await reader.readVitale({ scenario: 'vitale_exempted', onStatus: status => statuses.push(status) })

    expect(done.result).toEqual({ coverage: 'cov_1', patient: 'pat_1' })
    expect(statuses).toEqual(['pending', 'in_progress', 'succeeded'])
    expect(calls[1]?.body).toEqual({ type: 'read_vitale', scenario: 'vitale_exempted' })
  })

  it('rend l’échec de la demande par son code', async () => {
    const { reader } = browser([
      { body: LINKED },
      { status: 201, body: action('failed', { failure_code: 'card_absent', failure_message: 'Aucune carte.' }) },
    ])

    const error = await reader.readVitale().catch(caught => caught)

    expect(error).toBeInstanceOf(OphelixBrowserError)
    expect(error.code).toBe('card_absent')
    expect(error.action?.id).toBe('wsa_1')
  })

  it('rend une erreur de l’API avec son code, son statut et son Request-Id', async () => {
    const { reader } = browser([
      { body: SESSION },
      { status: 409, body: { error: { code: 'workstation_not_linked', message: 'Associez la page.' } } },
    ])

    const error = await reader.readCps().catch(caught => caught)

    expect(error).toMatchObject({ code: 'workstation_not_linked', status: 409, requestId: 'req_1', message: 'Associez la page.' })
  })

  it('redemande un secret quand la session expire, puis rejoue l’appel', async () => {
    const { reader, calls } = browser(
      [{ body: LINKED }, { status: 401, body: { error: { code: 'browser_session_expired' } } }, { body: LINKED }, { body: LINKED }],
      memoryStorage(),
      ['bss_1_secret_a', 'bss_2_secret_b'],
    )
    await reader.connect()

    await reader.refresh()

    expect(calls.map(call => call.authorization)).toEqual([
      'Bearer bss_1_secret_a',
      'Bearer bss_1_secret_a',
      'Bearer bss_2_secret_b',
      'Bearer bss_2_secret_b',
    ])
  })

  it('annule la demande quand la page l’abandonne', async () => {
    const controller = new AbortController()
    const { reader, calls } = browser([{ body: LINKED }, { status: 201, body: action('pending') }, { body: action('canceled') }])

    const reading = reader.readVitale({ signal: controller.signal, onStatus: () => controller.abort() })

    await expect(reading).rejects.toMatchObject({ code: 'aborted' })
    expect(calls.at(-1)?.url).toBe('https://api.test/browser/v1/actions/wsa_1/cancel')
  })

  it('travaille sans stockage', async () => {
    const api = fakeApi([{ body: SESSION }, { body: { ...LINKED, link_token: 'wbl_jeton' } }])
    const reader = OphelixBrowser.create({ fetch: api.fetch, storage: null, fetchClientSecret: async () => 'bss_1_secret_a' })

    await reader.link('K7P-4QX')

    expect(reader.session?.workstation?.id).toBe('ws_1')
    expect(api.calls[0]?.url).toBe('https://api.ophelix.fr/browser/v1/session')
  })
})

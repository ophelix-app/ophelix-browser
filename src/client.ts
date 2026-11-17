import { OphelixBrowserError } from './errors'
import type {
  Act,
  ActionOptions,
  ActLine,
  BrowserSession,
  Claim,
  ClaimContext,
  ClaimValidation,
  Coverage,
  LinkStorage,
  OphelixBrowserOptions,
  Practitioner,
  Rejection,
  WorkstationAction,
  WorkstationActionType,
} from './types'

export const DEFAULT_API_URL = 'https://api.ophelix.fr'

const FINAL = new Set(['succeeded', 'failed', 'canceled', 'expired'])
/** Les réponses qui disent que le secret ne vaut plus : on en redemande un, une fois. */
const STALE_SESSION = new Set(['browser_session_expired', 'invalid_browser_session'])

type Request = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; body?: Record<string, unknown> }

const id = (value: string) => encodeURIComponent(value)

/** `localStorage` quand il existe et répond : une navigation privée peut le refuser. */
function defaultStorage(): LinkStorage | null {
  try {
    const storage = globalThis.localStorage
    const probe = '__ophelix__'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

/**
 * Le composant navigateur d'Ophelix. La page ne parle jamais à l'agent : elle confie la lecture
 * à l'API, qui la passe à l'agent du poste associé, puis relit la demande jusqu'à son terme.
 * Le code porteur ne passe jamais par la page : il se saisit dans la fenêtre de l'agent.
 *
 *   const reader = OphelixBrowser.create({ fetchClientSecret: () => monServeur.sessionOphelix() })
 *   const session = await reader.connect()
 *   if (!session.workstation) await reader.link(codeAfficheParLAgent)
 *   const action = await reader.readVitale()
 *   // action.result.coverage : à relire depuis votre serveur, avec votre clé secrète.
 */
export class OphelixBrowser {
  private readonly apiUrl: string
  private readonly fetcher: typeof fetch
  private readonly storage: LinkStorage | null
  private readonly pollInterval: number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private secret: string | null = null
  private current: BrowserSession | null = null

  constructor(private readonly options: OphelixBrowserOptions) {
    if (typeof options?.fetchClientSecret !== 'function') {
      throw new TypeError('fetchClientSecret doit rendre le secret que votre serveur obtient par POST /v1/browser-sessions.')
    }
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
    this.pollInterval = options.pollInterval ?? 500
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  }

  static create(options: OphelixBrowserOptions): OphelixBrowser {
    return new OphelixBrowser(options)
  }

  /** La session connue, sans appel. Vide avant `connect()`. */
  get session(): BrowserSession | null {
    return this.current
  }

  /**
   * Ouvre une session et retrouve le poste de la visite précédente, s'il y en a un. `workstation`
   * reste vide quand la page doit encore être associée : `link()` avec le code de l'agent.
   */
  async connect(): Promise<BrowserSession> {
    const secret = await this.options.fetchClientSecret()
    if (typeof secret !== 'string' || secret === '') {
      throw new OphelixBrowserError(
        'invalid_browser_session',
        "fetchClientSecret n'a rendu aucun secret : votre serveur l'obtient par POST /v1/browser-sessions.",
      )
    }
    this.secret = secret
    let session = await this.call<BrowserSession>({ method: 'GET', path: '/session' }, false)
    const token = this.storedToken(session.livemode)

    if (!session.workstation && token) {
      try {
        session = await this.call<BrowserSession>({ method: 'POST', path: '/session/resume', body: { link_token: token } }, false)
      } catch (error) {
        // Le poste a retiré la page, ou il a été révoqué : on oublie, la page redemandera un code.
        if (!(error instanceof OphelixBrowserError) || error.code !== 'browser_link_invalid') throw error
        this.forget(session.livemode)
      }
    }

    this.current = session
    return session
  }

  /** Associe la page au poste dont l'agent montre le code, et s'en souvient pour la suite. */
  async link(code: string): Promise<BrowserSession> {
    await this.ensureSession()
    const linked = await this.call<BrowserSession & { link_token?: string }>({ method: 'POST', path: '/session/link', body: { code } })
    const { link_token: token, ...session } = linked

    if (token) this.remember(session.livemode, token)
    this.current = session
    return session
  }

  /** Relit la session : le poste répond-il, quelles cartes sont insérées ? */
  async refresh(): Promise<BrowserSession> {
    await this.ensureSession()
    this.current = await this.call<BrowserSession>({ method: 'GET', path: '/session' })
    return this.current
  }

  /** Oublie l'association gardée par ce navigateur. La page redemandera un code. */
  forget(livemode = this.current?.livemode ?? false): void {
    try {
      this.storage?.removeItem(this.storageKey(livemode))
    } catch {
      // Un stockage refusé n'empêche rien : il n'y avait rien à oublier.
    }
  }

  /** Lit la carte Vitale insérée. `result.coverage` et `result.patient` nomment ce qui a été lu. */
  readVitale(options: ActionOptions = {}): Promise<WorkstationAction> {
    return this.run('read_vitale', {}, options)
  }

  /** Lit la carte CPS insérée. `result.practitioner` nomme le praticien créé ou mis à jour. */
  readCps(options: ActionOptions = {}): Promise<WorkstationAction> {
    return this.run('read_cps', {}, options)
  }

  /** Fait signer une facture `ready` par la CPS du poste. Le code se saisit dans l'agent. */
  secureClaim(claim: string, options: ActionOptions = {}): Promise<WorkstationAction> {
    return this.run('secure_claim', { claim }, options)
  }

  /*
   * Les composants embarqués. Chaque appel demande que le serveur ait ouvert le composant
   * à la session (`components`), et ne rend que les objets que cette page a lus ou créés.
   */

  /** La couverture d'une carte Vitale lue par cette page, avec son patient. Composant `patient`. */
  retrieveCoverage(coverage: string): Promise<Coverage> {
    return this.authenticated({ method: 'GET', path: `/coverages/${id(coverage)}` })
  }

  /** Le praticien que la session connaît, par sa CPS ou nommé par le serveur. */
  retrievePractitioner(practitioner: string): Promise<Practitioner> {
    return this.authenticated({ method: 'GET', path: `/practitioners/${id(practitioner)}` })
  }

  /** L'aide à la cotation : les actes qu'un code ou un libellé désigne à la date des soins. Composant `acts`. */
  searchActs(query: string, serviceDate: string): Promise<{ data: Act[]; has_more: boolean }> {
    const params = new URLSearchParams({ query, service_date: serviceDate, limit: '8' })
    return this.authenticated({ method: 'GET', path: `/acts?${params}` })
  }

  /** Ouvre le brouillon de la facture du patient lu, pour le praticien qui facture. Composant `acts`. */
  createClaim(params: { coverage: string; context?: ClaimContext; lines?: ActLine[] }): Promise<Claim> {
    return this.authenticated({ method: 'POST', path: '/claims', body: params })
  }

  /** Une facture de la session : `acts`, `claim_summary` ou `claim_timeline`. */
  retrieveClaim(claim: string): Promise<Claim> {
    return this.authenticated({ method: 'GET', path: `/claims/${id(claim)}` })
  }

  /** Le contexte des soins d'un brouillon. Il remplace le précédent. */
  updateClaim(claim: string, params: { context: ClaimContext }): Promise<Claim> {
    return this.authenticated({ method: 'PATCH', path: `/claims/${id(claim)}`, body: params })
  }

  /** Pose un acte : la facture revient tarifée. */
  addClaimLine(claim: string, line: ActLine): Promise<Claim> {
    return this.authenticated({ method: 'POST', path: `/claims/${id(claim)}/lines`, body: line })
  }

  removeClaimLine(claim: string, line: string): Promise<Claim> {
    return this.authenticated({ method: 'DELETE', path: `/claims/${id(claim)}/lines/${id(line)}` })
  }

  /** Les contrôles de la facture, sans rien changer. Composant `claim_summary`. */
  validateClaim(claim: string): Promise<ClaimValidation> {
    return this.authenticated({ method: 'POST', path: `/claims/${id(claim)}/validate` })
  }

  /** Passe le brouillon à `ready` : il peut se signer. Composant `claim_summary`. */
  finalizeClaim(claim: string): Promise<Claim> {
    return this.authenticated({ method: 'POST', path: `/claims/${id(claim)}/finalize` })
  }

  /** Les rejets des caisses pour cette facture. Composant `claim_timeline`. */
  listClaimRejections(claim: string): Promise<{ data: Rejection[] }> {
    return this.authenticated({ method: 'GET', path: `/claims/${id(claim)}/rejections` })
  }

  private async authenticated<T>(request: Request): Promise<T> {
    await this.ensureSession()
    return this.call<T>(request)
  }

  private async run(type: WorkstationActionType, extra: Record<string, unknown>, options: ActionOptions): Promise<WorkstationAction> {
    await this.ensureSession()
    if (options.signal?.aborted) throw this.aborted()

    let action = await this.call<WorkstationAction>({
      method: 'POST',
      path: '/actions',
      body: { type, ...extra, ...(options.scenario ? { scenario: options.scenario } : {}) },
    })
    let reported = action.status
    options.onStatus?.(reported)

    while (!FINAL.has(action.status)) {
      if (options.signal?.aborted) {
        await this.call({ method: 'POST', path: `/actions/${encodeURIComponent(action.id)}/cancel` }).catch(() => undefined)
        throw this.aborted()
      }
      await this.sleep(this.pollInterval)
      action = await this.call<WorkstationAction>({ method: 'GET', path: `/actions/${encodeURIComponent(action.id)}` })
      if (action.status !== reported) {
        reported = action.status
        options.onStatus?.(reported)
      }
    }

    if (action.status !== 'succeeded') throw OphelixBrowserError.fromAction(action)
    return action
  }

  private async ensureSession(): Promise<void> {
    if (!this.secret) await this.connect()
  }

  /** Un appel de `/browser/v1`. Un secret périmé se renouvelle une fois, avec l'association gardée. */
  private async call<T>(request: Request, retry = true): Promise<T> {
    try {
      return await this.send<T>(request)
    } catch (error) {
      if (!retry || !(error instanceof OphelixBrowserError) || !STALE_SESSION.has(error.code)) throw error
      await this.connect()
      return this.send<T>(request)
    }
  }

  private async send<T>(request: Request): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(`${this.apiUrl}/browser/v1${request.path}`, {
        method: request.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.secret ?? ''}`,
          ...(request.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
        // Aucun cookie : seul le secret de la session ouvre quelque chose.
        credentials: 'omit',
      })
    } catch (error) {
      throw new OphelixBrowserError(
        'network_error',
        `L'API Ophelix ne répond pas : ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const requestId = response.headers.get('Request-Id')
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null

    if (!response.ok) {
      throw new OphelixBrowserError(payload?.error?.code ?? 'api_error', payload?.error?.message ?? `L'API a répondu ${response.status}.`, {
        status: response.status,
        requestId,
      })
    }

    return payload as T
  }

  private aborted(): OphelixBrowserError {
    return new OphelixBrowserError('aborted', 'La demande a été abandonnée par la page.')
  }

  private storageKey(livemode: boolean): string {
    return `ophelix.browser-link.${livemode ? 'live' : 'test'}`
  }

  private storedToken(livemode: boolean): string | null {
    try {
      return this.storage?.getItem(this.storageKey(livemode)) ?? null
    } catch {
      return null
    }
  }

  private remember(livemode: boolean, token: string): void {
    try {
      this.storage?.setItem(this.storageKey(livemode), token)
    } catch {
      // Sans stockage, la page redemandera un code à la prochaine visite : rien ne casse.
    }
  }
}

/** Le genre d'une carte : tout ce que la page apprend des lecteurs du poste. */
export type CardKind = 'vitale' | 'cps' | 'unknown'

/** Un lecteur du poste : son nom, ses fentes et le genre de la carte de chacune. */
export type WorkstationReader = {
  name: string
  slots: { index: number; card: CardKind | null }[]
}

/** Le poste auquel la page est associée. */
export type LinkedWorkstation = {
  id: string
  name: string
  /** L'agent a donné de ses nouvelles il y a moins de 45 secondes. */
  online: boolean
  /** Le genre des cartes insérées. */
  cards: CardKind[]
  /** Les lecteurs du poste. */
  readers?: WorkstationReader[]
  agent_version?: string | null
}

/** Ce que le serveur de l'intégrateur ouvre à la page, au-delà des cartes (`POST /v1/browser-sessions`, `components`). */
export type BrowserComponent = 'patient' | 'acts' | 'claim_summary' | 'claim_timeline' | 'practitioner_onboarding'

/** La session de la page, telle que l'API la rend au composant. */
export type BrowserSession = {
  id: string
  object: 'browser_session'
  origin: string
  /** Vide tant que la page n'est associée à aucun poste. */
  workstation: LinkedWorkstation | null
  expires_at: number
  livemode: boolean
  /** Les composants que le serveur a ouverts. Vide : la page lit les cartes et fait signer, rien de plus. */
  components?: BrowserComponent[]
  /** Le praticien qui facture : nommé par le serveur, ou lu sur une CPS de la session. */
  practitioner?: string | null
}

export type WorkstationActionType = 'read_vitale' | 'read_cps' | 'secure_claim'

export type WorkstationActionStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'canceled' | 'expired'

/** Une demande au poste. `result` ne porte que des identifiants : relisez-les depuis votre serveur. */
export type WorkstationAction = {
  id: string
  object: 'workstation_action'
  type: WorkstationActionType
  status: WorkstationActionStatus
  workstation: string
  browser_session: string | null
  scenario: string | null
  claim: string | null
  result: { coverage?: string; patient?: string; practitioner?: string; claim?: string } | null
  failure_code: string | null
  failure_message: string | null
  expires_at: number
  started_at: number | null
  completed_at: number | null
  created: number
  livemode: boolean
}

/** Ce qu'il faut pour garder l'association d'une visite à l'autre. `localStorage` par défaut. */
export type LinkStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type OphelixBrowserOptions = {
  /**
   * Demande un secret de session à votre serveur, qui l'obtient par `POST /v1/browser-sessions`
   * avec sa clé secrète. Rappelée quand la session expire.
   */
  fetchClientSecret: () => Promise<string>
  /** L'adresse de l'API, sans `/browser/v1`. Par défaut, celle de production. */
  apiUrl?: string
  /** Où garder l'association au poste. `null` pour ne rien garder. */
  storage?: LinkStorage | null
  /** L'intervalle de relecture d'une demande, en millisecondes. Par défaut, 500. */
  pollInterval?: number
  /** Un autre `fetch`, pour les tests. */
  fetch?: typeof fetch
  /** @internal L'attente entre deux relectures. */
  sleep?: (milliseconds: number) => Promise<void>
}

export type ActionOptions = {
  /** En mode test, le scénario que répond le simulateur, comme `vitale_exempted`. */
  scenario?: string
  /** Annule la demande si l'agent ne l'a pas encore prise. */
  signal?: AbortSignal
  /** Suit la demande : `pending` tant que l'agent ne l'a pas prise, `in_progress` pendant la lecture. */
  onStatus?: (status: WorkstationActionStatus) => void
}

/* Ce que lisent les composants embarqués : les objets de l'API publique, réduits aux champs utiles. */

export type Patient = {
  id: string
  object: 'patient'
  first_name: string
  last_name: string
  birth_date: string
  rank: number
  quality: 'insured' | 'spouse' | 'child' | 'other'
  insured_first_name: string | null
  insured_last_name: string | null
  nir_last4: string
}

export type Coverage = {
  id: string
  object: 'coverage'
  patient: string | Patient
  source: string
  rights: 'open' | 'closed'
  regime_code: string | null
  fund_code: string | null
  center_code: string | null
  exemptions: string[]
  read_at: number | null
  valid_until: string | null
  livemode: boolean
}

export type PracticeSituation = {
  id: string
  number: number
  practice_mode: string
  structure_name: string | null
  billable: boolean
  can_sign_invoice: boolean
}

export type Practitioner = {
  id: string
  object: 'practitioner'
  identifier_type: string
  identifier: string
  first_name: string
  last_name: string
  profession: string
  specialty_code: string | null
  status: string
  situations: PracticeSituation[]
  onboarded_at: number | null
  livemode: boolean
}

export type Act = {
  nomenclature: 'ngap' | 'ccam'
  code: string
  label: string | null
  unit_price_cents: number | null
}

export type ClaimLine = {
  id: string
  nomenclature: string
  code: string
  service_date: string
  quantity: number
  amount_cents: number | null
  amo_amount_cents: number | null
  reimbursement_rate: number | null
}

export type ClaimStatus =
  | 'draft'
  | 'ready'
  | 'secured'
  | 'batched'
  | 'transmitted'
  | 'acknowledged'
  | 'paid'
  | 'partially_paid'
  | 'adjusted'
  | 'rejected'
  | 'flagged'
  | 'canceled'
  | 'reissued'

/** Ce que le praticien dit du contexte des soins. */
export type ClaimContext = {
  care_pathway?: string
  treating_doctor_declared?: string
  common_law_accident?: boolean
  common_law_accident_date?: string
}

/** Une facture telle que la page la lit : son patient, son praticien et sa couverture dépliés. */
export type Claim = {
  id: string
  object: 'claim'
  status: ClaimStatus
  number: string | null
  mode: string
  patient: string | Patient
  practitioner: string | Practitioner
  coverage: string | Coverage | null
  third_party_amo: boolean
  third_party_amc: boolean
  context: ClaimContext
  lines: ClaimLine[]
  amount_cents: number | null
  amo_amount_cents: number | null
  amc_amount_cents: number | null
  amc_pricing: { status: 'computed' | 'not_applicable' | 'unknown' } | null
  patient_amount_cents: number | null
  paid_amount_cents: number | null
  rejection_code: string | null
  ready_at: number | null
  secured_at: number | null
  transmitted_at: number | null
  acknowledged_at: number | null
  settled_at: number | null
  canceled_at: number | null
  created: number | null
  livemode: boolean
}

export type ClaimFinding = { rule: string; message: string; param: string; line: string | null }

export type ClaimValidation = {
  object: 'claim_validation'
  claim: string
  valid: boolean
  violations: ClaimFinding[]
  warnings: ClaimFinding[]
}

export type Rejection = {
  id: string
  object: 'rejection'
  status: string
  part: string | null
  code: string | null
  label: string | null
  reason: string | null
  claim_line: string | null
  comment: string | null
  created: number | null
}

/** Un acte à poser : l'API le tarife, la page n'impose pas de prix. */
export type ActLine = { nomenclature: 'ngap' | 'ccam'; code: string; service_date: string; quantity?: number }

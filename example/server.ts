/**
 * La page d'exemple et son serveur : ce qu'un intégrateur écrit. Le serveur garde la clé secrète,
 * ouvre une session pour la page, relit ce que les cartes ont donné et crée la facture avec
 * `@ophelix/node`. La page ne voit jamais de clé, et ne reçoit des cartes que des identifiants.
 *
 *   OPHELIX_SECRET_KEY=sk_test_… OPHELIX_API_URL=http://localhost:8000 bun example/server.ts
 *
 * puis http://localhost:3300, après avoir autorisé cette origine dans le tableau de bord
 * (Paramètres, Postes et lecteurs, Pages web autorisées).
 *
 * Un vrai serveur authentifie son utilisateur avant d'ouvrir une session, et range sessions,
 * praticien et factures dans sa base : celui-ci les garde en mémoire et n'écoute que sur la machine.
 */
import { join } from 'node:path'
import { Ophelix, OphelixError, type WorkstationAction } from '@ophelix/node'

const secretKey = process.env.OPHELIX_SECRET_KEY ?? ''
const apiUrl = (process.env.OPHELIX_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
const port = Number(process.env.PORT ?? 3300)
const origin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`

if (!secretKey.startsWith('sk_test_')) {
  console.error("OPHELIX_SECRET_KEY doit être une clé secrète de test, sk_test_… : l'exemple ne tourne pas en production.")
  process.exit(1)
}

const ophelix = new Ophelix(secretKey, { baseUrl: apiUrl })
const page = (await Bun.file(join(import.meta.dir, 'index.html')).text()).replace('%OPHELIX_API_URL%', apiUrl)

/** Le composant, bâti depuis les sources du dépôt : en vrai, le paquet `@ophelix/browser`. */
const built = await Bun.build({ entrypoints: [join(import.meta.dir, '..', 'src', 'index.ts')], format: 'esm', target: 'browser' })
const component = await built.outputs[0]?.text()

/** Les sessions de page que ce serveur a ouvertes : une demande venue d'ailleurs ne compte pas. */
const sessions = new Set<string>()
/** Les factures que ce serveur a créées pour la page. */
const claims = new Set<string>()
/** Le praticien qui facture depuis cette page, connu depuis la lecture de sa CPS. */
let practitioner: string | null = null

/** L'acte de l'exemple : une consultation, au prix demandé. */
const ACT = { nomenclature: 'ngap', code: 'ZC', unit_price_cents: 2650 } as const

const json = (body: unknown, status = 200) => Response.json(body, { status })
const refuse = (code: string, message: string, status: number) => json({ error: { code, message } }, status)

/** Une erreur de l'API, avec son code, pour que la page dise quoi faire. */
const failure = (error: unknown) => {
  if (error instanceof Refused) return refuse(error.code, error.message, error.status)
  return refuse(
    error instanceof OphelixError ? (error.code ?? 'api_error') : 'api_error',
    error instanceof Error ? error.message : String(error),
    502,
  )
}

class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message)
  }
}

/**
 * La page n'envoie qu'un identifiant de demande. Le serveur la relit avec sa clé, et ne la croit
 * que si elle a abouti, qu'elle est du genre attendu et qu'elle vient d'une session qu'il a ouverte.
 */
async function trustedAction(id: unknown, type: WorkstationAction['type']): Promise<WorkstationAction> {
  if (typeof id !== 'string' || !id.startsWith('wsa_')) throw new Refused('action_not_trusted', 'Une demande wsa_… est attendue.', 400)
  const action = await ophelix.workstationActions.retrieve(id)
  if (action.type !== type || action.status !== 'succeeded' || !action.browser_session || !sessions.has(action.browser_session)) {
    throw new Refused('action_not_trusted', "Cette demande n'a pas été faite par une page de ce serveur.")
  }
  return action
}

const readBody = async (request: Request): Promise<{ action?: unknown }> => (await request.json().catch(() => ({}))) as { action?: unknown }

async function describePractitioner(id: string) {
  const found = await ophelix.practitioners.retrieve(id)
  return { id: found.id, first_name: found.first_name, last_name: found.last_name }
}

Bun.serve({
  port,
  hostname: 'localhost',
  routes: {
    '/': () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    '/ophelix-browser.js': () => new Response(component, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } }),

    // La page demande une session : le serveur l'ouvre avec sa clé, pour sa propre origine.
    '/session': {
      POST: async () => {
        try {
          const session = await ophelix.browserSessions.create({ origin })
          sessions.add(session.id)
          return json({ client_secret: session.client_secret })
        } catch (error) {
          return failure(error)
        }
      },
    },

    // Le praticien qui facture : lu une fois sur sa CPS, puis gardé par le serveur.
    '/practitioner': {
      GET: async () => {
        try {
          return json({ practitioner: practitioner ? await describePractitioner(practitioner) : null })
        } catch (error) {
          return failure(error)
        }
      },
      POST: async request => {
        try {
          const action = await trustedAction((await readBody(request)).action, 'read_cps')
          practitioner = action.result?.practitioner ?? null
          return json({ practitioner: practitioner ? await describePractitioner(practitioner) : null })
        } catch (error) {
          return failure(error)
        }
      },
    },

    // Ce que la carte Vitale a donné se relit ici, côté serveur : la demande ne porte que des identifiants.
    '/patient': {
      POST: async request => {
        try {
          const action = await trustedAction((await readBody(request)).action, 'read_vitale')
          const coverage = await ophelix.coverages.retrieve(action.result?.coverage ?? '', { expand: ['patient'] })
          const patient = typeof coverage.patient === 'string' ? null : coverage.patient
          return json({
            first_name: patient?.first_name,
            last_name: patient?.last_name,
            birth_date: patient?.birth_date,
            rights: coverage.rights,
            fund_code: coverage.fund_code,
            exemptions: coverage.exemptions,
          })
        } catch (error) {
          return failure(error)
        }
      },
    },

    // La facture naît sur le serveur, pour le patient que la carte a désigné, puis se valide.
    '/claims': {
      POST: async request => {
        try {
          const action = await trustedAction((await readBody(request)).action, 'read_vitale')
          if (!practitioner) throw new Refused('practitioner_missing', 'Lisez d’abord la CPS du praticien.', 409)

          // Une clé d'idempotence par lecture : un double clic ne crée pas deux factures.
          const draft = await ophelix.claims.create(
            {
              practitioner,
              patient: action.result?.patient ?? '',
              third_party_amo: true,
              context: { care_pathway: 'treating_doctor', common_law_accident: false },
              lines: [{ ...ACT, service_date: new Date().toISOString().slice(0, 10) }],
            },
            { idempotencyKey: `exemple-facture-${action.id}` },
          )
          const claim = await ophelix.claims.finalize(draft.id, undefined, { idempotencyKey: `exemple-finalisation-${action.id}` })
          claims.add(claim.id)
          return json({ id: claim.id, status: claim.status, amount_cents: claim.amount_cents, act: ACT.code }, 201)
        } catch (error) {
          return failure(error)
        }
      },
    },

    // Après la signature par le poste, le serveur relit l'état de sa facture.
    '/claims/:id': async request => {
      try {
        if (!claims.has(request.params.id)) throw new Refused('resource_missing', "Cette facture n'a pas été créée ici.", 404)
        const claim = await ophelix.claims.retrieve(request.params.id)
        return json({ id: claim.id, status: claim.status, amount_cents: claim.amount_cents, secured_at: claim.secured_at })
      } catch (error) {
        return failure(error)
      }
    },
  },
  fetch: () => new Response('Introuvable', { status: 404 }),
})

console.log(`Page d'exemple sur ${origin}, API ${apiUrl}`)

import type { WorkstationAction } from './types'

/**
 * Une erreur du composant. `code` se compare dans votre code, le message peut changer :
 * un code d'erreur de l'API (`origin_not_allowed`, `workstation_offline`…), le code d'échec d'une
 * demande (`card_absent`, `card_unreadable`, `engine_unavailable`…), ou `expired`, `canceled`,
 * `aborted`, `network_error`.
 */
export class OphelixBrowserError extends Error {
  override readonly name = 'OphelixBrowserError'
  readonly code: string
  /** Le statut HTTP, quand l'erreur vient d'une réponse de l'API. */
  readonly status: number | null
  readonly requestId: string | null
  /** La demande, quand c'est elle qui a échoué. */
  readonly action: WorkstationAction | null

  constructor(
    code: string,
    message: string,
    details: { status?: number | null; requestId?: string | null; action?: WorkstationAction | null } = {},
  ) {
    super(message)
    this.code = code
    this.status = details.status ?? null
    this.requestId = details.requestId ?? null
    this.action = details.action ?? null
  }

  /** L'échec d'une demande qui a abouti côté API : la carte, le moteur, ou personne à temps. */
  static fromAction(action: WorkstationAction): OphelixBrowserError {
    const code = action.status === 'failed' ? (action.failure_code ?? 'failed') : action.status
    const message =
      action.failure_message ??
      (action.status === 'expired' ? "L'agent du poste n'a pas pris la demande à temps." : 'La demande a été annulée.')

    return new OphelixBrowserError(code, message, { action })
  }
}

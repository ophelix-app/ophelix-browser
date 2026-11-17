# Ophelix pour le navigateur

Le composant navigateur officiel d'[Ophelix](https://docs.ophelix.fr) : une page web lit une carte Vitale, lit une CPS ou fait signer une facture sur le poste où elle s'affiche, sans extension de navigateur.

- ESM, CommonJS et un script autonome, types TypeScript fournis.
- Aucune dépendance.
- La page ne voit jamais de clé d'API : elle travaille avec le secret d'une session que votre serveur ouvre.
- Des cartes, la page ne reçoit que des identifiants. Votre serveur relit le reste avec sa clé.

## Installation

```bash
npm install @ophelix/browser
```

Sans outil de build, le script autonome se charge depuis un CDN de npm, à une version épinglée, et pose `window.OphelixBrowser` :

```html
<script src="https://unpkg.com/@ophelix/browser@0.1.0/dist/ophelix-browser.global.js"></script>
```

Le poste, lui, a besoin de l'agent Ophelix et d'un lecteur de cartes. Rien d'autre ne s'installe.

## Comment ça passe

La page ne parle jamais à l'agent, et l'agent n'ouvre aucun port.

1. Votre serveur autorise une fois l'origine de la page, `POST /v1/browser-origins`, ou depuis le tableau de bord.
2. Votre serveur ouvre une session pour cette origine, `POST /v1/browser-sessions`, avec sa clé secrète. Il donne `client_secret` à la page.
3. La page s'associe au poste une fois, par le code que montre l'agent (Paramètres, « Associer une page web »). Le navigateur garde l'association dans `localStorage` : la visite suivante retrouve le poste sans code.
4. `readVitale()` crée une demande. L'agent du poste la relève par une connexion sortante, et la page la suit jusqu'à son terme.
5. Le résultat ne porte que des identifiants (`cov_…`, `pat_…`, `prac_…`, `clm_…`) : votre serveur les relit avec sa clé.

Le code porteur se saisit dans la fenêtre de l'agent, jamais dans la page.

## Usage

```ts
import { OphelixBrowser } from '@ophelix/browser'

const reader = OphelixBrowser.create({
  // Votre serveur ouvre la session avec sa clé secrète.
  fetchClientSecret: async () => (await (await fetch('/ophelix/session', { method: 'POST' })).json()).client_secret,
})

const session = await reader.connect()
if (!session.workstation) await reader.link(codeAfficheParLAgent)

const action = await reader.readVitale({ onStatus: status => console.log(status) })
// action.result.coverage et action.result.patient : relisez-les depuis votre serveur.
```

`readCps()`, `secureClaim('clm_…')`, `refresh()` et `forget()` complètent. `onStatus` suit la demande, et `signal` l'annule tant que l'agent ne l'a pas prise.

Avec le script autonome, `window.OphelixBrowser` est la classe elle-même : `OphelixBrowser.create(…)` s'écrit de même, et `OphelixBrowser.OphelixBrowserError` est la classe d'erreur.

## Erreurs

Un échec lève `OphelixBrowserError`. Comparez `code`, jamais le message : un code d'erreur de l'API (`origin_not_allowed`, `workstation_offline`…), le code d'échec de la demande (`card_absent`, `card_unreadable`…), ou `expired`, `canceled`, `aborted`, `network_error`.

```ts
import { OphelixBrowserError } from '@ophelix/browser'

try {
  await reader.readVitale()
} catch (error) {
  if (error instanceof OphelixBrowserError && error.code === 'card_absent') {
    // Demandez d'insérer la carte, puis relancez.
  }
}
```

## Lire, facturer, signer

La page lit et fait signer, votre serveur facture avec [`@ophelix/node`](https://www.npmjs.com/package/@ophelix/node) ou la bibliothèque PHP. Entre les deux ne passent que des identifiants :

1. `readCps()` une fois : votre serveur relit la demande et garde `result.practitioner`, le praticien qui facture.
2. `readVitale()` : la page envoie à votre serveur l'identifiant de la demande, `wsa_…`, rien d'autre.
3. Votre serveur relit la demande avec sa clé (`ophelix.workstationActions.retrieve`). Il ne la croit que si elle a abouti, qu'elle est du genre attendu et que `browser_session` est une session qu'il a ouverte. Il crée alors la facture pour `result.patient`, avec une clé d'idempotence tirée de la demande, et la valide (`finalize`) : elle est `ready`.
4. `secureClaim('clm_…')` : la CPS du poste signe, le code porteur se saisit dans la fenêtre de l'agent. Votre serveur relit la facture : `secured`.

Le parcours complet est dans le [guide des pages web](https://docs.ophelix.fr/guides/pages-web#facturer).

## La page d'exemple

Le dossier `example` du dépôt porte une page et son serveur, qui vont de la carte à la facture signée, en mode test :

```bash
bun install
OPHELIX_SECRET_KEY=sk_test_… OPHELIX_API_URL=https://api.ophelix.fr bun run example
```

puis http://localhost:3300, après avoir autorisé cette origine dans le tableau de bord. Le serveur garde la clé, retient en mémoire ses sessions, son praticien et ses factures, et refuse une demande qu'une de ses pages n'a pas faite.

## Versions

Le composant suit le versionnage sémantique. Voir [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT. Voir [LICENSE](LICENSE).

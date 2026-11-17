# Journal des versions

Ce journal suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et le composant le [versionnage sémantique](https://semver.org/lang/fr/).

## 0.1.0

Première version.

- `OphelixBrowser.create({ fetchClientSecret })` : la page travaille avec le secret de session que votre serveur ouvre, jamais avec une clé d'API.
- `connect()`, `link(code)`, `refresh()` et `forget()` : la page s'associe une fois au poste, par le code que montre l'agent, et le retrouve ensuite sans code.
- `readVitale()`, `readCps()` et `secureClaim()` : lecture d'une carte et signature d'une facture sur le poste, suivies par `onStatus`, annulables par `signal`.
- Les lectures et écritures des composants embarqués, bornées aux objets de la session : droits, praticien, actes, facture et ses lignes, contrôle, validation, rejets.
- `OphelixBrowserError`, avec un `code` stable : un code d'erreur de l'API ou le code d'échec de la demande.
- ESM, CommonJS et un script autonome qui pose `window.OphelixBrowser`. Types TypeScript fournis, aucune dépendance.

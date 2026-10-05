# Raffaillac

Frontend **TypeScript + Vite** d'Online Boardgames. TypeScript vanilla, aucun
framework (pas de React/Vue), `"type": "module"`.

Projet frère de `OBG/Chabanas` (API HTTP) et `OBG/Tourtoirac` (logique de jeu).
`src/types.ts` est le **contrat de protocole** avec `Tourtoirac` : tout
changement de payload se répercute dans les deux autres dépôts.

## Commandes

```bash
npm ci
npm run dev        # vite
npm run build      # tsc --noEmit && vite build  <-- le seul contrôle qualité
npm run preview
```

`npm run build` est le **seul** garde-fou : il exécute `tsc --noEmit` avant le
bundle. Il n'y a **ni linter, ni formateur, ni aucune CI**. Lancer `build`
après chaque modification est donc obligatoire, pas optionnel.

## Aucun test n'existe

Il n'y a **aucun fichier de test** et **aucun runner** déclaré dans
`package.json`. Ajouter un test suppose d'abord d'introduire une dépendance et
une configuration de test — ne pas supposer `npm test` disponible, et ne pas
prétendre avoir couvert une régression. La seule vérification possible est
`npm run build`.

## TypeScript est strict — ces options cassent

`tsconfig.json` porte `strict`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, `isolatedModules`, `verbatimModuleSyntax`.

- **`verbatimModuleSyntax`** : les imports de types doivent être
  `import type { Foo } from './types'`, sinon le build échoue.
- **`noUnusedLocals` / `noUnusedParameters`** : un paramètre laissé inutilisé
  casse le build. Préfixer par `_` ou supprimer.
- `moduleResolution: "bundler"` : **ne pas** ajouter d'extension `.js` aux
  imports de modules locaux.

## Disposition de `src/`

| Fichier            | Rôle |
| ------------------ | ---- |
| `game.ts`          | Orchestrateur principal (~1400 lignes) |
| `types.ts`         | Contrat de protocole — lire en premier |
| `engine/board.ts` `button.ts` `counter.ts` `counter_box.ts` `dice.ts` | Rendu des composants |
| `ws/wsClient.ts` `wsWorker.ts` | WebSocket, exécuté dans un **Worker** |
| `lobby.ts` `navigation.ts` `session.ts` | Lobby et navigation |

`game.ts` est très gros et mélange orchestration et rendu : s'y repérer avant
d'ajouter une fonctionnalité.

Deux points d'entrée HTML distincts : `index.html` (lobby) et `game.html` (partie).

## `Games/` n'est pas versionné

`.gitignore` exclut `Games/` et `Legacy/`. Les assets de jeu (plateaux, pions,
règles) sont servis depuis `/Games/` et **montés en lecture seule** dans le
conteneur. Un clone frais n'a donc pas de plateaux : les tests visuels ou
manuels en local échoueront sur des images manquantes tant que le dossier n'est
pas restauré. `Legacy/` est de l'ancien code — ne pas y toucher, ne pas y
chercher de références.

## Docker

Multi-étapes : build `node:20-alpine` (`npm ci` puis `npm run build`), puis
`nginx:alpine` qui sert `dist/`. `EXPOSE 80`, `CMD ["/entrypoint.sh"]`.

`entrypoint.sh` **refuse de démarrer nginx tant que Chabanas ne répond pas** :
il interroge `POST ${CHABANAS_URL}/game/list` avec
`{"game_name_list":["Waterloo"]}`, réessaie `CHABANAS_MAX_RETRIES` fois
(30) toutes les `CHABANAS_RETRY_INTERVAL` secondes (2), puis sort en erreur.
Un conteneur qui refuse de démarrer est donc souvent un back-end injoignable, pas
un problème de build.

`docker-compose.yml` : service `raffaillac`, port hôte `8080:80`. Le service
`chabanas` y est commenté et à activer selon le déploiement.

## Conventions

- Commentaires et docstrings **en anglais**.
- Une classe par composant de `engine/`, état mutable quand le repositionnement
  l'exige (cf. `CounterBox.x`/`.y`, modifiables pour le setup).
- `dist/` est ignoré par git — ne jamais le committer.

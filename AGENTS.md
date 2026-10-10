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
| `game.ts`          | Page de jeu : état, canvas, souris, messages serveur (~1 700 lignes) |
| `lobby.ts`         | Page de lobby : onglets de jeux, tables, modales créer/rejoindre (~700 lignes) |
| `types.ts`         | Contrat de protocole — lire en premier |
| `engine/bag.ts` `board.ts` `button.ts` `counter.ts` `counter_box.ts` `dice.ts` | Modèle et dessin des composants |
| `engine/hex_grid.ts` | Grille hexagonale d'un plateau (`grid` du `game_json`) : même calcul que `Tourtoirac/Components/hex_grid.py` |
| `ws/wsClient.ts` `wsWorker.ts` | WebSocket, exécuté dans un **SharedWorker** |
| `navigation.ts`    | URL `index.html` ↔ `game.html`, avec `?game=<nom>` pour garder l'onglet |
| `session.ts`       | `sessionStorage` : session courante (`obg_session`) et identité (`obg_player_identity`) |

Deux points d'entrée HTML distincts : `index.html` → `src/lobby.ts`, et
`game.html` → `src/game.ts` (déclarés tous deux dans `vite.config.ts`). Le
balisage et le CSS sont **dans les fichiers HTML** (`index.html` fait environ
460 lignes) ; les modules TS récupèrent les éléments par `getElementById`.

## Carte du code

### Correspondance des noms avec Tourtoirac

Les noms ne correspondent pas : c'est le piège principal.

| `kind` du `game_json` | Tourtoirac | Raffaillac | Type dans `types.ts` |
| --------------------- | ---------- | ---------- | -------------------- |
| `board`   | `Board`   | `Board` (interface, `engine/board.ts`) | `BoardItem` |
| `board_group` | `BoardGroup` | `BoardGroup` (interface, `engine/board.ts`) | `BoardGroupItem` |
| `token`   | `Token`   | **`Counter`** (classe, `engine/counter.ts`) | `TokenItem` |
| `counter` | `Counter` | **`CounterBox`** (interface, `engine/counter_box.ts`) | `CounterItem` |
| `dice`    | `Dice`    | `Dice` (classe, `engine/dice.ts`) | `DiceItem` |
| `dice_pool` | `DicePool` | `DicePool` (interface, `engine/dice.ts`) | `DicePoolItem` |
| `bag`     | `Bag`     | `Bag` (interface, `engine/bag.ts`) | `BagItem` |

Dans `game.ts`, `counters` / `countersById` / `hand` désignent donc des
**pions**, et `counterBoxes` des compteurs numériques. Partout, l'identifiant
du composant s'appelle `name` côté client et `id` / `component_id` côté
serveur.

### Connexion

- `ws/wsWorker.ts` est un **SharedWorker** : une seule WebSocket est partagée
  par tous les onglets de la même origine. Il lit `/conf.json` (`host`, `port`)
  et se reconnecte avec un délai exponentiel plafonné à 15 s.
- `ws/wsClient.ts` expose `getSocket()` → `{send, setMessageHandler,
  setStateHandler}`, en singleton sur `window.obgSocket`. Les messages reçus
  avant `setMessageHandler` sont mis en tampon.
- Le navigateur **ne parle qu'à Tourtoirac**. Aucun appel HTTP vers Chabanas
  (le seul `fetch` est celui de `conf.json` par `wsWorker.ts`).

### Parcours d'un joueur

1. **`lobby.ts` → `main()`** : à la connexion envoie `list_game`, sans
   liste de jeux : c'est Chabanas qui fournit son catalogue actif, et un onglet
   est affiché par jeu présent dans `sessions_info`. À la réponse, il envoie
   `list_sessions` et rafraîchit sur chaque `session_players_changed`.
2. Modale de création ou d'adhésion → `create_session` / `join_session`.
   Si le jeu déclare des nationalités (`GameVariantInfo.nationalities` à la
   création, `ActiveSession.nationalities` pour un nouveau joueur), un
   `<select>` obligatoire s'affiche et `nationality` part dans le message. Un
   joueur qui reprend son siège et un spectateur ne choisissent rien.
   L'identité est stockée avant même la réponse (`storePlayerIdentity`).
3. **`session_joined`** → `storeSession()` puis redirection vers
   `game.html?game=<nom>`.
4. **`game.ts`** relit la session depuis `sessionStorage`. À chaque
   (re)connexion, il envoie `resume_session` (`session_key`, `session_code`,
   `nickname`, `role`), car la page de jeu a une nouvelle connexion côté
   serveur.
5. `session_joined` → `handleSessionEvent` → `loadComponents()` (une seule
   fois) et lecture du `setup` en attente.
6. Une fois toutes les images chargées, `maybeRequestSetup()` envoie
   `apply_setup` (joueurs seulement) ; l'événement `setup` → `applySetup`.

### `game.ts` par section

Le fichier est découpé par des bandeaux `// ----` ; on les cherche par leur
titre :

| Section | Contenu |
| ------- | ------- |
| *Situation initiale* | `loadComponents` : `fixed` → `boards` (les plateaux d'un `board_group` y sont mis à plat, le groupe va dans `boardGroups`) + `counterBoxes`, `movable` → `counters` (pions), `dice` → `dices` ; les dés d'un `dice_pool` de `fixed` vont aussi dans `dices`, le groupe dans `dicePools` ; un `bag` de `fixed` va dans `bags`, ses pions dans `bag.content` et dans `countersById` mais **pas** dans `counters` (ils ne sont pas sur la table) |
| *Retournement local d'un plateau* | Retournement à 180° **local au joueur** (jamais envoyé au serveur). Seul un `board_group` `flippable` se retourne (`BoardGroup.flipped`), jamais un plateau seul. Un bouton par groupe ; le demi-tour se fait autour du centre de `flipArea(group)` (rectangle englobant), et tout ce qui est posé dans ce rectangle suit (`flippedGroupAt`, `displayTopLeft`) |
| (après `applyRoll`) | Bouton « roll » d'un `dice_pool` (`rollPlates`, `placeRollButton`) : en pixels d'écran, posé juste au-dessus du rectangle englobant les dés, masqué pour un spectateur, assombri tant qu'un dé du groupe est dans son délai. `requestRollPool` envoie `roll_pool`, `applyRollPool` applique toutes les faces |
| *Caméra*, *Défilement au bord* | `cameraX/Y`, `zoom`, `screenToWorld` / `worldToScreen`, défilement au bord de l'écran |
| *Main* | `hand` (pions tenus), `pending` (requête `acquire`/`release` en vol, délai `RESPONSE_TIMEOUT`), `flushMoves` |
| *Main* (fin) | Sac : `requestPick` envoie `pick` (avec un `request_id`), `applyPick` remet le pion tiré dans `counters` et, pour celui qui a cliqué, dans `hand`, sous le pointeur ; `putInBag` retire de la table un pion relâché sur un sac (`release` avec `bag_id`) |
| *Souris* | `onMouseDown` / `Move` / `Up` : **bouton gauche** = clic sur une zone de rotation, de compteur, de dé, d'un pion ou d'un sac → `request*` ; **bouton droit enfoncé** = déplacement de la caméra (seul moyen, menu contextuel désactivé sur le canvas) ; bouton central ignoré |
| *Hex grid* | Aperçu de l'hexagone visé par un pion tenu (`predictedHex`, miroir de `Session.snap_to_grid`), grille de calibrage affichée par la touche **G** avec la position du pointeur relative au plateau |
| *Dessin* | `draw()` : plateaux, compteurs, sacs (avec le nombre de pions restants), dés, pions, boutons, infobulles |
| *Messages du serveur Tourtoirac* | `handleServerMessage` : une branche `if/else` par `event` → fonctions `apply*` |
| *Mise en place du jeu* | `allComponentsLoaded`, `maybeRequestSetup`, `applySetup`, `handleSessionEvent` |
| *Initialisation* | Liens retour au lobby et clôture (owner), `onCloseSession` |
| *Boucle du jeu*, *Événements* | `requestAnimationFrame(gameLoop)` : défilement, `draw`, `flushMoves` ; écouteurs canvas |

Convention : `requestX()` envoie l'action, `applyX(event)` applique la
réponse diffusée. Le client n'applique **rien** de manière optimiste, sauf le
déplacement d'un pion tenu (envoyé à chaque frame par `flushMoves`) et le
retournement local d'un `board_group`.

### Nationalités

Facultatif. Seule règle : un pion qui porte une nationalité n'est pris que par
un joueur de cette nationalité. Le serveur fait foi (erreur
`wrong_nationality`) ; `canAcquire` dans `game.ts` évite seulement la requête,
pour `requestAcquire` comme pour `requestPick`, et le dit dans le bandeau
d'info. Le serveur annonce la
nationalité du siège dans `session_joined` (`myNationality` dans `game.ts`,
affichée dans le bandeau après le pseudo) ; le lobby l'affiche après chaque
pseudo. `Counter.nationality` reprend celle du pion (`TokenItem.nationality`),
`Session.player_nationalities` celle de chaque siège : c'est là que viendront
se brancher les règles.

### Ajouter un type de composant

1. `types.ts` : interface `XxxItem` avec `kind: "xxx"`, à ajouter à
   `SessionComponents`.
2. `engine/xxx.ts` : modèle et dessin.
3. `game.ts` : chargement dans `loadComponents`, dessin dans `draw`, clic dans
   `onMouseDown`, chargement des images dans `allComponentsLoaded` (sinon le
   setup part trop tôt).
4. Tourtoirac : `case` dans `Session.load_session_components`, classe dans
   `Components/`.

## `Games/` n'est pas versionné

`.gitignore` exclut `Games/` et `Legacy/`. Les assets de jeu (plateaux, pions,
règles) sont servis depuis `/Games/` et **montés en lecture seule** dans le
conteneur. Un clone frais n'a donc pas de plateaux : les tests visuels ou
manuels en local échoueront sur des images manquantes tant que le dossier n'est
pas restauré. `Legacy/` est de l'ancien code — ne pas y toucher, ne pas y
chercher de références.

## Docker

Multi-étapes : build `node:20-alpine` (`npm ci` puis `npm run build`), puis
`nginx:alpine` qui sert `dist/`. `EXPOSE 80`, avec le `CMD` par défaut de
l'image nginx.

Le conteneur ne dépend d'**aucun** autre service : il ne sert que des fichiers
statiques et démarre même si Chabanas ou Tourtoirac sont arrêtés. C'est
Tourtoirac qui attend Chabanas avant d'accepter des connexions (voir
`Tourtoirac/AGENTS.md` § Démarrage). Ne pas réintroduire de vérification de
Chabanas ici : le navigateur ne lui parle jamais.

`docker-compose.yml` : service `raffaillac`, port hôte `8080:80`. Le service
`chabanas` y est commenté et à activer selon le déploiement.

## Conventions

- Commentaires et docstrings **en anglais**.
- Une classe par composant de `engine/`, état mutable quand le repositionnement
  l'exige (cf. `CounterBox.x`/`.y`, modifiables pour le setup).
- `dist/` est ignoré par git — ne jamais le committer.

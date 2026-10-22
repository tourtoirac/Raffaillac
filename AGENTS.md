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
| `activeGames.ts`   | Page `parties.html` (lien « Parties en cours » du lobby) : les parties en cours (au moins un joueur connecté), tous jeux confondus (Air Force compris), compteur `active_games` / `max_active_games` de `sessions_info` ; le lobby grise Create, Join et Spectateur quand la limite est atteinte |
| `sessionList.ts`   | Recherche par code ou pseudo (`matchesSearch`) et pagination à 10 sessions (`Pager`, une page par jeu), pour le lobby et `parties.html` |
| `types.ts`         | Contrat de protocole — lire en premier |
| `engine/bag.ts` `board.ts` `button.ts` `counter.ts` `counter_box.ts` `dice.ts` `mw_character.ts` | Modèle et dessin des composants |
| `engine/hex_grid.ts` | Grille hexagonale d'un plateau (`grid` du `game_json`) : même calcul que `Tourtoirac/Components/hex_grid.py` |
| `ws/wsClient.ts` `wsWorker.ts` | WebSocket, exécuté dans un **SharedWorker** |
| `voice.ts`         | Salon audio : WebRTC entre joueurs (`VoiceChat`), relayé par Tourtoirac |
| `chat.ts`          | Chat texte (`ChatPanel`) : canal général et canaux privés entre joueurs |
| `gameLock.ts`      | Une seule page de jeu par navigateur (Web Lock `obg_game`) |
| `idle.ts`          | Déconnexion d'un joueur inactif (popups, minuterie) |
| `serverErrors.ts`  | Texte des erreurs `invalid_component` (composant du `game_json` mal décrit) et `server_full` (plateforme pleine), affichés par le lobby et la page de jeu |
| `navigation.ts`    | URL `index.html` ↔ `game.html`, avec `?game=<nom>` pour garder l'onglet |
| `session.ts`       | `sessionStorage` : session courante (`obg_session`) et identité (`obg_player_identity`) |

Trois points d'entrée HTML distincts : `index.html` → `src/lobby.ts`,
`game.html` → `src/game.ts` et `parties.html` → `src/activeGames.ts` (déclarés
dans `vite.config.ts` et copiés par le `Dockerfile`). Le
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
| `counter` | `Counter` | **`CounterBox`** (interface, `engine/counter_box.ts`) ; `text` dessiné au-dessus de la valeur dans la moitié haute (police ajustée, coupure à un espace si elle grandit le texte), cadre `border` intérieur) | `CounterItem` |
| `dice`    | `Dice`    | `Dice` (classe, `engine/dice.ts`) | `DiceItem` |
| `dice_pool` | `DicePool` | `DicePool` (interface, `engine/dice.ts`) | `DicePoolItem` |
| `bag`     | `Bag`     | `Bag` (interface, `engine/bag.ts`) | `BagItem` |
| `deck`    | `Deck`    | `Deck` (interface, `engine/deck.ts`) | `DeckItem` |
| `stack`   | `Stack`   | `Deck` avec `isStack` (`engine/deck.ts`) | `DeckItem` (`kind: "stack"`) |
| `card`    | `Card`    | `Counter` avec `isCard` | `TokenItem` (`kind: "card"`) |
| `mw_character` | `MwCharacter` | `MwCharacter` (interface, `engine/mw_character.ts`) | `MwCharacterItem` |
| `generator` | `Generator` | aucun objet du moteur : colonne HTML `#generators` (`renderGenerators`) | `GeneratorItem`, `GeneratorModel` |

Dans `game.ts`, `counters` / `countersById` / `hand` désignent donc des
**pions**, et `counterBoxes` des compteurs numériques. Partout, l'identifiant
du composant s'appelle `name` côté client et `id` / `component_id` côté
serveur.

### Connexion

- `ws/wsWorker.ts` est un **SharedWorker** : une seule WebSocket est partagée
  par tous les onglets de la même origine. Il lit `conf.json` sous le chemin
  public du build (`import.meta.env.BASE_URL`) et se reconnecte avec un délai
  exponentiel plafonné à 15 s. Deux formes de `conf.json` : `host` + `port`
  → `ws://host:port` (local), ou `path` → même hôte que la page, en `wss://`
  si elle est servie en https (derrière un reverse proxy, ex. `/obg/ws`).
- Chemin public : `OBG_BASE` au build (`vite.config.ts`, `ARG` du
  `Dockerfile`), `/` par défaut, `/obg/` en production. Les `src` des
  `game_json` restent des chemins absolus `/Games/...`, hors de ce préfixe.
- `ws/wsClient.ts` expose `getSocket()` → `{send, drop, setMessageHandler,
  setStateHandler}`, en singleton sur `window.obgSocket`. Les messages reçus
  avant `setMessageHandler` sont mis en tampon.
- **Une seule partie par navigateur** (`gameLock.ts`) : la WebSocket étant
  partagée, deux onglets en jeu ne feraient qu'une connexion pour le serveur.
  `game.ts` prend le verrou `obg_game` avant d'ouvrir sa connexion
  (`startConnection`) ; sans lui, la page affiche le motif et n'envoie rien.
  `lobby.ts` refuse `create_session` / `join_session` tant que le verrou est
  tenu, et ignore un `session_joined` qu'il n'a pas demandé
  (`openingGameName` à `null`) : il vient d'un autre onglet. Le verrou tombe
  seul à la fermeture de l'onglet. Hors contexte sécurisé (ni https ni
  localhost), l'API n'existe pas et le garde-fou est inactif.
- **Joueur inactif** (`idle.ts`, branché par `game.ts` une fois le verrou
  pris) : après 5 min sans activité (`IDLE_WARNING_MS`), un popup « Pas
  d'activités dans le jeu depuis 5 minutes » avec un bouton OK, qui compte
  comme une activité. Sans réponse en 1 min (`IDLE_DISCONNECT_MS`),
  `disconnectForInactivity` quitte le salon audio et envoie `drop` au worker,
  qui ferme la WebSocket : Tourtoirac retire le joueur de la session
  (`delete_user`), comme à la fermeture de l'onglet ; le siège reste. Le
  worker se reconnecte pour les autres onglets, mais la page ne renvoie plus
  `resume_session` (`idleDisconnected`) et propose « Revenir dans la partie »
  (rechargement) ou « Retour au lobby ». Activités : déplacement de la
  souris sur le canvas, clic, touche, molette, **seulement si l'onglet a le
  focus** (`document.hasFocus()` et onglet visible). Sont surveillés les
  joueurs d'une partie démarrée (`isStarted`), ni une partie close, ni
  l'attente des autres joueurs. **Spectateur inactif** : un spectateur n'est
  surveillé que s'il est seul, sans aucun joueur connecté (`participants`) ;
  il garde alors à lui seul la session chargée dans Tourtoirac. Le popup
  arrive après 1 h (`WATCHER_IDLE_WARNING_MS`, message « depuis 1 heure »),
  puis même déconnexion en 1 min. À côté de joueurs, un spectateur n'est
  jamais déconnecté. Les échéances sont comparées à l'horloge :
  un onglet en arrière-plan, dont les minuteries sont ralenties, est
  déconnecté à peu près à l'heure.
- Le navigateur **ne parle qu'à Tourtoirac**. Aucun appel HTTP vers Chabanas
  (le seul `fetch` est celui de `conf.json` par `wsWorker.ts`). Seule
  exception : l'onglet Air Force, qui parle à Hautefort (voir § Lobby).

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
   fois) et lecture du `setup` en attente. La session de `sessionStorage` ne
   sert qu'à précharger les images : c'est un instantané du dernier message
   de session, antérieur au setup et aux coups joués depuis. La situation
   affichée est **toujours** celle de la réponse à `resume_session`
   (`componentsLoaded` reste `false` au chargement de la page), sinon un
   rechargement (F5, « Revenir dans la partie ») montre la table d'avant le
   setup et perd la main privée.
6. Une fois toutes les images chargées, `maybeRequestSetup()` envoie
   `apply_setup` (joueurs seulement) ; l'événement `setup` → `applySetup`.
   Un pion ou une carte qu'un `randomizer` du setup sort d'un sac ou d'un
   paquet y arrive avec sa description complète : `applySetup` crée la carte
   inconnue (`createCounter`), retire le pion de `bag.content`, l'ajoute à
   `counters` et applique son `orientation` ; le paquet concerné suit dans la
   même liste et passe par `refreshDeck`. Une carte qu'un randomizer pose sur
   un deck ou un stack arrive sans position : `applySetup` la retire de la
   table (`putInBag(counter, undefined)`).

### `game.ts` par section

Le fichier est découpé par des bandeaux `// ----` ; on les cherche par leur
titre :

| Section | Contenu |
| ------- | ------- |
| *Situation initiale* | `loadComponents` : `fixed` → `boards` (les plateaux d'un `board_group` y sont mis à plat, le groupe va dans `boardGroups`) + `counterBoxes`, `movable` → `counters` (pions), `dice` → `dices` ; les dés d'un `dice_pool` de `fixed` vont aussi dans `dices`, le groupe dans `dicePools` ; un `bag` de `fixed` va dans `bags`, ses pions dans `bag.content` et dans `countersById` mais **pas** dans `counters` (ils ne sont pas sur la table) |
| *Retournement local d'un plateau* | Retournement à 180° **local au joueur** (jamais envoyé au serveur). Seul un `board_group` `flippable` se retourne (`BoardGroup.flipped`), jamais un plateau seul. Un bouton par groupe ; le demi-tour se fait autour du centre de `flipArea(group)` (rectangle englobant), et tout ce qui est posé dans ce rectangle suit (`flippedGroupAt`, `displayTopLeft`) |
| (après `applyRoll`) | Bouton « roll » d'un `dice_pool` (`rollPlates`, `placeRollButton`) : en pixels d'écran, posé juste au-dessus du rectangle englobant les dés, masqué pour un spectateur, assombri tant qu'un dé du groupe est dans son délai. `requestRollPool` envoie `roll_pool`, `applyRollPool` applique toutes les faces |
| *Caméra*, *Défilement au bord* | `cameraX/Y`, `zoom`, `screenToWorld` / `worldToScreen`, défilement au bord de l'écran |
| *Main* | `hand` (pions tenus), `pending` (requête `acquire`/`release` en vol, délai `RESPONSE_TIMEOUT`), `flushMoves`. **Glisser-déposer** : `dragging` vaut vrai tant que le bouton gauche tient la main ; elle ne suit le pointeur que dans ce cas. `releaseOnArrival` : le bouton est remonté avant la réponse à l'`acquire` ou au `pick`, le pion est reposé dès qu'il arrive. `grabbedName` / `grabWorld*` : le pion rattrape le pointeur à la réponse de l'`acquire`. **Appui long** (`LONG_PRESS_MS`, sans bouger de plus de `LONG_PRESS_SLACK` px) : `grabStack` demande tous les autres pions sous le point d'appui (`countersAt`), suivis dans `stackRequests` puisque `pending` ne suit qu'une requête ; `hand` reste triée dans l'ordre de dessin (`sortHand`) pour que la pile soit dessinée et reposée dans son ordre. Pendant le transport, `fanStack` décale chaque pion sous le pion du dessus (`handAnchor`) de `STACK_FAN_STEP` px par rang (`STACK_FAN_MAX` rangs au plus) : les `move` diffusent cet escalier. Au lâcher (`dropHand`), `fanStack(true)` recentre toute la pile sur le pion du dessus avant les `release` ; un pion de la pile acquis après le lâcher est reposé au même centre (`stackDrop`) |
| *Main* (fin) | Sac : `requestPick` envoie `pick` (avec un `request_id`), `applyPick` remet le pion tiré dans `counters` et, pour celui qui a cliqué, dans `hand`, sous le pointeur ; `putInBag` retire de la table un pion relâché sur un sac (`release` avec `bag_id`) |
| *Generators* (dans la section de la main privée) | Colonne `#generators` de `game.html` (50 px, collée à gauche de `#participants`, masquée sans générateur) : un `<img>` par modèle, sur la face de son `side` (le serveur n'envoie que celle-là). Comme une carte de la main privée : bouton gauche enfoncé sur un modèle → `armedModel` (jamais pour un spectateur ni une partie close) ; le pointeur qui atteint la table, bouton toujours enfoncé → `requestGenerate` (`generate` avec `request_id`, `pending` `"generate"`) ; l'événement `generate` passe par `applyPick` (la copie inconnue est créée par `createCounter`). Au lâcher au-dessus de la colonne (`overGenerators`), `dropHand(false, null, true)` envoie chaque `release` avec `generator: true` ; un `release` qui porte `generator_id` retire la copie de `counters` et de `countersById`. La colonne s'éclaire (`drop-target`) pendant qu'on y porte des pions |
| *Souris* | `onMouseDown` / `Move` / `Up` : **bouton gauche** = clic sur une zone de rotation, de compteur ou de dé → `request*` ; bouton gauche **enfoncé** sur un pion → `requestAcquire` (sur un sac → `requestPick`), déplacement tant qu'il reste enfoncé, bouton **relâché** → `dropHand` → `requestRelease` (`mouseup` écouté aussi sur `window`). Une main restée pleine sans bouton enfoncé (session reprise) est reprise par le prochain appui ; **bouton droit enfoncé** = déplacement de la caméra (seul moyen, menu contextuel désactivé sur le canvas) ; bouton central ignoré |
| *Hex grid* | Aperçu de l'hexagone visé par un pion tenu (`predictedHex`, miroir de `Session.snap_to_grid`), grille de calibrage affichée par la touche **G** avec la position du pointeur relative au plateau |
| *Dessin* | `draw()` : plateaux, compteurs, sacs (avec le nombre de pions restants), dés, pions, boutons, infobulles |
| *Stack preview* | `drawStackPreview` : fenêtre en pixels d'écran ouverte au survol d'au moins deux pions superposés (`countersAt`), qui les montre dans l'ordre de la pile (voir aussi `revealsFront`, § Nationalités). `drawStackCount` y ajoute, à cheval sur le bord haut à droite, une pastille avec le nombre de pions de la pile (même aspect que `.hand-count` de `game.html`) |
| *Messages du serveur Tourtoirac* | `handleServerMessage` : une branche `if/else` par `event` → fonctions `apply*` |
| *Mise en place du jeu* | `allComponentsLoaded`, `maybeRequestSetup`, `applySetup`, `handleSessionEvent` |
| *Loading overlay* | Voile `#loading-overlay` de `game.html` par-dessus le canvas : `componentImages` (liste unique des images attendues, aussi utilisée par `allComponentsLoaded`), `updateLoadingOverlay` appelé à chaque frame jusqu'à ce que la session soit reçue, les images chargées et le setup appliqué (attente du setup plafonnée à `SETUP_WAIT_MS`). Premier chargement seulement |
| *Initialisation* | Liens retour au lobby et clôture (owner), `onCloseSession` |
| *Boucle du jeu*, *Événements* | `requestAnimationFrame(gameLoop)` : défilement, `draw`, `flushMoves` ; écouteurs canvas |

Convention : `requestX()` envoie l'action, `applyX(event)` applique la
réponse diffusée. Le client n'applique **rien** de manière optimiste, sauf le
déplacement d'un pion tenu (envoyé à chaque frame par `flushMoves`) et le
retournement local d'un `board_group`.

### Nationalités

Facultatif. Seule règle : un pion qui porte une nationalité n'est touché que
par un joueur de cette nationalité. Le serveur fait foi (erreur
`wrong_nationality`) ; `canAcquire` dans `game.ts` évite seulement la requête
et le dit dans le bandeau d'info.

**Toute règle qui interdit de prendre un pion interdit aussi de le tourner et
de le retourner** : `modificationRefused` (miroir de `refuse_modification` de
Tourtoirac) est appelé par `requestAcquire`, `requestRotate` et `requestFlip`.
Une nouvelle règle s'ajoute là, pas dans chaque `request*`. Les zones de
rotation ne s'affichent pas sur un pion qu'on ne peut pas toucher.

Regard sur un pion retourné (`revealsFront`, section *Stack preview* de
`game.ts`) : un joueur qui survole un pion **de sa nationalité** posé sur son
dos voit sa face avant dans la fenêtre de survol, sur son écran seulement
(`Counter.drawFront`). Un pion seul ouvre une fenêtre avec sa face ; dans une
pile, une ligne de faces s'ajoute sous chaque ligne de pions. Jamais pour un
spectateur. C'est un affichage local : rien n'est envoyé au serveur.

Face cachée : Tourtoirac n'envoie la face qu'un pion à nationalité ne montre
pas qu'aux joueurs de cette nationalité ; les autres reçoivent `front_src` ou
`back_src` à `null`. `createCounter` met alors le dos à la place de la face
avant, et `Counter.setFaces` charge la vraie image quand un `flip`, un `setup`
ou un `pick` la révèle (d'où `frontImage` / `backImage` modifiables). Ne pas
supposer qu'un `TokenItem` porte ses deux images.

Avec `options.anonymous_id`, l'`id` des pions est un uuid tiré par le serveur :
ne rien déduire d'un `id` côté client.

`options.component_id_display` à `false` masque le nom et la position des
pions dans le bandeau d'info (`showComponentId` dans `game.ts`, lu dans
`handleSessionEvent`). Absent ou `true`, le bandeau s'affiche comme avant. Les
messages de refus (« Pion réservé à … ») restent affichés, sans le nom. C'est
un réglage purement client : Tourtoirac transmet `options` tel quel.

Le bandeau d'info en haut du canvas a deux sources. `counterInfoText` (nom et
position du pion en main ou relâché, vide si les id sont masqués) y reste en
permanence. Tout autre message passe par `showInfoMessage` : il s'affiche
par-dessus pendant `INFO_MESSAGE_MS` (5 s) après le dernier message, puis le
bandeau revient à `counterInfoText`, ou disparaît s'il est vide.

Lobby : `#type-tabs` porte un onglet horizontal par type de jeu
(`GAME_TYPES` dans `lobby.ts` : `Boardgame`, `Wargame`). Le type vient de
`GameInfo.type`, défini dans Chabanas ; absent, le jeu est rangé en `Wargame`.
Les onglets de jeux (`#tabs-container`) ne listent que les jeux du type
affiché (`visibleGameNames`). L'onglet courant est gardé dans `?type=` ; sans
ce paramètre, c'est le type du jeu de `?game=` qui est affiché.

Onglet **Air Force** (`airForceLobby.ts`, clé `air_force`, type Wargame) :
Air Force ne se joue pas sur la table OBG mais dans le service `OBG/Hautefort`.
L'onglet n'apparaît que si Hautefort répond (WebSocket `hautefort/ws/lobby`,
qui pousse la liste des parties à chaque changement) ; il est ajouté par
`offeredGameNames` et rendu par `renderAirForceTab` dans `renderAll`. Création,
adhésion, reprise d'un siège déconnecté et spectateur passent par l'API REST
de Hautefort (`hautefort/api/...`, même origine), avec les mêmes champs que les
modales OBG (pseudo, clé d'utilisateur, clé d'accès). Le jeton de siège rendu
est rangé dans `sessionStorage["hautefort_seats"]` puis la page part sur
`hautefort/?game=<id>`. Pas de `gameLock` : Hautefort a ses propres sockets.
Le nginx de l'image (`nginx/default.conf`) relaie `/hautefort/` vers
`obg-hautefort:8000`, préfixe retiré et WebSockets comprises (résolution DNS
à la requête : le lobby reste servi si Hautefort est arrêté) ; `npm run dev`
fait de même vers `localhost:12210` (`vite.config.ts`).

Journal des messages du lobby (`#status-container`) : masqué dans `index.html`
(`hidden`), `lobby.ts` ne l'affiche que si la page est servie depuis
`localhost`, `127.0.0.1` ou `[::1]` (`LOCAL_HOSTNAMES`) ; jamais en production.

Guide utilisateur du lobby : `public/guide_lobby.pdf`, ouvert dans un nouvel
onglet par le lien `#help-link` (« Aide (PDF) », en haut à droite de
`index.html`, chemin relatif pour suivre `OBG_BASE`). Il est généré par
`docs/guide_lobby.py` (fpdf2, hors dépendances du projet :
`pip install --target <dir> fpdf2` puis `python3 docs/guide_lobby.py <dir>`).
Le régénérer quand le comportement du lobby change.

`options.border_shift` : seul `true` active le défilement de la vue quand le
pointeur approche d'un bord de l'écran (`borderShiftEnabled`, testé dans
`stepEdgeScroll`). Absent ou autre valeur, la vue ne bouge qu'au bouton droit.
Réglage purement client. Les bandes (`EDGE_BAND`, 90 px) longent le canvas,
sauf quand un panneau le sépare du bord de la page (`edgeArea`) : avec la main
privée affichée, le bord bas est le bas de la page, sous la main ; avec la
liste des participants, le bord droit est la droite de la page. Ces deux bords
ont une bande étroite (`EDGE_PANEL_BAND`, 24 px), pour qu'on puisse porter une
carte dans la main ou sur un nom sans faire défiler la vue. Le pointeur est donc
suivi sur toute la page (`onWindowMouseMove` → `trackPointerForEdgeScroll`), et
seul le fait de quitter la page arrête le défilement.

L'ordre de `#participants` est celui du serveur (ordre d'arrivée des joueurs,
ou celui choisi par l'owner) : le lecteur n'est plus placé en tête. L'owner
d'une partie non close déplace le nom d'un joueur par glisser-déposer HTML5
(`makeParticipantSortable`, `draggedParticipant`) ; le dépôt envoie
`order_players` avec la liste complète (`requestPlayerOrder`), et le
`session_status` renvoyé redessine la liste sur tous les écrans.

Un œil (`Common/resources/eye.svg`, `followEyeButton`) suit le nom de chaque
autre joueur. Le cliquer envoie `follow` et centre la caméra, à chaque image
(`followView`), sur la vue que ce joueur annonce (`view`, `applyView`) ; le
recliquer rend la caméra (`stopFollowing`). Pendant le suivi, la molette
zoome autour du centre de l'écran, le bouton droit et le défilement au bord
ne déplacent plus la vue. Un joueur n'envoie le centre de sa vue que
s'il est suivi (`followers`, lu dans la `Session` puis dans l'événement
`followed`, `applyFollowed`). L'œil d'un joueur qui suit le lecteur est
désactivé : deux joueurs ne se suivent jamais l'un l'autre : `sendView`, coordonnées logiques arrondies,
au plus toutes les 50 ms et seulement s'il a changé, ou aussitôt pour un
nouveau suiveur. Chez le suiveur, la caméra ne saute pas sur le centre reçu :
`followShown` glisse vers `followedView` à chaque image (lissage exponentiel de
constante `FOLLOW_SMOOTHING_S`, indépendant de la fréquence d'affichage) ; le
premier centre reçu est montré d'emblée. Un joueur suivi qui quitte la partie ou se
déconnecte (`connected` faux) n'est plus suivi, même s'il revient. Une déconnexion du
lecteur coupe aussi le suivi : `handleSessionEvent` l'oublie à la reprise.

`#participants`, à droite de la table, liste les pseudos de la partie d'après
`participants` (`Session` et événement `session_status`, renvoyé par
Tourtoirac à chaque arrivée ou départ) : les
sièges, puis les spectateurs. Couleurs dans `game.html` : joueur à la table en
vert, joueur absent (`.absent`) en rouge, spectateur en bleu.

Salon audio (`voice.ts`, section *Voice channel* de `game.ts`) : en haut de
`#participants`, `#voice-controls` (masqué pour un spectateur et une partie
close) porte « Rejoindre l'audio » / « Quitter l'audio » et le bouton du micro.
`VoiceChat.join` ouvre le micro (`getUserMedia`, **contexte sécurisé
obligatoire** : https ou localhost, sinon bouton désactivé) puis envoie
`voice_join` ; `voice_joined` → `onJoined` appelle chaque `peers` (offre
WebRTC) ; `voice_signal` → `onSignal` (offre, réponse, candidats mis en
attente tant que la description distante manque) ; `voice_members` →
`setMembers` raccroche ceux qui sont partis. Couper le micro désactive la
piste locale, sans renégociation ; le serveur n'en sait rien. Un point devant
le pseudo marque un joueur du salon, allumé quand il parle (analyseur Web
Audio, `SPEAKING_LEVEL`) ; `refreshVoiceDots` les allume sur place sans
reconstruire la liste. À chaque `session_joined` (reconnexion), `rejoin`
renvoie `voice_join` : la nouvelle connexion est hors du salon. `pagehide`
envoie `voice_leave`. Les `voice_signal` ne sont pas journalisés.

Chat texte (`chat.ts`, section *Text chat* de `game.ts`) : `#chat-panel`,
en bas de la colonne `#participants` (largeur fixe de 300 px, colonne flex :
la liste défile seule au-dessus du chat, qui garde 280 px de haut). Un pseudo
trop long est tronqué (`.participant-name`, `.chat-author`, onglets), entier
dans le `title`.
Onglet « Général » pour tous, plus un onglet par autre joueur pour un joueur
(`setPartners`, recalculé à chaque liste de participants ; un spectateur n'a
que le général, qu'il **lit sans écrire** : pas de zone de saisie,
`setWritable`, et Tourtoirac refuse son `chat_send` ; un canal privé déjà
rempli garde son onglet). `chat_send`
`{text, to?}` part au submit ; l'événement `chat` → `receive`, dédoublonné
par `id` avec l'historique `session.chat` (`setHistory`). Compteur de non-lus
par onglet, et sur le bouton ▼/▲ qui réduit la fenêtre. Le texte est posé en
`textContent`, jamais en HTML. Les raccourcis clavier ignorent la saisie.

Avec la main privée, chaque joueur de `#participants` a une icône de main de
cartes avant son pseudo (`.hand-icon`, `Common/resources/hand_cards.svg`
importé en `?raw` pour prendre la couleur du nom). Un joueur dont l'entrée de
`participants` porte `icon` (clé `player_icons` du jeu) a cette image à la
place (`.player-icon`), main privée ou non. Le pseudo d'un **autre**
joueur (`li.hand-receiver`, `data-nickname`) reçoit un objet relâché dessus
(`receiverAt`, allumé par `highlightReceiver` pendant le transport) : un
pion tenu depuis la table part en `release` avec `hand: true` et `to_player`
(`dropHand(true, receiver)`) ; un objet du bandeau ou de sa zone montrée part
en `give` (`requestGive`), et l'événement `give` passe par `applyGive`.

Montrer des cartes de sa main, seulement si
`options.private_hand.show_hands_to_other_players` vaut `true`
(`showHandsEnabled`) : `#show-hands-select`, à droite du bandeau, liste « All
players » et les autres joueurs (`renderShowSelect`, depuis `participants`) ;
un choix envoie `show_open`. Les zones (`#show-zones`, une `.show-zone` par
joueur qui montre, `renderShowZones`) recouvrent le bas de la table, juste
au-dessus du bandeau, pour que le pointeur ne passe pas par le canvas (ce qui
jouerait la carte). Relâcher un objet du bandeau sur `#my-show-zone` envoie
`show_add` (`onMouseUp`, `armedHandItem`) ; le bouton Close envoie
`show_close`. L'événement `show` (`applyShow`, `showsByOwner`) et
`session.shows` disent ce que le lecteur lit ; les cartes montrées par le
lecteur (`component_ids`) restent dans `myHand` mais sont retirées du bandeau
(`myShownIds`). Un double-clic dans sa propre zone retourne la carte. Chaque
carte d'une zone porte son rang (`numberedShowItem`), le même chez le
propriétaire et chez ses lecteurs : c'est `ShowEvent.ranks`, donné par
Tourtoirac quand la carte est montrée. Un rang ne change pas quand une autre
carte sort de la zone, et n'est pas redonné ; il repart à 1 à la fermeture de
la zone (`showRank` prend la position si `ranks` manque). Le propriétaire
attrape une carte de sa zone comme une carte du bandeau (`armedHandItem`) :
amenée sur la table, elle est jouée (`take`) ; relâchée sur le bandeau, elle
y redevient cachée (`show_remove`, `onMouseUp`).

Main privée, seulement si `options.private_hand` est un objet, même vide `{}`
(`null` ou absent : pas de main ; `isPrivateHand`)
(`privateHandEnabled`) ; sinon le bandeau est caché et le survol d'un pseudo
n'ouvre pas `#hand-preview`. `#private-hand`, bandeau en bas de page réservé aux joueurs,
montre `myHand` (les pions que le lecteur garde hors de la table), chacun
sur sa face courante (`counter.image`) : une carte entre en main face visible,
et un double-clic sur un objet du bandeau le retourne (`requestHandFlip`,
action `flip` ; le serveur ne répond qu'au détenteur, `applyFlip` redessine
le bandeau). L'icône `#flip-hand-button`, à gauche du bandeau, retourne
d'un coup toutes les cartes qu'il montre (`requestHandFlipAll` : un `flip` par
carte, les cartes montrées aux autres joueurs restent telles quelles) ; elle
est grisée quand le bandeau n'a rien à retourner. Son image,
`OBG/Common/resources/flip_hand.svg`, est importée par `game.ts` hors du dépôt
(voir § Docker). L'objet est rejoué sur la face qu'il montre dans le bandeau. Relâcher un pion au-dessus du bandeau envoie `release` avec
`hand: true` (`dropHand(toHand)`) ; presser un pion du bandeau puis amener le
pointeur sur la table envoie `take` (`armedHandItem` → `requestTake`), et sa
réponse est traitée par `applyPick`, comme un tirage dans un sac. Un simple
clic ne joue rien. Le survol d'un objet du bandeau affiche son image en
taille réelle (1:1, réduite seulement si la page est trop petite) au-dessus
du pointeur (`#hand-zoom`, `showHandZoom`). `handsByNickname` (`hands` de la session et des événements
`release` / `take` / `give`) donne le nombre affiché à côté de chaque pseudo et les dos
montrés dans `#hand-preview` au survol du pseudo d'un autre joueur. Attention :
`hand` désigne ailleurs dans `game.ts` les pions tenus à la souris.

Paquets de cartes : un `deck` de `fixed` va dans `decks` (`engine/deck.ts`).
Le client **n'a pas les cartes** : il ne connaît de chaque pile que `count` et
l'image du dessus, relus par `refreshDeck` à chaque `deck_json` reçu
(`release` avec `deck_id`, `draw`, `shuffle`, `refill`). Un clic sur une pile
envoie `draw` (`requestDraw`), dont la réponse passe par `applyPick` comme un
tirage dans un sac ; les boutons « Shuffle » et « Refill », dessinés sous les
piles en coordonnées monde et réservés aux joueurs, envoient `shuffle` /
`refill` (`deckButtonAt` → `requestDeckAction`). « Shuffle » n'est pas
dessiné quand le paquet déclare `display_shuffle: false` (`Deck.displayShuffle`,
filtré dans `deckButtons`). Les boutons de pioche
multiple (`drawButtons` dans `engine/deck.ts`) sont dessinés dans le coin haut
droit de chaque pile, pour les joueurs seulement, un par entier de
`card_pickup_quantity` du `deck` ou du `stack` (`Deck.drawCounts`, liste déjà
nettoyée par Tourtoirac, vide = aucun bouton ; absente d'un Tourtoirac plus
ancien = `[2, 5, 10]`), sur les seules piles de `card_pickup_piles`
(`Deck.drawPiles`, absente = toutes) : presser l'un d'eux **puis déplacer
le pointeur** bouton enfoncé (`armedDraw`, seuil `LONG_PRESS_SLACK`) envoie
`draw` avec `count` ; un simple clic ne pioche rien. Un bouton est gris quand
la pile a moins de cartes que son nombre. Le serveur répond par un événement
`draw` par carte : la première répond à `pending`, les suivantes sont
reconnues par `multiDrawId` et rejoignent la main comme les pions d'un appui
long, en éventail (`DRAW_FAN`, miroir du serveur). Une carte est un `Counter`
dont `isCard` est vrai : seule elle fait briller une pile (`pileUnder`). Une
carte piochée arrive sans sa face (`front_src` nul) ; elle la reçoit par
`flip`, ou par le `release` qui la met dans la main privée du lecteur.

`orientation` d'un `deck` / `stack` (`Deck.orientation`, 0, 90, 180 ou 270) :
`drawPile` dessine les cartes tournées autour du centre de la pile ;
`pileFootprint` (miroir de `Deck.footprint` de Tourtoirac) donne le rectangle
couvert, utilisé par `pileAt`, `drawDecks` et pour placer, droits, les
boutons, le badge et la légende. Pour un quart de tour (90 / 270), les boutons
Shuffle / Refill / Deal passent en colonne à droite de la pile
(`SIDE_BUTTON_WIDTH`), au lieu d'être en dessous. Une carte piochée prend l'`orientation` de
son `component_json` (`applyPick`).

Rotation des cartes : une carte envoyée avec `orientable: true` a les zones
de rotation d'un pion (`Counter.rotationZoneAt`, `requestRotate`,
`applyRotate`) sans code propre. Sur une pile de cartes, `hitCounter` ne vise
que celle du dessus : c'est la seule qui tourne. Une carte qui entre dans une
main revient droite : le `release` avec `hand_of` applique l'`orientation` du
`component_json` (0, posée par le serveur).

Un `stack` est un `Deck` dont `isStack` est vrai, rangé dans `decks` comme les
autres : une seule pile, dont `width`/`height` sont ceux de la **zone** de
dépôt. `drawStackCards` dessine la zone (toujours visible) et la carte du
dessus **centrée** dedans, à sa taille (`DeckPile.topWidth/topHeight`). Ses
boutons : « Shuffle », et « Deal » seulement si le stack déclare
`"deal": true` (`Deck.deals`) et si la main privée est active
(`dealPlayers()` renvoie alors le nombre de joueurs de `participants`, sinon
`null`). `DeckButton.enabled` est faux, et le bouton gris, quand la pile a
moins de cartes que de joueurs : `requestDeckAction` n'envoie alors rien.
L'événement `deal` passe par `applyDeal` : pile et mains relues, et les
`cards` reçues (celles du lecteur seulement) rejoignent `myHand`.

`Session.documents` (clé `documents` du `game_json`, des PDF) alimente le menu
déroulant `#documents-select`, en haut du panneau `#participants`, au-dessus
de « Rejoindre l'audio » (spectateurs compris) : première
entrée « Consulter », puis le nom de chaque document ; en choisir un l'ouvre
dans un nouvel onglet et ramène le menu sur « Consulter ». Sans document, le
menu est masqué.

« Fixe la position » et « Copie d'écran » sont dans le bandeau `#options-bar`
de `game.html`, sous l'en-tête (`setupOptionsBar` / `updateOptionsBar` dans
`game.ts`). « Fixe la position » est masqué pour un spectateur, pour une partie
close, et quand le jeu pose `options.fix_positions` à `false`. « Copie
d'écran » est masqué quand le jeu pose `options.screen_capture` à `false`. Il
ne copie pas le canvas : `downloadScreenshot` redessine le jeu sur un canvas
hors écran qui couvre tous les composants (`componentsBounds`, plateaux,
compteurs, sacs, pions, dés), à l'échelle 1:1, sans tenir compte de la caméra
ni du zoom, et sans grille, boutons ni barre d'info. Si le navigateur refuse
un canvas de cette taille, l'image est réduite par paliers. Le bouton est
désactivé tant que le joueur a un pion en main. Les
deux options sont des booléens, `true` par défaut ; une partie sauvegardée
avant que `fix_positions` le devienne peut encore porter `null` (masqué) ou
une position (affiché). Le bandeau disparaît quand il
n'a plus aucun bouton à montrer.

Le serveur annonce la
nationalité du siège dans `session_joined` (`myNationality` dans `game.ts`,
affichée dans le bandeau après le pseudo) ; le lobby l'affiche après chaque
pseudo. `Counter.nationality` reprend celle du pion (`TokenItem.nationality`),
`Session.player_nationalities` celle de chaque siège : c'est là que viendront
se brancher les règles.

`block_sight` (`TokenItem.block_sight`, `Counter.blockSight`) : dans l'aperçu
de pile, un pion qui le porte masque les pions situés sous lui aux spectateurs
et aux joueurs d'une autre nationalité que la sienne (`blocksSightOf`). Ils les
voient avec la face du pion bloquant, le plus haut de la pile qui les concerne
(`sightBlockers`) ; les pions de leur propre nationalité restent visibles. Ce
n'est qu'un rendu : le serveur envoie toujours tous les pions.

### Personnage (`mw_character`)

`mwCharacters` / `mwCharactersById`, dessinés sur le plateau sous les pions
(`drawMwCharacter`, aussi dans la copie d'écran). Les colonnes ne sont
dessinées et cliquables que sur la face avant ; leur place est fixée en
proportion de la carte (`columnRects` : marges des cartes de personnage de War
of the Ring, sous la ligne du haut du tableau). Un clic sur une case
(`boxAt`) envoie `mark` avant tout pion posé dessus ; l'événement `mark`
passe par `applyMark`. Un double clic hors des cases, sans pion dessus,
envoie `flip` (`requestCharacterFlip`) ; `applyFlip` change alors `side`.
`characterRefused` reprend `modificationRefused` (nationalité, partie non
lancée, joueur absent). Les images (faces et icônes) sont attendues par
`componentImages`.

Cartes sous un personnage : `MwCharacter.cards` (`CharacterCard`, faces
visibles, relues par `refreshCharacter` depuis le `character_json` d'un
`release` ou d'un `pick`). `drawMwCharacter` dessine leur nombre dans un
badge en haut à droite, sur les deux faces. Survol (sans pion dessus) :
`drawCharacterPreview` montre leurs faces, à hauteur fixe
(`CHARACTER_PREVIEW_CARD_HEIGHT`), la prochaine prise à gauche. Bouton
enfoncé sur un personnage qui a des cartes : `armedCharacter`, puis dès que
le pointeur s'éloigne (`LONG_PRESS_SLACK`) `requestCharacterPick` envoie
`pick` et la carte suit le pointeur comme un tirage dans un sac ; un simple
clic ou un double clic ne prend rien.

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

`OBG/Common` (ressources partagées : icônes) est hors du dépôt : le build
Docker le reçoit comme contexte nommé `common`
(`docker build --build-context common=../Common`, `additional_contexts` dans le
compose, `BUILD_CONTEXT` dans `OBG/deploy.sh`) et le copie en `/Common`, que
`src/` atteint par `../../Common`. Sans ce contexte, le build échoue. En
développement, `server.fs.allow` de `vite.config.ts` autorise ce dossier.

`docker-compose.yml` : service `raffaillac`, port hôte `8080:80`. Le service
`chabanas` y est commenté et à activer selon le déploiement.

## Conventions

- Commentaires et docstrings **en anglais**.
- Une classe par composant de `engine/`, état mutable quand le repositionnement
  l'exige (cf. `CounterBox.x`/`.y`, modifiables pour le setup).
- `dist/` est ignoré par git — ne jamais le committer.

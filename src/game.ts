import { Button } from "./engine/button";
import { allBoardsLoaded, boardDims, createBoard } from "./engine/board";
import type { Board } from "./engine/board";
import { Counter } from "./engine/counter";
import type { RotationDirection } from "./engine/counter";
import {
  counterActionZoneAt,
  createCounterBox,
  drawCounterActionZones,
  drawCounterBox,
  hitCounterBox,
  isActionEnabled,
} from "./engine/counter_box";
import type { CounterAction, CounterBox } from "./engine/counter_box";
import { Dice } from "./engine/dice";
import { lobbyReturnUrl, originGameName } from "./navigation";
import { clearSession, loadPlayerIdentity, loadSession, storeSession } from "./session";
import type {
  AcquireEvent,
  BoardItem,
  ComponentState,
  CounterItem,
  CounterValueEvent,
  DiceItem,
  FixPositionsEvent,
  FlipEvent,
  MoveEvent,
  ReleaseEvent,
  RollEvent,
  RotateEvent,
  ServerErrorEvent,
  Session,
  SessionComponents,
  SessionCreatedEvent,
  SessionStatusEvent,
  SetupEntry,
  SetupEvent,
  TokenItem,
} from "./types";
import { getSocket } from "./ws/wsClient";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
const ZOOM_FACTOR = 1.1;
const RESPONSE_TIMEOUT = 2000;
// repli si le jeu ne dit rien dans son game_json, ou si un Tourtoirac plus
// ancien n'annonçait pas le délai dans l'événement de lancer
const ROLL_COOLDOWN_SECONDS = 5;
// position du bouton "Fixe la position" quand le jeu ne dit rien : un jeu peut
// le déplacer (options.fix_positions) ou le masquer (options.fix_positions null)
const DEFAULT_FIX_BUTTON_X = 1350;
const DEFAULT_FIX_BUTTON_Y = 10;
const FIX_BUTTON_WIDTH = 220;
const FIX_BUTTON_HEIGHT = 40;
// bouton "flip" d'un plateau que le jeu marque flippable : le plateau se
// retourne sur l'écran de ce joueur, sans rien changer pour les autres. Il est
// ancré au plateau mais dimensionné en pixels d'écran, pour rester cliquable à
// tous les zooms : Vietnam a un plateau de 7600 px de large, où 80 px posés
// dans le monde feraient 5 px à l'écran.
const FLIP_BUTTON_WIDTH = 70;
const FLIP_BUTTON_HEIGHT = 26;
// Stack preview: popup listing every counter under the pointer when there is
// more than one. Distances are in screen pixels; counters inside it are drawn
// at the main view's zoom.
const STACK_PREVIEW_OFFSET = 50;
const STACK_PREVIEW_PADDING = 10;
const STACK_PREVIEW_GAP = 10;

// ---------------------------------------------
// Défilement de la caméra au bord de l'écran
// ---------------------------------------------

// Vietnam a un plateau de 7600 px de large : impossible à tenir dans une fenêtre.
// Le glissement à la souris Suffit pour un joueur qui ne tient rien, mais un
// pion en main occupe déjà la souris : sans ce défilement, on ne peut pas
// conduire le plateau à l'autre bout de l'écran tout en déplaçant le pion.

// À l'intérieur de cette bande, près du bord, la caméra défile. En pixels
// d'écran, donc independent du zoom : c'est la distance au bord de la fenêtre
// que le joueur garde, pas une distance dans le monde.
const EDGE_BAND = 90;

// La vitesse est nulle au bord exact de la bande et maximale à celui de
// l'écran : un dégradé, pour que le franchissement soit doux plutôt que
// saccadé. On élève la fraction au carré plutôt que de la premiere puissance.
const EDGE_EASE = 2;

// Vitesse maximale du défilement, en pixels d'écran par seconde. Assez pour
// traverser le plateau de Vietnam en quelques secondes, assez lent pour viser
// une case sans la dépasser.
const EDGE_SCROLL_SPEED = 900;

// Léger retard avant le premier déplacement, pour qu'un pointeur pressé contre
// le bord — la plupart du temps un simple geste vers le bord — ne fasse pas
// défiler la carte.
const EDGE_SCROLL_DELAY_MS = 250;

// Un onglet en arrière-plan ne rafraîchit plus : le pas de temps qu'il retrouve
// en revenant au premier plan est énorme. On le borne pour que la carte ne
// saute pas d'un coup.
const EDGE_SCROLL_MAX_FRAME_MS = 50;

type HandEvent = AcquireEvent | ReleaseEvent;

interface GameServerMessage {
  event?: string;
  session?: Session;
  [key: string]: unknown;
}

// -------------------------------------------------
// Canvas : taille du viewport
// -------------------------------------------------

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

function fitCanvasSize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}

fitCanvasSize();

// -------------------------------------------------
// Lecture de la session
// -------------------------------------------------

let currentSession: Session | null = loadSession();

// seul le créateur de la partie peut l'archiver. Le serveur l'annonce dans
// l'événement de session, l'interface ne fait que le refléter.
let isOwner = false;

// la partie a été close par son owner : elle est archivée, plus rien n'y bouge
let isClosed = false;

// la partie a-t-elle commencé, et qui manque à la table ? Le serveur le diffuse
// à chaque changement ; un pion ne se prend que si elle a commencé et que tous
// ses joueurs sont là. Le serveur refuse de toute façon un acquire hors de ces
// conditions : la page ne fait que s'épargner une requête vouée à l'échec.
let isStarted = false;
let missingPlayers: string[] = [];

function canAcquire(): boolean {
  return isStarted && missingPlayers.length === 0;
}

const sessionInfo = document.getElementById("session-info");

// Le bandeau affiche le jeu et le joueur plutôt que le nom du site : on sait
// d'un coup d'œil où l'on est et sous quelle identité.
const gameTitle = document.getElementById("game-title");

function updateGameTitle(): void {
  if (!gameTitle) return;
  const gameName = originGameName() ?? "Online Boardgames";
  const nickname = loadPlayerIdentity()?.name;
  gameTitle.textContent = nickname ? `${gameName} — ${nickname}` : gameName;
}

updateGameTitle();

function updateSessionInfo(): void {
  if (!sessionInfo) return;
  if (!currentSession?.key) {
    sessionInfo.textContent = "Aucune session active";
  } else if (isClosed) {
    sessionInfo.textContent = `Session ${currentSession.key} (partie close)`;
  } else if (!isStarted) {
    sessionInfo.textContent = `Session ${currentSession.key} (partie non démarrée)`;
  } else if (missingPlayers.length > 0) {
    sessionInfo.textContent =
      `Session ${currentSession.key} (en attente de : ${missingPlayers.join(", ")})`;
  } else {
    sessionInfo.textContent = `Session ${currentSession.key}`;
  }
}

updateSessionInfo();

// -------------------------------------------------
// Situation initiale
// -------------------------------------------------

let boards: Board[] = [];
let counters: Counter[] = [];
const countersById = new Map<string, Counter>();

// les compteurs sont des composants "fixed" comme les plateaux : ils ne
// bougent pas, mais leurs deux zones + et - se cliquent
let counterBoxes: CounterBox[] = [];
const counterBoxesById = new Map<string, CounterBox>();

// un dé se lance d'un clic : ni prenable ni déplaçable
let dices: Dice[] = [];
const dicesById = new Map<string, Dice>();

// la situation a-t-elle déjà été lue depuis le serveur
let componentsLoaded = false;

// un spectateur regarde mais ne joue pas : pas de bouton "fixe la position"
let isWatcher = false;

// le setup du jeu, tant que le serveur ne l'a pas fait appliquer. Il attend que
// tous les composants soient a l'ecran : un pion dont l'image charge encore
// changerait de place sous les yeux du joueur.
let pendingSetup: SetupEntry[] = [];

// le setup n'est demande qu'une fois. Le serveur le vide de toute facon, mais un
// second envoi avant sa reponse ferait bouger la partie pour rien.
let setupRequested = false;

// le setup a-t-il deja ete lu dans la session ? Comme la situation initiale, il
// ne se lit qu'une fois : les messages de session suivants ne doivent pas
// re-armer la mise en place.
let setupRead = false;

function loadComponents(components: SessionComponents | undefined): void {
  boards = (components?.fixed ?? [])
    .filter((item) => item.kind === "board")
    .map((item) => createBoard(item as BoardItem));

  counterBoxesById.clear();
  counterBoxes = (components?.fixed ?? [])
    .filter((item) => item.kind === "counter")
    .map((item) => createCounterBox(item as CounterItem));
  for (const box of counterBoxes) {
    counterBoxesById.set(box.name, box);
  }

  countersById.clear();
  counters = (components?.movable ?? [])
    .filter((item) => item.kind === "token")
    .map((item) => {
      const token = item as TokenItem;
      const img = new Image();
      img.src = token.front_src;
      // la face de dos est chargée tout de suite quand le jeu en donne une :
      // un pion sans back_src ne se retourne pas, et n'a rien à précharger
      let backImg: HTMLImageElement | null = null;
      if (token.back_src) {
        backImg = new Image();
        backImg.src = token.back_src;
      }
      const counter = new Counter(
        token.id,
        img,
        token.x,
        token.y,
        token.width,
        token.height,
        token.move_border ?? true,
        // border : le jeu demande-t-il une ombre sous ce pion ?
        token.border ?? false,
        // un pion non orientable n'affiche aucune zone de rotation
        token.orientable ?? false,
        // l'angle atteint avant une sauvegarde de session, s'il y en a une
        token.orientation ?? 0,
        backImg,
        // la face affichée quand la partie a été sauvegardée en cours de jeu
        token.side ?? "front",
        // "transparent" demande d'afficher le pion fantôme sur sa case d'origine
        token.origin ?? null,
        // case de départ, celle où revient un pion déposé sur son fantôme
        token.initial_x ?? token.x,
        token.initial_y ?? token.y,
        // où poser le fantôme. Il reprend le x/y d'origine du pion, pas celui de
        // sa case de départ : le setup et "fixe la position" déplacent la
        // deuxième, jamais le fantôme.
        token.origin_x ?? null,
        token.origin_y ?? null,
      );
      // le rectangle vert vient du serveur ; absent, un pion repositionnable
      // commence sur sa case de départ
      if (typeof token.in_place === "boolean") counter.inPlace = token.in_place;
      return counter;
    });

  for (const counter of counters) {
    countersById.set(counter.name, counter);
  }

  dicesById.clear();
  dices = (components?.dice ?? []).map((item) => {
    const diceItem = item as DiceItem;
    return new Dice(
      diceItem.id,
      diceItem.x,
      diceItem.y,
      diceItem.width,
      diceItem.height,
      diceItem.src_list ?? [],
      diceItem.src,
      diceItem.roll_delay ?? ROLL_COOLDOWN_SECONDS,
    );
  });

  for (const dice of dices) {
    dicesById.set(dice.name, dice);
  }

  hand = [];
  handAnchor = null;
  hoveredCounter = null;
  hoveredCounterBox = null;
  clearPending();
  cameraInitialized = false;
  setupFlipButtons();
}

// -------------------------------------------------
// Retournement local d'un plateau
// -------------------------------------------------

// Un bouton par plateau que le jeu autorise à retourner. Le retournement ne
// change que la vue de ce joueur : il n'est ni envoyé au serveur ni partagé, un
// autre écran garde le plateau dans le sens où son joueur le lit.
interface FlipPlate {
  board: Board;
  button: Button;
}

let flipPlates: FlipPlate[] = [];

function setupFlipButtons(): void {
  flipPlates = boards
    .filter((board) => board.flippable)
    .map((board) => ({
      board,
      button: new Button(0, 0, FLIP_BUTTON_WIDTH, FLIP_BUTTON_HEIGHT, "flip", () => {
        board.flipped = !board.flipped;
        // un pion en main suit le pointeur à l'écran : son emplacement logique
        // bascule avec le plateau, sans quoi il saute à l'autre bout de la carte
        reanchorHand();
      }),
    }));
}

// Reprend les pions en main à l'endroit où ils sont dessinés, après un
// retournement. Un demi-tour est sa propre inverse : il suffit de leur donner
// pour position logique celle qui les dessine toujours au même endroit, et les
// pions restent sous le pointeur au lieu de sauter à l'autre bout du plateau.
// La translation est la même pour tous, handWorldX et handWorldY restent donc
// valides.
function reanchorHand(): void {
  for (const counter of hand) {
    const [lx, ly] = displayTopLeft(counter.x, counter.y, counter.width, counter.height);
    counter.x = lx;
    counter.y = ly;
  }
  // la barre d'info annonce la position logique du pion : elle suit le
  // retournement, sans attendre le prochain mouvement de souris
  if (hand.length > 0) counterInfoText = handInfoText();
}

// Le bouton, à sa place à l'écran. Il est reposé à chaque usage plutôt que figé
// à la création : le plateau se déplace sous lui quand la caméra zoome ou
// panoramique, et sa taille est en pixels d'écran alors que son ancre est dans
// le monde.
function placeFlipButton(plate: FlipPlate): Button {
  const [x, y] = worldToScreen(plate.board.x, plate.board.y);
  plate.button.x = x;
  plate.button.y = y;
  return plate.button;
}

function boardCenter(board: Board): [number, number] {
  const { width, height } = boardDims(board);
  return [board.x + width / 2, board.y + height / 2];
}

// le plateau retourné sous un point, ou null. Les plateaux ne se chevauchent
// pas : un point appartient à au plus un d'entre eux.
function flippedBoardAt(x: number, y: number): Board | null {
  for (const board of boards) {
    if (!board.flipped) continue;
    const { width, height } = boardDims(board);
    if (x >= board.x && x <= board.x + width && y >= board.y && y <= board.y + height) {
      return board;
    }
  }
  return null;
}

// Retourne un point de 180° autour du centre du plateau retourné qui le
// contient. Un demi-tour est sa propre inverse : la même fonction convertit un
// point de l'écran en point logique, et l'inverse.
function flipPoint(x: number, y: number): [number, number] {
  const board = flippedBoardAt(x, y);
  if (board === null) return [x, y];
  const [cx, cy] = boardCenter(board);
  return [2 * cx - x, 2 * cy - y];
}

// Coin haut-gauche à l'écran du rectangle d'un composant : si son centre tombe
// sur un plateau retourné, on fait pivoter le rectangle de 180° autour de ce
// centre. Le composant lui-même reste droit, seule sa place change.
function displayTopLeft(x: number, y: number, width: number, height: number): [number, number] {
  const board = flippedBoardAt(x + width / 2, y + height / 2);
  if (board === null) return [x, y];
  const [cx, cy] = boardCenter(board);
  return [2 * cx - (x + width), 2 * cy - (y + height)];
}

// Le plateau, tel qu'il se lit sur cet écran. Retourné, il pivote de 180° autour
// de son centre : le rectangle qu'il occupe ne bouge pas, c'est son contenu qui
// change de sens.
function drawBoard(board: Board, context: CanvasRenderingContext2D): void {
  if (!board.image.complete) return;

  const { width, height } = boardDims(board);
  if (!board.flipped) {
    context.drawImage(board.image, board.x, board.y, width, height);
    return;
  }

  context.save();
  // le demi-tour se fait autour du coin bas-droit : le dessin repart de (0, 0)
  context.translate(board.x + width, board.y + height);
  context.rotate(Math.PI);
  context.drawImage(board.image, 0, 0, width, height);
  context.restore();
}

// Dessine un composant à sa place d'écran, sans toucher au composant : sur un
// plateau retourné, son rectangle change de coin, mais l'image garde son
// orientation et l'angle d'un pion reste le sien.
function drawAtDisplay(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  draw: () => void,
): void {
  const [dx, dy] = displayTopLeft(x, y, width, height);
  if (dx === x && dy === y) {
    draw();
    return;
  }
  context.save();
  context.translate(dx - x, dy - y);
  draw();
  context.restore();
}

// Un pion à sa place d'écran. Le pion lui-même n'est pas touché : sur un plateau
// retourné, il change de coin sans pivoter, son angle reste celui que lui a
// donné le serveur.
function drawCounterAtDisplay(counter: Counter): void {
  drawAtDisplay(ctx, counter.x, counter.y, counter.width, counter.height, () => {
    counter.draw(ctx);
  });
}

// le dé sous le pointeur, ou null : contrairement aux pions, un dé se lance
// sans être pris en main
function hitDiceAt(wx: number, wy: number): Dice | null {
  for (let i = dices.length - 1; i >= 0; i--) {
    if (dices[i].contains(wx, wy)) return dices[i];
  }
  return null;
}

function requestRoll(dice: Dice): void {
  if (dice.isLocked()) return;
  // verrou local immédiat, pour la durée annoncée par le jeu : deux clics
  // rapprochés ne doivent pas partir avant le retour du serveur
  dice.lockFor(dice.rollDelay);
  getSocket()?.send({ action: "roll", component_id: dice.name });
}

// la face tirée par un joueur, appliquée par tous les écrans
function applyRoll(message: RollEvent): void {
  const dice = dicesById.get(message.component_id);
  if (!dice) return;
  dice.setFace(message.src);
  // le serveur fait foi : sa durée remplace celle qu'on s'était appliquée
  dice.lockFor(message.cooldown_seconds ?? dice.rollDelay);
}

// le serveur fait autorité sur le rectangle vert
function applyComponentState(state: ComponentState | undefined): void {
  if (!state) return;
  const counter = countersById.get(state.id);
  if (!counter) return;
  counter.x = state.x;
  counter.y = state.y;
  if (typeof state.in_place === "boolean") counter.inPlace = state.in_place;
  // "fixe la position" déplace la case de départ, donc le retour du pion et son
  // rectangle vert. Le fantôme reste où le jeu l'a posé : originX/originY sont
  // figés à l'installation et ne se relisent pas sur un message de position.
  if (typeof state.initial_x === "number") counter.initialX = state.initial_x;
  if (typeof state.initial_y === "number") counter.initialY = state.initial_y;
}

// bouton de repositionnement : sa position vient du game_json du jeu, qui peut
// aussi le masquer. Absent, le client garde sa position par défaut.
let buttonFix: Button | null = null;

function setupFixButton(session: Session | null): void {
  const position = session?.options?.fix_positions;
  if (position === null) {
    buttonFix = null;
    return;
  }
  const x = typeof position?.x === "number" ? position.x : DEFAULT_FIX_BUTTON_X;
  const y = typeof position?.y === "number" ? position.y : DEFAULT_FIX_BUTTON_Y;
  buttonFix = new Button(
    x,
    y,
    FIX_BUTTON_WIDTH,
    FIX_BUTTON_HEIGHT,
    "Fixe la position",
    () => {
      // le serveur remet le rectangle vert et prévient joueurs et spectateurs
      getSocket()?.send({ action: "fix_positions" });
    },
  );
}

// -------------------------------------------------
// Caméra
// -------------------------------------------------

let cameraX = 0;
let cameraY = 0;
let zoom = 1.0;
let worldWidth = 0;
let worldHeight = 0;
let cameraInitialized = false;

function initializeCamera(): void {
  if (cameraInitialized) return;
  if (boards.length === 0) return;
  if (!allBoardsLoaded(boards)) return;

  worldWidth = Math.max(...boards.map((b) => b.x + boardDims(b).width));
  worldHeight = Math.max(...boards.map((b) => b.y + boardDims(b).height));

  zoom = Math.min(canvas.width / worldWidth, canvas.height / worldHeight) * 0.98;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

  cameraInitialized = true;
}

// Recentre la caméra sur un pion, sans toucher au zoom : le clic sur le
// fantôme d'un pion "transparent" y amène l'écran. On vise le centre du pion,
// pas son coin, pour qu'il tombe au milieu de la vue.
function centerCameraOn(counter: Counter): void {
  const [dx, dy] = displayTopLeft(counter.x, counter.y, counter.width, counter.height);
  cameraX = dx + counter.width / 2 - canvas.width / (2 * zoom);
  cameraY = dy + counter.height / 2 - canvas.height / (2 * zoom);
}

// -------------------------------------------------
// Défilement au bord : le pointeur, et ce qu'il garde
// -------------------------------------------------

// Où se trouve le pointeur, en pixels d'écran. Sa position est suivie même
// quand il n'a rien déclenché : un pointeur immobile n'émet aucun mousemove, et
// c'est pourtant le cas le plus courant pendant un défilement.
let edgeX = -1;
let edgeY = -1;

// Proximité d'un bord, en fraction de la vitesse maximale : 1 sur le bord
// même, 0 dès qu'on en sort. On normalise par la bande, pour que la taille de
// la fenêtre n'ait pas d'effet sur la façon dont le défilement s'enclenche.
function edgeProximity(distance: number, extent: number): number {
  if (extent <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - distance / Math.min(EDGE_BAND, extent / 2)));
}

// Proximité du bord le plus proche sur un axe, signée : positive vers la fin de
// l'axe (droite, bas), négative vers son début. Le signe est indispensable —
// être près du bord gauche et près du bord droit se ressemblent, mais on défile
// alors dans deux sens opposés. Les deux bords sont pesés puis on garde le plus
// fort : dans un coin le pointeur est près des deux, et c'est le bord qu'il
// approche qui doit décider du sens.
function edgeSignedOnAxis(position: number, extent: number): number {
  const nearStart = edgeProximity(position, extent);
  const nearEnd = edgeProximity(extent - position, extent);
  return nearStart >= nearEnd ? -nearStart : nearEnd;
}

// Le vecteur de défilement, en pixels d'écran par seconde. cameraX et cameraY
// sont les coordonnées monde du coin haut gauche de la vue : les augmenter
// déplace la vue vers l'est et vers le sud, et fait glisser la carte dans le
// sens du bord que le pointeur approche. Chaque axe ne dépend que de sa propre
// bande — un pointeur au bord droit défile droit, même s'il est aussi un peu
// plus bas.
//
// L'adoucissement porte sur la valeur absolue et le signe est remis ensuite :
// élevé à la puissance sur une valeur négative, le résultat changerait de signe
// pour un exposant impair, et le défilement partirait à l'opposé.
function edgeScrollVector(): [number, number] {
  const eased = (fraction: number): number =>
    Math.sign(fraction) * Math.abs(fraction) ** EDGE_EASE * EDGE_SCROLL_SPEED;
  return [
    eased(edgeSignedOnAxis(edgeX, canvas.width)),
    eased(edgeSignedOnAxis(edgeY, canvas.height)),
  ];
}

// Fait défiler la caméra d'un cran. Le mouvement est exprimé en pixels d'écran
// puis divisé par le zoom : la caméra avance d'autant de pixels du monde que la
// vue en fait, et le défilement garde donc la même vitesse à tous les zooms.
//
// La main est laissée en place, et c'est tout l'intérêt du geste : le pion suit
// le pointeur, donc le monde, au lieu de rester collé à sa case d'origine. On
// ne translate la main que si elle est pleine — un pointeur qui traîne au bord
// avec la main vide ne doit pas secouer des pions que personne ne tient.
function stepEdgeScroll(dt: number): void {
  if (!edgeScrolling()) return;

  const [vx, vy] = edgeScrollVector();
  if (vx === 0 && vy === 0) return;

  cameraX += (vx * dt) / zoom;
  cameraY += (vy * dt) / zoom;

  if (hand.length === 0) return;

  // La position de la main se déduit du pointeur, pas du temps : sinon le pion
  // se déplacerait deux fois, une fois avec la carte et une fois avec la souris.
  // lastMouseWorld est réécrit ici, donc la main ne part pas à la dérive.
  const [wx, wy] = screenToWorld(edgeX, edgeY);
  const [lx, ly] = flipPoint(wx, wy);
  lastMouseWorldX = lx;
  lastMouseWorldY = ly;
  for (const counter of hand) {
    counter.x = lx;
    counter.y = ly;
  }
  handWorldX = lx;
  handWorldY = ly;
  movesDirty = true;
  counterInfoText = handInfoText();
}

// -------------------------------------------------
// Main : composants attachés par le serveur
// -------------------------------------------------

let hand: Counter[] = [];
let handAnchor: Counter | null = null;
let pending: { action: "acquire" | "release"; componentId: string } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

let handWorldX = 0;
let handWorldY = 0;
let lastMouseWorldX = 0;
let lastMouseWorldY = 0;

// la main reste verrouillée tant que le serveur n'a pas répondu
function setPending(action: "acquire" | "release", componentId: string): void {
  clearPending();
  pending = { action, componentId };
  pendingTimer = setTimeout(() => {
    console.warn("[WS] Aucune réponse du serveur pour", action, componentId);
    clearPending();
  }, RESPONSE_TIMEOUT);
}

function clearPending(): void {
  pending = null;
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

// Les nouvelles positions de la main sont diffusées aux autres joueurs :
// un message par composant et par image au plus.
let movesDirty = false;

function flushMoves(): void {
  if (!movesDirty || hand.length === 0) return;
  movesDirty = false;

  const socket = getSocket();
  if (!socket) return;

  for (const counter of hand) {
    socket.send({
      action: "move",
      component_id: counter.name,
      x: counter.x,
      y: counter.y,
    });
  }
}

// Un pion relâché repasse en fin de liste : il se dessine alors au-dessus des
// pions de la pile qu'il vient de rejoindre. L'ordre reste le même pour tous,
// puisque le serveur diffuse le relâchement à toute la session.
function bringCounterToFront(counter: Counter): void {
  const index = counters.indexOf(counter);
  if (index === -1 || index === counters.length - 1) return;
  counters.splice(index, 1);
  counters.push(counter);
}

// Le serveur accuse réception de chaque acquisition / relâchement :
// la main est reconstruite à partir de ces accusés, un composant à la fois.
function applyHandEvent(answer: HandEvent, isOwnRequest: boolean): void {
  const counter = countersById.get(answer.component_id);
  if (!counter) {
    console.warn("[hand] Composant inconnu :", answer.component_id);
    return;
  }

  // identité du détenteur, pour tous les joueurs de la session
  counter.heldBy = answer.event === "acquire" ? answer.user : null;

  // au lâcher, Tourtoirac renvoie la position validée : c'est elle qui fait
  // réapparaître le pion chez les autres joueurs, à l'endroit réel.
  // Le rectangle vert voyage dans le même message.
  if (answer.event === "release") {
    applyComponentState((answer as ReleaseEvent).component_json);
    bringCounterToFront(counter);
  }

  // les messages des autres joueurs sont affichés plus tard
  if (!isOwnRequest) return;

  if (answer.event === "acquire") {
    if (hand.includes(counter)) return;

    counter.held = true;
    hand.push(counter);
    handAnchor = counter;
  } else {
    const index = hand.indexOf(counter);
    if (index >= 0) hand.splice(index, 1);
    counter.held = false;
    if (handAnchor === counter) handAnchor = hand[0] ?? null;

    // pas de recalage ici : il a été fait avant l'envoi du release, et
    // applyComponentState a posé la position renvoyée par le serveur
  }

  if (hand.length > 0) {
    // la main se recale sur la position courante de la souris
    handWorldX = lastMouseWorldX;
    handWorldY = lastMouseWorldY;
    counterInfoText = handInfoText();
  } else {
    counterInfoText = counterPositionText(counter);
  }
}

// -------------------------------------------------
// Souris
// -------------------------------------------------

let lastMouseX = 0;
let lastMouseY = 0;
let panning = false;
let counterInfoText = "";

function counterPositionText(counter: Counter): string {
  return `${counter.name}  x=${Math.floor(counter.x)}  y=${Math.floor(counter.y)}`;
}

function handInfoText(): string {
  const anchor = handAnchor ?? hand[0];
  if (!anchor) return "";
  const label = hand.length > 1 ? `${anchor.name} +${hand.length - 1}` : anchor.name;
  return `${label}  x=${Math.floor(anchor.x)}  y=${Math.floor(anchor.y)}`;
}

function screenToWorld(sx: number, sy: number): [number, number] {
  return [cameraX + sx / zoom, cameraY + sy / zoom];
}

// l'inverse : le point du monde tel qu'il apparaît à l'écran. Sert aux boutons
// "flip", ancrés au plateau mais dessinés en pixels d'écran.
function worldToScreen(wx: number, wy: number): [number, number] {
  return [(wx - cameraX) * zoom, (wy - cameraY) * zoom];
}

function hitCounter(wx: number, wy: number): Counter | null {
  for (let i = counters.length - 1; i >= 0; i -= 1) {
    if (counters[i].contains(wx, wy)) {
      return counters[i];
    }
  }
  return null;
}

// le pion "transparent" dont le fantôme est sous le pointeur, ou null. Le
// fantôme est dessiné sous les pions ; un pion réel au même endroit est donc
// traité avant lui, pour ne pas voler le clic qui visait ce pion.
function hitOriginGhost(wx: number, wy: number): Counter | null {
  for (let i = counters.length - 1; i >= 0; i -= 1) {
    if (counters[i].originGhostContains(wx, wy)) {
      return counters[i];
    }
  }
  return null;
}

// le pion sous le pointeur : ses zones de rotation ne s'affichent que pour
// celui-là, et seulement si la main est vide
let hoveredCounter: Counter | null = null;

// le compteur survolé : ses zones + et - ne s'affichent que pour lui, et
// seulement si la main est vide, comme les zones de rotation d'un pion
let hoveredCounterBox: CounterBox | null = null;

// Le client ne demande qu'un cran : la nouvelle valeur vient du serveur, qui
// refuse qu'un joueur choisisse le score lui-même.
function requestCounterValue(box: CounterBox, action: CounterAction): void {
  const socket = getSocket();
  if (!socket) return;

  const message = { action, component_id: box.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function applyCounterValue(message: CounterValueEvent): void {
  const box = counterBoxesById.get(message.component_id);
  if (!box) return;
  box.value = message.value;
}

function requestRotate(counter: Counter, direction: RotationDirection): void {
  const socket = getSocket();
  if (!socket) return;

  // pas de rotation optimiste : on attend l'angle que le serveur renvoie. S'il
  // refuse (pion en main, jeu qui l'interdit), l'écran ne doit pas mentir sur
  // un angle que personne d'autre ne partage
  const message = { action: "rotate", component_id: counter.name, direction };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// le pion a tourné : appliqué par tous les écrans, comme le lancer du dé
function applyRotate(message: RotateEvent): void {
  const counter = countersById.get(message.component_id);
  if (!counter) return;
  counter.orientation = message.orientation;
}

function requestFlip(counter: Counter): void {
  const socket = getSocket();
  if (!socket) return;

  // un pion qui n'a qu'une seule face ne se retourne pas, et on ne le demande
  // même pas au serveur : le double-clic doit rester sans effet
  if (!counter.flippable) return;

  // pas de retournement optimiste : on attend la face que le serveur renvoie,
  // comme pour la rotation. Sinon l'écran qui a cliqué montrerait un pion que
  // les autres ne voient pas encore
  const message = { action: "flip", component_id: counter.name };
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// le pion s'est retourné : appliqué par tous les écrans, comme la rotation
function applyFlip(message: FlipEvent): void {
  const counter = countersById.get(message.component_id);
  if (!counter) return;
  counter.setSide(message.side);
}

function requestAcquire(counter: Counter): void {
  if (!canAcquire()) return;
  const socket = getSocket();
  if (!socket) return;

  const message = { action: "acquire", component_id: counter.name };
  setPending("acquire", counter.name);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function requestRelease(counter: Counter): void {
  const socket = getSocket();
  if (!socket) return;

  // on envoie la position brute du dépôt : c'est le serveur qui décide du
  // recadrage et du rectangle vert, puis qui renvoie l'état corrigé
  const message = {
    action: "release",
    component_id: counter.name,
    x: counter.x,
    y: counter.y,
  };
  setPending("release", counter.name);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

function onMouseDown(event: MouseEvent): void {
  const sx = event.offsetX;
  const sy = event.offsetY;
  const [wx, wy] = screenToWorld(sx, sy);

  // le bouton "fixe la position" est posé dans le monde, comme les composants
  // qu'il manipule : il se vise en coordonnées monde. Le bouton "flip", lui, est
  // dessiné à l'écran et se vise en coordonnées d'écran. Ni l'un ni l'autre ne
  // dépend du retournement d'un plateau.
  if (!isWatcher && buttonFix && buttonFix.contains(wx, wy)) {
    buttonFix.callback();
    return;
  }

  for (const plate of flipPlates) {
    if (placeFlipButton(plate).contains(sx, sy)) {
      plate.button.callback();
      return;
    }
  }

  // un plateau retourné inverse sa carte : le pointeur est ramené dans l'espace
  // logique avant de tester pions, dés et fantômes
  const [lx, ly] = flipPoint(wx, wy);
  lastMouseWorldX = lx;
  lastMouseWorldY = ly;

  // une requête est déjà en attente de réponse du serveur
  if (pending !== null) return;

  // clic sur le fantôme d'un pion "transparent" : la caméra se recentre sur le
  // pion, joueurs comme spectateurs. Le fantôme étant dessiné sous les pions,
  // un pion réel sous le pointeur garde la priorité.
  if (hitCounter(lx, ly) === null) {
    const ghost = hitOriginGhost(lx, ly);
    if (ghost !== null) {
      centerCameraOn(ghost);
      return;
    }
  }

  // un spectateur regarde : il ne prend aucun pion en main. Le serveur refuse
  // l'acquire de son côté, on n'envoie donc même pas la demande. Il peut en
  // revanche déplacer la caméra comme un joueur, pour suivre la partie.
  if (!isWatcher) {
    // clic sur un dé : il se lance sur place, sans le prendre en main
    const clickedDice = hitDiceAt(lx, ly);
    if (clickedDice !== null) {
      requestRoll(clickedDice);
      return;
    }

    // clic sur une zone + ou - d'un compteur : demande de changer sa valeur.
    // Ces zones priment sur le pion, comme les zones de rotation priment sur
    // la prise en main du pion qu'elles recouvrent.
    if (hand.length === 0) {
      const box = hitCounterBox(counterBoxes, lx, ly);
      const zone = box === null ? null : counterActionZoneAt(box, lx, ly);
      if (box !== null && zone !== null) {
        // le signe grise quand la valeur a atteint sa borne : on n'envoie rien,
        // le serveur refuserait de toute facon. Le clic reste absorbe par le
        // compteur, il ne doit pas tomber sur le plateau en dessous.
        if (isActionEnabled(box, zone)) {
          requestCounterValue(box, zone);
        }
        return;
      }
    }

    // clic sur un composant déjà en main : demande de relâchement
    const held = hand.find((counter) => counter.contains(lx, ly));
    if (held !== undefined) {
      requestRelease(held);
      return;
    }

    // clic sur un pion : demande d'acquisition
    const hit = hitCounter(lx, ly);
    if (hit !== null) {
      // avant de le prendre en main, on vérifie si le clic visait une zone de
      // rotation. Ces zones n'existent pas pendant qu'on tient un pion : le
      // repère est déjà occupé par ce qu'on déplace.
      if (hand.length === 0) {
        const zone = hit.rotationZoneAt(lx, ly);
        if (zone !== null) {
          requestRotate(hit, zone);
          return;
        }
      }
      requestAcquire(hit);
      return;
    }

    // la main occupe déjà le pion : pas de déplacement de la caméra
    if (hand.length > 0) return;
  }

  panning = true;
  lastMouseX = sx;
  lastMouseY = sy;
}

function onMouseMove(event: MouseEvent): void {
  const sx = event.offsetX;
  const sy = event.offsetY;
  pointerOnCanvas = true;
  pointerScreenX = sx;
  pointerScreenY = sy;

  // Le défilement de la caméra a ses propres règles de déclenchement, alors que
  // ce gestionnaire s'interrompt dès qu'un pion est en main. Il est donc appelé
  // avant toute sortie de fonction, et jamais à l'intérieur de la boucle de
  // dessin, qui ignore le temps écoulé depuis le dernier mouvement.
  trackPointerForEdgeScroll(sx, sy);

  const [wx, wy] = screenToWorld(sx, sy);

  // même conversion que dans onMouseDown : le survol et le déplacement d'un
  // pion se calculent dans l'espace logique, pas à l'écran
  const [lx, ly] = flipPoint(wx, wy);
  lastMouseWorldX = lx;
  lastMouseWorldY = ly;

  // le pion survolé alimente l'affichage des zones de rotation. Il change dès
  // que la main se vide ou se remplit : les zones suivent cette condition.
  const canHover = !isWatcher && hand.length === 0;
  hoveredCounter = canHover ? hitCounter(lx, ly) : null;
  hoveredCounterBox = canHover ? hitCounterBox(counterBoxes, lx, ly) : null;

  if (panning) {
    cameraX -= (sx - lastMouseX) / zoom;
    cameraY -= (sy - lastMouseY) / zoom;
    lastMouseX = sx;
    lastMouseY = sy;
    return;
  }

  if (hand.length > 0) {
    const dx = lx - handWorldX;
    const dy = ly - handWorldY;
    for (const counter of hand) {
      counter.x += dx;
      counter.y += dy;
    }
    handWorldX = lx;
    handWorldY = ly;
    movesDirty = true;
    counterInfoText = handInfoText();
  }

  lastMouseX = sx;
  lastMouseY = sy;
}

function onMouseUp(): void {
  panning = false;
}

// -------------------------------------------------
// Stack preview
// -------------------------------------------------

// Pointer position on the canvas, in screen pixels. The preview is recomputed
// every frame from it, so it follows panning, zooming and remote moves.
let pointerOnCanvas = false;
let pointerScreenX = 0;
let pointerScreenY = 0;

// every counter under (wx, wy), bottom of the stack first
function countersAt(wx: number, wy: number): Counter[] {
  return counters.filter((counter) => counter.contains(wx, wy));
}

// screen-space bounding box of a counter at the current zoom, rotation included
function previewCellSize(counter: Counter): [number, number] {
  const angle = (counter.orientation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return [
    (counter.width * cos + counter.height * sin) * zoom,
    (counter.width * sin + counter.height * cos) * zoom,
  ];
}

/**
 * Draws, in screen space, a popup holding every counter under the pointer when
 * at least two overlap there. Counters keep their stacking order (left to
 * right, then top to bottom), their face and their orientation.
 */
function drawStackPreview(): void {
  // while dragging, the held counters are the ones under the pointer
  if (!pointerOnCanvas || panning || hand.length > 0) return;

  const [wx, wy] = screenToWorld(pointerScreenX, pointerScreenY);
  const [lx, ly] = flipPoint(wx, wy);
  const stack = countersAt(lx, ly).filter((counter) => counter.image.complete);
  if (stack.length < 2) return;

  // uniform cells, sized on the largest counter of the stack
  let cellWidth = 0;
  let cellHeight = 0;
  for (const counter of stack) {
    const [w, h] = previewCellSize(counter);
    cellWidth = Math.max(cellWidth, w);
    cellHeight = Math.max(cellHeight, h);
  }

  // as many columns as fit beside the pointer, wrapping to new rows otherwise
  const roomRight = canvas.width - pointerScreenX - STACK_PREVIEW_OFFSET;
  const roomLeft = pointerScreenX - STACK_PREVIEW_OFFSET;
  const room = Math.max(roomRight, roomLeft) - 2 * STACK_PREVIEW_PADDING;
  const maxColumns = Math.max(1, Math.floor((room + STACK_PREVIEW_GAP) / (cellWidth + STACK_PREVIEW_GAP)));
  const columns = Math.min(stack.length, maxColumns);
  const rows = Math.ceil(stack.length / columns);

  const popupWidth = columns * cellWidth + (columns - 1) * STACK_PREVIEW_GAP + 2 * STACK_PREVIEW_PADDING;
  const popupHeight = rows * cellHeight + (rows - 1) * STACK_PREVIEW_GAP + 2 * STACK_PREVIEW_PADDING;

  // to the right of the pointer, or to its left when it would not fit
  let popupX = pointerScreenX + STACK_PREVIEW_OFFSET;
  if (popupX + popupWidth > canvas.width && roomLeft > roomRight) {
    popupX = pointerScreenX - STACK_PREVIEW_OFFSET - popupWidth;
  }
  // vertically centered on the pointer, kept inside the canvas
  let popupY = pointerScreenY - popupHeight / 2;
  popupY = Math.max(0, Math.min(canvas.height - popupHeight, popupY));

  ctx.save();
  ctx.fillStyle = "rgba(30, 30, 30, 0.92)";
  ctx.fillRect(popupX, popupY, popupWidth, popupHeight);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffd700";
  ctx.strokeRect(popupX, popupY, popupWidth, popupHeight);

  // clip so a counter shadow or border never spills out of the popup
  ctx.beginPath();
  ctx.rect(popupX, popupY, popupWidth, popupHeight);
  ctx.clip();

  stack.forEach((counter, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = popupX + STACK_PREVIEW_PADDING + column * (cellWidth + STACK_PREVIEW_GAP);
    const cellY = popupY + STACK_PREVIEW_PADDING + row * (cellHeight + STACK_PREVIEW_GAP);
    // the counter center lands on the cell center: rotation is around it
    const centerX = cellX + cellWidth / 2;
    const centerY = cellY + cellHeight / 2;
    ctx.setTransform(
      zoom,
      0,
      0,
      zoom,
      centerX - (counter.x + counter.width / 2) * zoom,
      centerY - (counter.y + counter.height / 2) * zoom,
    );
    counter.draw(ctx);
  });

  ctx.restore();
}

// Un pointeur qui quitte le canvas ne peut plus s'en éloigner : le seul signal
// qu'il enverra pour arrêter est son retour. Sans cette remise à zéro, la carte
// continuerait de défiler indéfiniment, et le joueur n'aurait plus le moyen de
// l'arrêter autrement qu'en revenant au bord, ce qui le relance. Le défilement
// repart au retour, avec son délai d'entrée.
function onMouseLeave(): void {
  edgeInside = false;
  pointerOnCanvas = false;
  onMouseUp();
}

// ---------------------------------------------
// Gestes de la caméra : suivi du pointeur
// ---------------------------------------------

// Le pointeur est-il dans une bande de défilement ? C'est le seul état qui
// commande l'arrêt : le défilement dure tant que le pointeur y reste, et
// s'interrompt dès qu'il en sort.
let edgeInside = false;

// Instant où le défilement devient permis. Nul tant que le pointeur n'a pas
// touché de bord.
let edgeArmedAt = 0;

// Horloge de la boucle de dessin : le défilement se déplace d'un pas de temps
// réel, pas d'un rafraîchissement, pour que sa vitesse ne dépende pas du nombre
// d'images par seconde.
let lastFrameAt = 0;

// Le pointeur est-il dans une bande, et assez longtemps pour que ce geste soit
// une intention plutôt qu'un frôlement ?
function edgeScrolling(): boolean {
  if (!edgeInside) return false;
  return Date.now() >= edgeArmedAt;
}

function trackPointerForEdgeScroll(sx: number, sy: number): void {
  edgeX = sx;
  edgeY = sy;

  // Un pointeur pressé contre un bord ne quitte jamais la bande : la minuterie
  // ne doit donc être remise qu'à son entrée, sinon le défilement ne démarrerait
  // jamais. Le défilement s'arrête quand le pointeur s'écarte, rien d'autre.
  const inside =
    Math.abs(edgeSignedOnAxis(sx, canvas.width)) > 0 ||
    Math.abs(edgeSignedOnAxis(sy, canvas.height)) > 0;
  if (inside && !edgeInside) {
    edgeArmedAt = Date.now() + EDGE_SCROLL_DELAY_MS;
  }
  edgeInside = inside;
}

/**
 * Le double-clic retourne le pion sous le pointeur. Le simple-clic, lui, le
 * prend en main : les deux gestes se cumulent, comme dans le Vietnam d'avant,
 * où un double-clic attrapait le compteur et le retournait en même temps.
 */
function onDoubleClick(event: MouseEvent): void {
  // un spectateur regarde : il ne retourne rien. Le serveur refuse de son côté,
  // le double-clic n'a donc rien à lui demander.
  if (isWatcher) return;

  const [wx, wy] = screenToWorld(event.offsetX, event.offsetY);
  const [lx, ly] = flipPoint(wx, wy);
  // un pion en main a quitté sa case : c'est lui que le pointeur vise, pas ce
  // qui se trouve dessous
  const held = hand.find((counter) => counter.contains(lx, ly));
  const hit = held ?? hitCounter(lx, ly);
  if (hit === null) return;

  requestFlip(hit);
}

function onMouseWheel(event: WheelEvent): void {
  event.preventDefault();

  const mx = event.offsetX;
  const my = event.offsetY;
  const [wx, wy] = screenToWorld(mx, my);

  zoom *= event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

  cameraX = wx - mx / zoom;
  cameraY = wy - my / zoom;
}

// -------------------------------------------------
// Dessin
// -------------------------------------------------

function draw(): void {
  initializeCamera();
  // le setup attend que tout soit charge, comme la camera attend les plateaux
  maybeRequestSetup();

  ctx.fillStyle = "gray";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.setTransform(
    zoom,
    0,
    0,
    zoom,
    -cameraX * zoom,
    -cameraY * zoom,
  );

  for (const board of boards) {
    drawBoard(board, ctx);
  }

  // les compteurs par-dessus le plateau : un cadre et un nombre, que les deux
  // zones + et - viennent recouvrir
  for (const box of counterBoxes) {
    drawAtDisplay(ctx, box.x, box.y, box.width, box.height, () => {
      drawCounterBox(ctx, box);
    });
  }

  // le bouton de repositionnement est réservé aux joueurs
  if (!isWatcher && buttonFix) buttonFix.draw(ctx);

  // les fantômes de case d'origine passent sous les pions, pour que le pion
  // réel posé dessus reste lisible
  for (const counter of counters) {
    if (!counter.showsOriginGhost) continue;
    const originX = counter.originX;
    const originY = counter.originY;
    if (originX === null || originY === null) continue;
    drawAtDisplay(ctx, originX, originY, counter.width, counter.height, () => {
      counter.drawOriginGhost(ctx);
    });
  }

  // les pions sont dessinés dans l'ordre de la liste : un pion plus loin dans
  // la liste recouvre ceux d'avant. Un relâchement remet le pion en fin de
  // liste, si bien qu'il reste au-dessus de la pile qu'il vient de rejoindre.
  for (const counter of counters) {
    if (hand.includes(counter)) continue;
    if (counter.image.complete) {
      drawCounterAtDisplay(counter);
    }
  }

  // la main se dessine après le plateau : un pion sélectionné est toujours
  // visible, au-dessus des pions non sélectionnés
  for (const counter of hand) {
    if (counter.image.complete) {
      drawCounterAtDisplay(counter);
    }
  }

  // les zones de rotation par-dessus le pion survolé. Elles ne s'affichent que
  // pour un joueur, pion orientable, main vide : un pion qu'on s'apprête à
  // saisir n'a pas besoin de ce repère, et un spectateur n'agit pas sur le jeu
  if (!isWatcher && hand.length === 0 && hoveredCounter?.orientable) {
    const counter = hoveredCounter;
    drawAtDisplay(ctx, counter.x, counter.y, counter.width, counter.height, () => {
      counter.drawRotationZones(ctx);
    });
  }

  // les zones + et - par-dessus le compteur survolé. Comme les zones de
  // rotation d'un pion, elles ne s'affichent que pour un joueur, main vide : un
  // spectateur n'agit pas sur le jeu, et la main occupe déjà l'écran
  if (!isWatcher && hand.length === 0 && hoveredCounterBox !== null) {
    const box = hoveredCounterBox;
    drawAtDisplay(ctx, box.x, box.y, box.width, box.height, () => {
      drawCounterActionZones(ctx, box);
    });
  }

  for (const dice of dices) {
    const image = dice.face();
    if (!image?.complete) continue;
    drawAtDisplay(ctx, dice.x, dice.y, dice.width, dice.height, () => {
      ctx.drawImage(image, dice.x, dice.y, dice.width, dice.height);
      // le dé assombrit pendant son délai : on voit qu'il n'est pas encore
      // jouable plutôt que de constater qu'un clic a été ignoré
      if (dice.isLocked()) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(dice.x, dice.y, dice.width, dice.height);
      }
    });
  }

  ctx.restore();

  // les boutons "flip" par-dessus le jeu, pour rester cliquables même quand un
  // pion passe sous eux, mais sous le bandeau d'info, comme le bouton "fixe la
  // position" : le nom du pion sélectionné doit rester lisible d'un bout à
  // l'autre. Un plateau retourné occupe le même rectangle, son bouton reste
  // donc au même endroit à l'écran.
  for (const plate of flipPlates) {
    placeFlipButton(plate).draw(ctx);
  }

  // above the game and the flip buttons, below the info bar
  drawStackPreview();

  // barre d'info (écran) : nom + position du pion
  if (counterInfoText) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, 28);
    ctx.fillStyle = "white";
    ctx.font = "bold 16px monospace";
    ctx.fillText(counterInfoText, 10, 20);
  }
}

// -------------------------------------------------
// Messages du serveur Tourtoirac
// -------------------------------------------------

function handleServerMessage(raw: unknown): void {
  const data = raw as GameServerMessage;
  if (!data || typeof data !== "object") return;

  console.log("[WS] Message reçu :", JSON.stringify(data));

  try {
    if (data.event === "acquire" || data.event === "release") {
      const answer = data as unknown as HandEvent;
      const isOwnRequest =
        pending?.action === answer.event && pending.componentId === answer.component_id;

      if (isOwnRequest) {
        clearPending();
      }

      if (!answer.success) {
        console.warn("[WS]", answer.event, "refusé pour", answer.component_id);
        return;
      }

      applyHandEvent(answer, isOwnRequest);
    } else if (data.event === "move") {
      applyRemoteMove(data as unknown as MoveEvent);
    } else if (data.event === "roll") {
      applyRoll(data as unknown as RollEvent);
    } else if (data.event === "rotate") {
      applyRotate(data as unknown as RotateEvent);
    } else if (data.event === "flip") {
      applyFlip(data as unknown as FlipEvent);
    } else if (data.event === "counter_value") {
      applyCounterValue(data as unknown as CounterValueEvent);
    } else if (data.event === "fix_positions") {
      applyFixPositions(data as unknown as FixPositionsEvent);
    } else if (data.event === "setup") {
      applySetup(data as unknown as SetupEvent);
    } else if (data.event === "session_status") {
      applySessionStatus(data as unknown as SessionStatusEvent);
    } else if (data.event === "session_closed") {
      applySessionClosed();
      // l'owner qui vient de cliquer part sur le lobby, les autres restent
      // sur la partie close
      if (pendingClose) {
        pendingClose = false;
        window.location.href = leaveUrl;
      }
    } else if (data.event === "error") {
      reportServerError(data as unknown as ServerErrorEvent);
    } else if (data.event === "session_created" || data.event === "session_joined") {
      handleSessionEvent(data);
    }
  } catch (e) {
    console.error("Erreur traitement message:", e);
  }
}

// Une partie close n'existe plus côté back-end : seuls ces refusent
// Justifient d'une fenêtre, les autres erreurs restent dans la console comme
// le fait déjà le reste de la page.
const CLOSE_ERRORS = [
  "not_session_owner",
  "session_closed",
  "session_state_not_stored",
  "session_not_archived",
];

// Le serveur ne connait plus la session : Tourtoirac la garde en memoire, un
// redemarrage l'a perdue. Le plateau affiche n'est qu'un instantane local,
// aucun pion n'y est prenable ; on vide la session morte et on revient au lobby
// plutot que de laisser un plateau qui ne repond plus.
const DEAD_SESSION_ERRORS = ["session_not_found", "no_session"];

let leavingDeadSession = false;

// refus d'un acquire : la partie n'a pas commencé ou un joueur manque. La
// requête en vol n'aura pas de réponse, la main doit se libérer tout de suite.
const ACQUIRE_ERRORS = ["session_not_started", "players_missing"];

// refus du démarrage : le bouton redevient cliquable
const START_ERRORS = [
  "not_session_owner",
  "session_already_started",
  "session_start_not_stored",
  "watcher_not_allowed",
];

function reportServerError(data: ServerErrorEvent): void {
  const code = data.error?.code;
  console.warn("[WS] Erreur du serveur :", code, data.error?.message);

  if (code && ACQUIRE_ERRORS.includes(code)) {
    clearPending();
    return;
  }

  if (code && START_ERRORS.includes(code)) {
    pendingStart = false;
    updateLeaveLinks();
    if (code !== "session_already_started") {
      window.alert(data.error?.message ?? "La partie n'a pas pu être démarrée.");
    }
    return;
  }

  // la partie a commencé sans ce pseudo : il n'y a pas de siège, on ne peut que
  // revenir au lobby, pour la regarder en spectateur par exemple
  if (code === "session_started") {
    if (leavingDeadSession) return;
    leavingDeadSession = true;
    clearSession();
    window.alert(
      "Cette partie a commencé sans toi.\n\n" +
        "Tu reviens au lobby : tu peux la regarder en spectateur.",
    );
    window.location.href = leaveUrl;
    return;
  }

  if (code && DEAD_SESSION_ERRORS.includes(code)) {
    if (leavingDeadSession) return;
    leavingDeadSession = true;
    clearPending();
    clearSession();
    window.alert(
      "Cette partie n'existe plus côté serveur.\n\n" +
        "Tu reviens au lobby : relance une partie pour jouer.",
    );
    window.location.href = leaveUrl;
    return;
  }

  if (!code || !CLOSE_ERRORS.includes(code)) return;

  // la partie n'est pas close : on ne part pas sur le lobby
  pendingClose = false;
  window.alert(data.error?.message ?? "La partie n'a pas pu être close.");
}

// Un composant en mouvement chez un autre joueur :
// on ne touche pas aux composants tenus par ce joueur-ci.
function applyRemoteMove(message: MoveEvent): void {
  const counter = countersById.get(message.component_id);
  if (!counter) return;

  const state = message.coordinates;
  if (!state) return;

  // le rectangle vert est synchronisé même pour celui qui déplace
  if (typeof state.in_place === "boolean") counter.inPlace = state.in_place;

  // la position, elle, suit la souris locale tant que le jeton est en main
  if (hand.includes(counter)) return;
  counter.x = state.x;
  counter.y = state.y;
}

// un joueur a remis le rectangle vert : appliqué par tous les écrans
function applyFixPositions(message: FixPositionsEvent): void {
  for (const component of message.components ?? []) {
    applyComponentState(component);
  }
}

// -------------------------------------------------
// Mise en place du jeu
// -------------------------------------------------

// Le setup attend que tout soit charge. Un pion dont l'image arrive plus tard
// changerait de place sous les yeux du joueur, et un plateau pas encore connu
// ferait cadrer la caméra sur un monde qui n'est plus le bon.
function allComponentsLoaded(): boolean {
  if (!allBoardsLoaded(boards)) return false;
  for (const counter of counters) {
    if (!counter.image.complete) return false;
  }
  for (const dice of dices) {
    for (const face of dice.faces.values()) {
      if (!face.complete) return false;
    }
  }
  return true;
}

// Le client ne choisit aucune position : il dit seulement "tout est charge, vous
// pouvez installer la partie". Le serveur applique son setup, qu'il detient seul,
// et le diffuse a tous les ecrans, celui qui a demande compris.
function maybeRequestSetup(): void {
  if (pendingSetup.length === 0 || setupRequested) return;
  // un spectateur regarde la partie, il ne l'installe pas
  if (isWatcher) return;
  if (!allComponentsLoaded()) return;

  setupRequested = true;
  getSocket()?.send({ action: "apply_setup" });
}

// Le setup a ete applique : chaque ecran replace ses composants, quel que soit
// le genre du composant. Un plateau deplace change le monde a cadrer, donc la
// camera doit le revoir.
function applySetup(message: SetupEvent): void {
  let boardMoved = false;

  for (const state of message.components ?? []) {
    if (typeof state.x !== "number" || typeof state.y !== "number") continue;

    const board = boards.find((candidate) => candidate.name === state.id);
    if (board !== undefined) {
      board.x = state.x;
      board.y = state.y;
      boardMoved = true;
      continue;
    }

    const token = countersById.get(state.id);
    if (token !== undefined) {
      token.x = state.x;
      token.y = state.y;
      // la case de depart suit le setup : c'est la que revient le pion et la
      // que montre le rectangle vert. Le fantome, lui, reste sur sa case
      // d'origine : on ne touche pas a originX/originY ici.
      token.initialX = typeof state.initial_x === "number" ? state.initial_x : state.x;
      token.initialY = typeof state.initial_y === "number" ? state.initial_y : state.y;
      if (typeof state.in_place === "boolean") token.inPlace = state.in_place;
      // un pion sans dos garde sa face : le serveur ne l'a pas retournee
      if (state.side !== undefined) token.setSide(state.side);
      continue;
    }

    const box = counterBoxesById.get(state.id);
    if (box !== undefined) {
      box.x = state.x;
      box.y = state.y;
      continue;
    }

    const dice = dicesById.get(state.id);
    if (dice !== undefined) {
      dice.x = state.x;
      dice.y = state.y;
    }
  }

  if (boardMoved) cameraInitialized = false;

  // le serveur ne renverra plus de setup : la partie est installee
  pendingSetup = [];
}

function handleSessionEvent(data: GameServerMessage): void {
  const session = data.session;
  if (!session?.key) return;
  if (currentSession && session.key !== currentSession.key) return;

  // le serveur fait foi : c'est lui qui dit si l'on joue ou si l'on regarde,
  // et si l'on a le droit de clore la partie
  const event = data as unknown as SessionCreatedEvent;
  if (event.role) isWatcher = event.role === "watcher";
  if (typeof event.owner === "boolean") isOwner = event.owner;
  if (typeof session.started === "boolean") isStarted = session.started;
  if (Array.isArray(session.missing_players)) missingPlayers = session.missing_players;
  updateLeaveLinks();

  currentSession = session;
  storeSession(session);
  updateSessionInfo();
  setupFixButton(session);

  // la situation initiale n'est chargée qu'une seule fois. Le test sur
  // counters ne suffisait plus : une partie sans pion le relisait à chaque
  // message de session et remettait les dés à zéro
  if (!componentsLoaded) {
    componentsLoaded = true;
    loadComponents(session.components);
  }

  // le setup en attente n'est lu qu'avec la situation initiale, comme elle. Le
  // serveur le vide des qu'il est applique : le relire a chaque message de
  // session ré-armerait la mise en place une seconde fois.
  if (!setupRead) {
    setupRead = true;
    pendingSetup = session.setup ?? [];
  }
}

// Le serveur annonce l'état de la partie : démarrée ou non, et qui manque.
function applySessionStatus(message: SessionStatusEvent): void {
  isStarted = message.started;
  missingPlayers = message.missing_players ?? [];
  if (isStarted) pendingStart = false;
  updateLeaveLinks();
  updateSessionInfo();
}

// La partie a été archivée par son owner. Les joueurs restants deviennent des
// spectateurs : le jeu reste affiché, figé, et seul l'owner qui a cliqué repart.
function applySessionClosed(): void {
  isClosed = true;
  isWatcher = true;
  isOwner = false;
  // une requête en vol attendait une réponse qui ne viendra plus
  clearPending();
  updateLeaveLinks();
  updateSessionInfo();
}

// -------------------------------------------------
// Initialisation
// -------------------------------------------------

// Le bouton de retour ramène sur l'onglet du jeu d'origine ; repli index.html
// si la page a été ouverte sans paramètre (lien direct, marque-page). Un bouton
// n'a pas de href : c'est le clic qui porte la navigation.
const leaveUrl = lobbyReturnUrl(originGameName());

function goToLobby(): void {
  window.location.assign(leaveUrl);
}

const backLink = document.getElementById("back-link");
if (backLink) {
  backLink.addEventListener("click", goToLobby);
}

// Le second bouton n'existe que pour l'owner : le serveur le dit dans l'événement
// de session, cette page se contente de le montrer ou de le cacher.
const closeLink = document.getElementById("close-link");

// Le bouton de démarrage n'est proposé qu'à l'owner, tant que la partie n'a pas
// commencé. Le serveur vérifie lui aussi l'owner : la page ne fait que suivre ce
// qu'il annonce. Une fois cliqué, le bouton attend la réponse du serveur.
const startLink = document.getElementById("start-link") as HTMLButtonElement | null;

// une demande de démarrage est-elle en vol ?
let pendingStart = false;

function updateLeaveLinks(): void {
  if (startLink) {
    startLink.hidden = !isOwner || isStarted || isWatcher || isClosed;
    startLink.disabled = pendingStart;
  }
  if (!closeLink) return;
  closeLink.hidden = !isOwner || isClosed;
}

function onStartSession(): void {
  if (pendingStart || isStarted) return;
  if (!window.confirm(
    "Démarrer la partie ?\n\n" +
      "Plus aucun nouveau joueur ne pourra la rejoindre.",
  )) {
    return;
  }

  const socket = getSocket();
  if (!socket) {
    window.alert("Connexion au serveur impossible : la partie n'est pas démarrée.");
    return;
  }

  pendingStart = true;
  updateLeaveLinks();
  socket.send({ action: "start_session" });
  console.log("[WS] Envoyé :", JSON.stringify({ action: "start_session" }));
}

if (startLink) {
  startLink.addEventListener("click", onStartSession);
}

// l'owner a-t-il demandé la clôture ? c'est lui, et lui seul, qui part sur le
// lobby une fois la partie archivée
let pendingClose = false;

function onCloseSession(): void {
  if (!window.confirm(
    "Clore la partie ?\n\n" +
      "Elle sera archivée et ne pourra plus être rejouée. " +
      "Les joueurs encore connectés regarderont la partie telle qu'elle est.",
  )) {
    return;
  }

  const socket = getSocket();
  if (!socket) {
    window.alert("Connexion au serveur impossible : la partie reste ouverte.");
    return;
  }

  pendingClose = true;
  socket.send({ action: "close_session" });
  console.log("[WS] Envoyé :", JSON.stringify({ action: "close_session" }));
}

if (closeLink) {
  closeLink.hidden = true;
  closeLink.addEventListener("click", onCloseSession);
}

// -------------------------------------------------
// Copie d'écran
// -------------------------------------------------

// Le nom du fichier vient de l'URL et n'est donc pas maîtrisé : on n'en garde
// que ce qui est sûr dans un nom de fichier, pour ne pas produire un nom que le
// navigateur tronque ou refuse.
function screenshotFilename(): string {
  const game = (originGameName() ?? "partie").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  // deux parties lancées dans la même seconde ne doivent pas s'écraser
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `obg-${game || "partie"}-${stamp}.png`;
}

// Un canvas est une surface DrawingML : la seule façon de la photographier
// depuis la page est de la redessiner ailleurs. On récupère ce qu'on peut — le
// contenu réellement affiché, dans la résolution réellement affichée, donc sans
// le bandeau ni la bordure du canvas.
async function downloadScreenshot(): Promise<void> {
  let blob: Blob | null = null;
  try {
    // toBlob est asynchrone et rend la main à la boucle de jeu : l'image
    // capturée est l'image encodée au moment de l'appel, pas celle qui passera
    // à l'écran une frame plus tard.
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
  } catch (error) {
    // Un canvas pollué — une image du jeu servie depuis un autre domaine — fait
    // jeter toBlob. Le joueur doit l'apprendre : sans quoi il reclique et
    // croirait à un bouton cassé.
    console.warn("[capture] Capture impossible", error);
  }

  if (blob === null) {
    window.alert(
      "Copie d'écran impossible.\n\n" +
        "Les images du jeu sont peut-être servies depuis un autre domaine, " +
        "ce qui interdit au navigateur de les lire.",
    );
    return;
  }

  // Le lien est jetable : il ne rejoint pas le document, il ne sert qu'à
  // déclencher le téléchargement.
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = screenshotFilename();
  link.click();
  // Libérer l'URL trop tôt annulerait le téléchargement dans certains
  // navigateurs : le clic n'a pas encore été pris en compte.
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

const screenshotLink = document.getElementById("screenshot-link") as HTMLButtonElement | null;
if (screenshotLink) {
  screenshotLink.addEventListener("click", () => {
    // L'encodage d'une grande surface prend une fraction de seconde : sans ça,
    // deux clics rapides lancent deux téléchargements et le second échoue.
    if (screenshotLink.disabled) return;
    screenshotLink.disabled = true;
    void downloadScreenshot().finally(() => {
      screenshotLink.disabled = false;
    });
  });
}

loadComponents(currentSession?.components);
setupFixButton(currentSession);
// une session déjà connue est resynchronisée par le resume_session, pas par un
// nouveau chargement de la situation
componentsLoaded = currentSession?.key !== undefined;

const socket = getSocket();
if (socket) {
  socket.setMessageHandler(handleServerMessage);
  // une coupure annule la requête en attente : la main n'est plus verrouillée
  socket.setStateHandler((message) => {
    if (!message.connected) {
      clearPending();
      return;
    }
    // le lobby et le jeu sont deux pages distinctes : le jeu ouvre sa propre
    // connexion, qui doit revendiquer la session avant tout acquire/move.
    if (currentSession?.key) {
      const identity = loadPlayerIdentity();
      socket.send({
        action: "resume_session",
        session_key: currentSession.key,
        // la session peut avoir ete retiree de la memoire apres le depart du
        // lobby : le code permet au serveur de la reconstruire
        session_code: currentSession.code,
        nickname: identity?.name ?? "Anonymous",
        role: identity?.role ?? "player",
      });
    }
  });
}

// -------------------------------------------------
// Boucle du jeu
// -------------------------------------------------

function gameLoop(): void {
  // Le temps réel, pas le temps disponible : deux rafraîchissements successifs
  // peuvent recevoir le même timestamp, et une frame longue ne doit pas non
  // plus faire sauter la carte d'un coup.
  const now = performance.now();
  const dt = lastFrameAt === 0 ? 0 : Math.min(EDGE_SCROLL_MAX_FRAME_MS, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  stepEdgeScroll(dt);
  draw();
  flushMoves();
  window.requestAnimationFrame(gameLoop);
}

window.requestAnimationFrame(gameLoop);

// -------------------------------------------------
// Événements
// -------------------------------------------------

new ResizeObserver(fitCanvasSize).observe(canvas);

canvas.addEventListener("mousedown", onMouseDown);
canvas.addEventListener("dblclick", onDoubleClick);
canvas.addEventListener("mousemove", onMouseMove);
canvas.addEventListener("mouseup", onMouseUp);
canvas.addEventListener("mouseleave", onMouseLeave);
canvas.addEventListener("wheel", onMouseWheel, { passive: false });

// relâchement hors du canvas
window.addEventListener("mouseup", onMouseUp);

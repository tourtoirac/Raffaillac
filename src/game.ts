import { bagUnder, createBag, drawBag, hitBag } from "./engine/bag";
import type { Bag } from "./engine/bag";
import { Button } from "./engine/button";
import { allBoardsLoaded, boardDims, createBoard, createBoardGroup, flipArea, flippedGroup } from "./engine/board";
import type { Board, BoardGroup } from "./engine/board";
import { Counter } from "./engine/counter";
import { snapToHex, traceHex, traceHexesIn } from "./engine/hex_grid";
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
import type { DicePool } from "./engine/dice";
import { lobbyReturnUrl, originGameName } from "./navigation";
import { clearSession, loadPlayerIdentity, loadSession, storeSession } from "./session";
import type {
  AcquireEvent,
  BagItem,
  BoardGroupItem,
  BoardItem,
  ComponentState,
  CounterItem,
  CounterValueEvent,
  DiceItem,
  DicePoolItem,
  FixPositionsEvent,
  FlipEvent,
  MoveEvent,
  PickEvent,
  ReleaseEvent,
  RollEvent,
  RollPoolEvent,
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
// "flip" button of a board_group the game marks flippable: the group turns
// over on this player's screen, without changing anything for the others. It
// is anchored to the group but sized in screen pixels, pour rester cliquable à
// tous les zooms : Vietnam a un plateau de 7600 px de large, où 80 px posés
// dans le monde feraient 5 px à l'écran.
const FLIP_BUTTON_WIDTH = 70;
const FLIP_BUTTON_HEIGHT = 26;
// "roll" button of a dice_pool: it throws every dice of the pool at once. Like
// the "flip" button it is sized in screen pixels; it sits just above the dice,
// so that it never hides one of them.
const ROLL_BUTTON_WIDTH = 70;
const ROLL_BUTTON_HEIGHT = 26;
const ROLL_BUTTON_GAP = 4;
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

// Tells the player why clicking a component does nothing before the game has
// started, instead of silently ignoring the click.
function warnGameNotStarted(): void {
  window.alert(
    "Vous ne pouvez pas sélectionner de composants dans le jeu tant qu'il n'est " +
      "pas démarré. Cliquez sur le bouton Démarrer la session pour commencer à jouer",
  );
}

// Same for a started game waiting for a seated player to come back.
function warnPlayersMissing(): void {
  window.alert("Tous les joueurs doivent être présents pour pouvoir modifier la table de jeu");
}

const sessionInfo = document.getElementById("session-info");

// Le bandeau affiche le jeu et le joueur plutôt que le nom du site : on sait
// d'un coup d'œil où l'on est et sous quelle identité.
const gameTitle = document.getElementById("game-title");

// the nationality of this player's seat, as the server announces it; null for
// a watcher or a game that declares none
let myNationality: string | null = null;

function updateGameTitle(): void {
  if (!gameTitle) return;
  const gameName = originGameName() ?? "Online Boardgames";
  const nickname = loadPlayerIdentity()?.name;
  const player = nickname && myNationality ? `${nickname} (${myNationality})` : nickname;
  gameTitle.textContent = player ? `${gameName} — ${player}` : gameName;
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
// board_group components: their boards are also in "boards", in drawing order
let boardGroups: BoardGroup[] = [];
let counters: Counter[] = [];
const countersById = new Map<string, Counter>();

// les compteurs sont des composants "fixed" comme les plateaux : ils ne
// bougent pas, mais leurs deux zones + et - se cliquent
let counterBoxes: CounterBox[] = [];
const counterBoxesById = new Map<string, CounterBox>();

// un dé se lance d'un clic : ni prenable ni déplaçable
let dices: Dice[] = [];
const dicesById = new Map<string, Dice>();
// dice_pool components: their dice are also in "dices"
let dicePools: DicePool[] = [];

// bags are "fixed" components: a released token falls into them, a click takes
// one out at random. The tokens they hold are in countersById but not in
// "counters": they are not on the table.
let bags: Bag[] = [];
const bagsById = new Map<string, Bag>();

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
  // the boards of a group take its place in the drawing order
  boardGroups = [];
  boards = (components?.fixed ?? []).flatMap((item) => {
    if (item.kind === "board") return [createBoard(item as BoardItem)];
    if (item.kind === "board_group") {
      const group = createBoardGroup(item as BoardGroupItem);
      boardGroups.push(group);
      return group.boards;
    }
    return [];
  });

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
    .map((item) => createCounter(item as TokenItem));

  for (const counter of counters) {
    countersById.set(counter.name, counter);
  }

  // the tokens of a bag are built like the others, so their pictures are
  // loaded before they come out, but they stay off the table
  bagsById.clear();
  bags = (components?.fixed ?? [])
    .filter((item) => item.kind === "bag")
    .map((item) => {
      const bag = item as BagItem;
      const content = (bag.components ?? [])
        .filter((token) => token.kind === "token")
        .map(createCounter);
      return createBag(bag, content);
    });
  for (const bag of bags) {
    bagsById.set(bag.name, bag);
    for (const counter of bag.content) {
      countersById.set(counter.name, counter);
    }
  }

  dicesById.clear();
  // the dice of a pool are drawn and clicked like the others: they are listed
  // first, the dice declared alone are drawn above them
  dicePools = (components?.fixed ?? [])
    .filter((item) => item.kind === "dice_pool")
    .map((item) => {
      const pool = item as DicePoolItem;
      return { name: pool.id, dice: (pool.dice ?? []).map(createDice) };
    })
    .filter((pool) => pool.dice.length > 0);
  dices = [
    ...dicePools.flatMap((pool) => pool.dice),
    ...(components?.dice ?? []).map((item) => createDice(item as DiceItem)),
  ];

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
  setupRollButtons();
}

function createCounter(token: TokenItem): Counter {
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
    // a token waiting inside a bag has no position yet
    token.x ?? 0,
    token.y ?? 0,
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
    // null on a token that came out of a bag: it has no starting square
    token.initial_x === undefined ? token.x : token.initial_x,
    token.initial_y === undefined ? token.y : token.initial_y,
    // où poser le fantôme. Il reprend le x/y d'origine du pion, pas celui de
    // sa case de départ : le setup et "fixe la position" déplacent la
    // deuxième, jamais le fantôme.
    token.origin_x ?? null,
    token.origin_y ?? null,
  );
  // le rectangle vert vient du serveur ; absent, un pion repositionnable
  // commence sur sa case de départ
  if (typeof token.in_place === "boolean") counter.inPlace = token.in_place;
  counter.nationality = token.nationality ?? null;
  return counter;
}

function createDice(item: DiceItem): Dice {
  return new Dice(
    item.id,
    item.x,
    item.y,
    item.width,
    item.height,
    item.src_list ?? [],
    item.src,
    item.roll_delay ?? ROLL_COOLDOWN_SECONDS,
  );
}

// -------------------------------------------------
// Retournement local d'un plateau
// -------------------------------------------------

// One button per board_group the game allows to turn over; a board alone never
// turns. The flip only changes this player's view: it is neither sent to the
// server nor shared, another screen keeps the group the way its player reads
// it. The boards of the group and everything laid on them turn together.
interface FlipPlate {
  group: BoardGroup;
  button: Button;
}

let flipPlates: FlipPlate[] = [];

function setupFlipButtons(): void {
  flipPlates = boardGroups
    .filter((group) => group.flippable && group.boards.length > 0)
    .map((group) => ({
      group,
      button: new Button(0, 0, FLIP_BUTTON_WIDTH, FLIP_BUTTON_HEIGHT, "flip", () => {
        group.flipped = !group.flipped;
        // a held token follows the pointer on screen: its logical place turns
        // with the group, otherwise it would jump to the other end of the map
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
  // top-left corner of the whole group
  const area = flipArea(plate.group);
  const [x, y] = worldToScreen(area.x, area.y);
  plate.button.x = x;
  plate.button.y = y;
  return plate.button;
}

// center of the half-turn of a group: its boards swap places as one map would
function flipCenter(group: BoardGroup): [number, number] {
  const area = flipArea(group);
  return [area.x + area.width / 2, area.y + area.height / 2];
}

// the flipped group under a point, or null. Groups do not overlap: a point
// belongs to at most one of them. The whole bounding box of the group counts,
// gaps between its boards included: that box is what the half-turn maps onto
// itself.
function flippedGroupAt(x: number, y: number): BoardGroup | null {
  for (const group of boardGroups) {
    if (!group.flipped) continue;
    const area = flipArea(group);
    if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
      return group;
    }
  }
  return null;
}

// Turns a point by 180° around the center of the flipped group that contains
// it. Un demi-tour est sa propre inverse : la même fonction convertit un
// point de l'écran en point logique, et l'inverse.
function flipPoint(x: number, y: number): [number, number] {
  const group = flippedGroupAt(x, y);
  if (group === null) return [x, y];
  const [cx, cy] = flipCenter(group);
  return [2 * cx - x, 2 * cy - y];
}

// Screen top-left corner of a component's rectangle: when its center falls in
// a flipped group, the rectangle turns by 180° around the group's center.
// The component itself stays upright, only its place changes.
function displayTopLeft(x: number, y: number, width: number, height: number): [number, number] {
  const group = flippedGroupAt(x + width / 2, y + height / 2);
  if (group === null) return [x, y];
  const [cx, cy] = flipCenter(group);
  return [2 * cx - (x + width), 2 * cy - (y + height)];
}

// The board, as it reads on this screen. In a flipped group, it turns by 180°
// around the center of the group: its picture is upside down, and it swaps
// places with the boards opposite it.
function drawBoard(board: Board, context: CanvasRenderingContext2D): void {
  if (!board.image.complete) return;

  const { width, height } = boardDims(board);
  const group = flippedGroup(board);
  if (group === null) {
    context.drawImage(board.image, board.x, board.y, width, height);
    return;
  }

  const [cx, cy] = flipCenter(group);
  context.save();
  // half-turn around the flip center: (x, y) is drawn at (2cx - x, 2cy - y)
  context.translate(2 * cx, 2 * cy);
  context.scale(-1, -1);
  context.drawImage(board.image, board.x, board.y, width, height);
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

// -------------------------------------------------
// Hex grid
// -------------------------------------------------

// A board may declare a hex grid in its game_json: when its board_group has
// "magnetism": true, Tourtoirac snaps the center of a released token onto the nearest hex center. The client never
// moves the token itself: it outlines the hex the held token will land on, and
// the "G" key draws the whole grid, to calibrate it against the map.

// Tourtoirac's MOVE_THRESHOLD (Components/token.py): a token released this
// close to its starting square goes back there, which wins over the grid
const START_SQUARE_THRESHOLD = 30;

let showGrid = false;

// mirrors Token.near_initial_position on the server
function nearStartingSquare(counter: Counter, x: number, y: number): boolean {
  // a token that came out of a bag has no starting square
  if (counter.initialX === null || counter.initialY === null) return false;
  const dx = x - counter.initialX;
  const dy = y - counter.initialY;
  if (dx * dx + dy * dy <= START_SQUARE_THRESHOLD * START_SQUARE_THRESHOLD) return true;
  if (!counter.showsOriginGhost || counter.originX === null || counter.originY === null) return false;
  return Math.abs(x - counter.originX) < counter.width && Math.abs(y - counter.originY) < counter.height;
}

// the topmost board under a logical point, with the game_json size the server
// tests against
function topBoardAt(x: number, y: number): Board | null {
  for (let i = boards.length - 1; i >= 0; i -= 1) {
    const board = boards[i];
    if (x >= board.x && x <= board.x + board.width && y >= board.y && y <= board.y + board.height) {
      return board;
    }
  }
  return null;
}

// the board and hex center a held counter would be snapped onto if released
// now, mirroring Session.snap_to_grid on the server; null when it would not
function predictedHex(counter: Counter): { board: Board; center: [number, number] } | null {
  if (counter.moveBorder && nearStartingSquare(counter, counter.x, counter.y)) return null;
  const centerX = counter.x + counter.width / 2;
  const centerY = counter.y + counter.height / 2;
  const board = topBoardAt(centerX, centerY);
  if (board === null || board.grid === null || board.group?.magnetism !== true) return null;
  const snapped = snapToHex(board.grid, centerX - board.x, centerY - board.y);
  if (snapped === null) return null;
  return { board, center: [board.x + snapped[0], board.y + snapped[1]] };
}

// draws in the logical space of a board: in a flipped group, a half-turn
// around the group's center, like the tokens laid on it
function drawInBoardView(board: Board, context: CanvasRenderingContext2D, draw: () => void): void {
  const group = flippedGroup(board);
  if (group === null) {
    draw();
    return;
  }
  const [cx, cy] = flipCenter(group);
  context.save();
  context.translate(2 * cx, 2 * cy);
  context.scale(-1, -1);
  draw();
  context.restore();
}

// the whole grid of every board, limited to the visible part of the board
function drawGridOverlay(context: CanvasRenderingContext2D): void {
  const [viewLeft, viewTop] = screenToWorld(0, 0);
  const [viewRight, viewBottom] = screenToWorld(canvas.width, canvas.height);
  for (const board of boards) {
    const grid = board.grid;
    if (grid === null) continue;
    const { width, height } = boardDims(board);
    // a board of a flipped group shows its logical content turned around the
    // group's center
    let [left, top, right, bottom] = [viewLeft, viewTop, viewRight, viewBottom];
    const group = flippedGroup(board);
    if (group !== null) {
      const [cx, cy] = flipCenter(group);
      [left, top, right, bottom] = [2 * cx - viewRight, 2 * cy - viewBottom, 2 * cx - viewLeft, 2 * cy - viewTop];
    }
    left = Math.max(left, board.x) - board.x;
    top = Math.max(top, board.y) - board.y;
    right = Math.min(right, board.x + width) - board.x;
    bottom = Math.min(bottom, board.y + height) - board.y;
    if (left >= right || top >= bottom) continue;

    drawInBoardView(board, context, () => {
      context.save();
      context.translate(board.x, board.y);
      context.beginPath();
      traceHexesIn(context, grid, left, top, right, bottom);
      context.strokeStyle = "rgba(255, 0, 255, 0.8)";
      context.lineWidth = 1.5 / zoom;
      context.stroke();
      // the origin hex, from which the grid is measured
      context.beginPath();
      traceHex(context, grid, grid.originX, grid.originY);
      context.fillStyle = "rgba(255, 0, 255, 0.3)";
      context.fill();
      context.restore();
    });
  }
}

// outlines the hex each held counter would land on
function drawTargetHexes(context: CanvasRenderingContext2D): void {
  for (const counter of hand) {
    const target = predictedHex(counter);
    if (target === null) continue;
    const grid = target.board.grid;
    if (grid === null) continue;
    drawInBoardView(target.board, context, () => {
      context.beginPath();
      traceHex(context, grid, target.center[0], target.center[1]);
      context.fillStyle = "rgba(255, 255, 0, 0.25)";
      context.fill();
      context.strokeStyle = "rgba(255, 220, 0, 0.9)";
      context.lineWidth = 3 / zoom;
      context.stroke();
    });
  }
}

// with the grid shown, the pointer position relative to the board under it:
// what the game_json grid needs to be set from
function gridCalibrationText(): string {
  const [wx, wy] = screenToWorld(pointerScreenX, pointerScreenY);
  const [lx, ly] = flipPoint(wx, wy);
  const board = topBoardAt(lx, ly);
  if (board === null) return "Grid (G to hide)";
  return `Grid (G to hide)  ${board.name}  x=${Math.round(lx - board.x)}  y=${Math.round(ly - board.y)}`;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable]")) return;
  if (event.key === "g" || event.key === "G") {
    showGrid = !showGrid;
  }
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
  dice.roll(message.src);
  // le serveur fait foi : sa durée remplace celle qu'on s'était appliquée
  dice.lockFor(message.cooldown_seconds ?? dice.rollDelay);
}

// One button per dice_pool: it throws every dice of the pool at once. Unlike
// the flip, the throw is a move of the game: it goes through the server, which
// draws the faces and sends them to every screen.
interface RollPlate {
  pool: DicePool;
  button: Button;
}

let rollPlates: RollPlate[] = [];

function setupRollButtons(): void {
  rollPlates = dicePools.map((pool) => ({
    pool,
    button: new Button(0, 0, ROLL_BUTTON_WIDTH, ROLL_BUTTON_HEIGHT, "roll", () => {
      requestRollPool(pool);
    }),
  }));
}

// The pool is thrown as a whole: one dice still in its delay holds it all, as
// the server would refuse the throw.
function isPoolLocked(pool: DicePool): boolean {
  return pool.dice.some((dice) => dice.isLocked());
}

// The button, at its place on screen: just above the top-left corner of the
// rectangle enclosing the dice of the pool, where they are drawn. It is placed
// again at each use, as the dice move under it with the camera, the setup and
// the flip of a board_group.
function placeRollButton(plate: RollPlate): Button {
  let left = Infinity;
  let top = Infinity;
  for (const dice of plate.pool.dice) {
    const [dx, dy] = displayTopLeft(dice.x, dice.y, dice.width, dice.height);
    left = Math.min(left, dx);
    top = Math.min(top, dy);
  }
  const [x, y] = worldToScreen(left, top);
  plate.button.x = x;
  plate.button.y = y - ROLL_BUTTON_HEIGHT - ROLL_BUTTON_GAP;
  return plate.button;
}

function requestRollPool(pool: DicePool): void {
  if (isPoolLocked(pool)) return;
  // immediate local lock, as for a single dice: two quick clicks must not
  // both leave before the server answers
  for (const dice of pool.dice) dice.lockFor(dice.rollDelay);
  getSocket()?.send({ action: "roll_pool", component_id: pool.name });
}

// the faces drawn by a player for a whole pool, applied by every screen
function applyRollPool(message: RollPoolEvent): void {
  for (const entry of message.dice ?? []) {
    const dice = dicesById.get(entry.component_id);
    if (!dice) continue;
    dice.roll(entry.src);
    // the server is the reference: its delay replaces the local one
    dice.lockFor(entry.cooldown_seconds ?? dice.rollDelay);
  }
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
type PendingAction = "acquire" | "release" | "pick";
// requestId: only set for a pick, whose answer names the token, not the bag
let pending: { action: PendingAction; componentId: string; requestId?: string } | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

let handWorldX = 0;
let handWorldY = 0;
let lastMouseWorldX = 0;
let lastMouseWorldY = 0;

// la main reste verrouillée tant que le serveur n'a pas répondu
function setPending(action: PendingAction, componentId: string, requestId?: string): void {
  clearPending();
  pending = { action, componentId, requestId };
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
    const release = answer as ReleaseEvent;
    if (release.bag_id) {
      // the token fell into a bag: it leaves the table
      putInBag(counter, bagsById.get(release.bag_id));
    } else {
      applyComponentState(release.component_json);
      bringCounterToFront(counter);
    }
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

// A token released over a bag joins its content: it is no longer drawn nor
// clickable, until the server picks it again.
function putInBag(counter: Counter, bag: Bag | undefined): void {
  const index = counters.indexOf(counter);
  if (index >= 0) counters.splice(index, 1);
  if (hoveredCounter === counter) hoveredCounter = null;
  counter.inPlace = false;
  counter.initialX = null;
  counter.initialY = null;
  if (bag !== undefined && !bag.content.includes(counter)) bag.content.push(counter);
}

// The client only says which bag it clicked and where: the server chooses the
// token at random and puts it in the hand of the player.
function requestPick(bag: Bag, x: number, y: number): void {
  // an empty bag has nothing to give: the server would refuse anyway
  if (bag.content.length === 0) return;
  // the server only draws among the tokens this player may take
  if (!bag.content.some(canAcquire)) {
    counterInfoText = `${bag.name}  aucun pion de votre nationalité`;
    return;
  }
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
  const socket = getSocket();
  if (!socket) return;

  // two players may pick from the same bag at once: the id tells this
  // request's answer from the other player's
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = { action: "pick", component_id: bag.name, x, y, request_id: requestId };
  setPending("pick", bag.name, requestId);
  socket.send(message);
  console.log("[WS] Envoyé :", JSON.stringify(message));
}

// A token came out of a bag, applied by every screen: it is back on the table,
// above the others, in the hand of the player who picked it.
function applyPick(message: PickEvent): void {
  const isOwnRequest =
    pending?.action === "pick" &&
    pending.requestId !== undefined &&
    pending.requestId === message.request_id;
  if (isOwnRequest) clearPending();

  const state = message.component_json;
  if (!state) return;

  let counter = countersById.get(state.id);
  if (counter === undefined) {
    // a token this screen never heard of: built from what the server sends
    counter = createCounter(state);
    countersById.set(counter.name, counter);
  }
  const picked = counter;
  for (const bag of bags) {
    bag.content = bag.content.filter((candidate) => candidate !== picked);
  }

  counter.x = state.x ?? 0;
  counter.y = state.y ?? 0;
  counter.inPlace = false;
  counter.initialX = state.initial_x ?? null;
  counter.initialY = state.initial_y ?? null;
  if (state.side !== undefined) counter.setSide(state.side);
  if (!counters.includes(counter)) counters.push(counter);

  if (isOwnRequest) {
    // the pointer may have moved since the click: the token comes out under
    // it, so that a click on it releases it
    counter.x = lastMouseWorldX - counter.width / 2;
    counter.y = lastMouseWorldY - counter.height / 2;
    movesDirty = true;
  }

  // from here on, the token is taken in hand like one acquired on the table
  applyHandEvent(
    { event: "acquire", component_id: counter.name, user: message.user, success: true },
    isOwnRequest,
  );
}

// -------------------------------------------------
// Souris
// -------------------------------------------------

// MouseEvent.button values, and the MouseEvent.buttons bit of the right button
const MOUSE_LEFT = 0;
const MOUSE_RIGHT = 2;
const MOUSE_RIGHT_MASK = 2;

let lastMouseX = 0;
let lastMouseY = 0;
// the camera follows the pointer while the right button is held down
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

// A token that belongs to a nationality is only taken by a player of that
// nationality. The server enforces it: the page only spares a doomed request.
function canAcquire(counter: Counter): boolean {
  return counter.nationality === null || counter.nationality === myNationality;
}

function requestAcquire(counter: Counter): void {
  if (!canAcquire(counter)) {
    // said in the info bar rather than in a window: a click on a token of
    // another side is common on a crowded map
    counterInfoText = `${counter.name}  réservé à ${counter.nationality}`;
    return;
  }
  if (!isStarted) {
    warnGameNotStarted();
    return;
  }
  if (missingPlayers.length > 0) {
    warnPlayersMissing();
    return;
  }
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

  // the right button only moves the camera, whatever lies under the pointer,
  // and even with counters in hand: they follow the pointer again afterwards
  if (event.button === MOUSE_RIGHT) {
    panning = true;
    lastMouseX = sx;
    lastMouseY = sy;
    return;
  }
  // the left button acts on the game; the others do nothing, and the middle
  // one must not start the browser's autoscroll either
  if (event.button !== MOUSE_LEFT) {
    event.preventDefault();
    return;
  }
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
    // click on the "roll" button of a dice pool: drawn on screen like the
    // "flip" button, it is aimed in screen coordinates
    for (const plate of rollPlates) {
      if (placeRollButton(plate).contains(sx, sy)) {
        plate.button.callback();
        return;
      }
    }

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

    // click on a bag: one of its tokens comes out at random. A token lying
    // on the bag is drawn above it and was taken first.
    const clickedBag = hitBag(bags, lx, ly);
    if (clickedBag !== null) {
      requestPick(clickedBag, lx, ly);
      return;
    }
  }
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

  // the right button was released where no mouseup reached the page
  if (panning && (event.buttons & MOUSE_RIGHT_MASK) === 0) {
    panning = false;
  }

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

function onMouseUp(event: MouseEvent): void {
  // only releasing the right button ends the camera move
  if (event.button === MOUSE_RIGHT) panning = false;
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
  panning = false;
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

  if (showGrid) drawGridOverlay(ctx);
  // under the tokens, so the held one stays visible over its target hex
  drawTargetHexes(ctx);

  // les compteurs par-dessus le plateau : un cadre et un nombre, que les deux
  // zones + et - viennent recouvrir
  for (const box of counterBoxes) {
    drawAtDisplay(ctx, box.x, box.y, box.width, box.height, () => {
      drawCounterBox(ctx, box);
    });
  }

  // bags lie on the board, under the tokens. A bag a held token hovers over
  // is outlined: releasing the token there drops it in.
  for (const bag of bags) {
    const targeted = hand.some((counter) => bagUnder(bags, counter) === bag);
    drawAtDisplay(ctx, bag.x, bag.y, bag.width, bag.height, () => {
      drawBag(ctx, bag, targeted);
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
  // l'autre. A flipped group occupies the same bounding box, so its button
  // stays at the same place on screen.
  for (const plate of flipPlates) {
    placeFlipButton(plate).draw(ctx);
  }

  // the "roll" buttons of the dice pools, for players only: a watcher does not
  // throw. A button darkens with its dice while the pool waits for its delay.
  if (!isWatcher) {
    for (const plate of rollPlates) {
      const button = placeRollButton(plate);
      button.draw(ctx);
      if (isPoolLocked(plate.pool)) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(button.x, button.y, button.w, button.h);
      }
    }
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

  // grid calibration: pointer position relative to the board, bottom left
  if (showGrid) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, canvas.height - 28, canvas.width, 28);
    ctx.fillStyle = "white";
    ctx.font = "bold 16px monospace";
    ctx.fillText(gridCalibrationText(), 10, canvas.height - 8);
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
    } else if (data.event === "pick") {
      applyPick(data as unknown as PickEvent);
    } else if (data.event === "move") {
      applyRemoteMove(data as unknown as MoveEvent);
    } else if (data.event === "roll") {
      applyRoll(data as unknown as RollEvent);
    } else if (data.event === "roll_pool") {
      applyRollPool(data as unknown as RollPoolEvent);
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

// refusal of a pick, of an acquire aimed at a bag or at a token of another
// nationality: nothing to tell the player, but the pending request will get
// no other answer
const BAG_ERRORS = ["bag_empty", "component_not_a_bag", "component_in_bag", "wrong_nationality"];

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
    // the local state may lag behind the server: the refusal is shown anyway
    if (code === "session_not_started") warnGameNotStarted();
    if (code === "players_missing") warnPlayersMissing();
    return;
  }

  if (code && BAG_ERRORS.includes(code)) {
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
  for (const bag of bags) {
    if (bag.image !== null && !bag.image.complete) return false;
    for (const counter of bag.content) {
      if (!counter.image.complete) return false;
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
      continue;
    }

    const bag = bagsById.get(state.id);
    if (bag !== undefined) {
      bag.x = state.x;
      bag.y = state.y;
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
  if (event.nationality !== undefined) {
    myNationality = event.nationality;
    updateGameTitle();
  }
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
// the right button moves the camera: no context menu over the game
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("keydown", onKeyDown);

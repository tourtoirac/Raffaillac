import { Button } from "./engine/button";
import { allBoardsLoaded, boardDims, createBoard } from "./engine/board";
import type { Board } from "./engine/board";
import { Counter } from "./engine/counter";
import type { RotationDirection } from "./engine/counter";
import { Dice } from "./engine/dice";
import { lobbyReturnUrl, originGameName } from "./navigation";
import { loadPlayerIdentity, loadSession, storeSession } from "./session";
import type {
  AcquireEvent,
  BoardItem,
  ComponentState,
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

// un dé se lance d'un clic : ni prenable ni déplaçable
let dices: Dice[] = [];
const dicesById = new Map<string, Dice>();

// la situation a-t-elle déjà été lue depuis le serveur
let componentsLoaded = false;

// un spectateur regarde mais ne joue pas : pas de bouton "fixe la position"
let isWatcher = false;

function loadComponents(components: SessionComponents | undefined): void {
  boards = (components?.fixed ?? [])
    .filter((item) => item.kind === "board")
    .map((item) => createBoard(item as BoardItem));

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
        token.shadow ?? false,
        // un pion non orientable n'affiche aucune zone de rotation
        token.orientable ?? false,
        // l'angle atteint avant une sauvegarde de session, s'il y en a une
        token.orientation ?? 0,
        backImg,
        // la face affichée quand la partie a été sauvegardée en cours de jeu
        token.side ?? "front",
        // "transparent" demande d'afficher le pion fantôme sur sa case de départ
        token.origin ?? null,
        // case de départ, celle où revient un pion déposé sur son fantôme
        token.initial_x ?? token.x,
        token.initial_y ?? token.y,
      );
      // l'état du rectangle vient du serveur
      if (typeof token.border === "boolean") counter.border = token.border;
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
  clearPending();
  cameraInitialized = false;
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
  if (typeof state.border === "boolean") counter.border = state.border;
  // "fixe la position" déplace la case de départ : le fantôme doit suivre
  if (typeof state.initial_x === "number") counter.initialX = state.initial_x;
  if (typeof state.initial_y === "number") counter.initialY = state.initial_y;
}

const buttonFix = new Button(1350, 10, 220, 40, "Fixe la position", () => {
  // le serveur remet le rectangle vert et prévient joueurs et spectateurs
  getSocket()?.send({ action: "fix_positions" });
});

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

function hitCounter(wx: number, wy: number): Counter | null {
  for (let i = counters.length - 1; i >= 0; i -= 1) {
    if (counters[i].contains(wx, wy)) {
      return counters[i];
    }
  }
  return null;
}

// le pion sous le pointeur : ses zones de rotation ne s'affichent que pour
// celui-là, et seulement si la main est vide
let hoveredCounter: Counter | null = null;

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
  lastMouseWorldX = wx;
  lastMouseWorldY = wy;

  if (!isWatcher && buttonFix.contains(wx, wy)) {
    buttonFix.callback();
    return;
  }

  // une requête est déjà en attente de réponse du serveur
  if (pending !== null) return;

  // un spectateur regarde : il ne prend aucun pion en main. Le serveur refuse
  // l'acquire de son côté, on n'envoie donc même pas la demande. Il peut en
  // revanche déplacer la caméra comme un joueur, pour suivre la partie.
  if (!isWatcher) {
    // clic sur un dé : il se lance sur place, sans le prendre en main
    const clickedDice = hitDiceAt(wx, wy);
    if (clickedDice !== null) {
      requestRoll(clickedDice);
      return;
    }

    // clic sur un composant déjà en main : demande de relâchement
    const held = hand.find((counter) => counter.contains(wx, wy));
    if (held !== undefined) {
      requestRelease(held);
      return;
    }

    // clic sur un pion : demande d'acquisition
    const hit = hitCounter(wx, wy);
    if (hit !== null) {
      // avant de le prendre en main, on vérifie si le clic visait une zone de
      // rotation. Ces zones n'existent pas pendant qu'on tient un pion : le
      // repère est déjà occupé par ce qu'on déplace.
      if (hand.length === 0) {
        const zone = hit.rotationZoneAt(wx, wy);
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
  const [wx, wy] = screenToWorld(sx, sy);
  lastMouseWorldX = wx;
  lastMouseWorldY = wy;

  // le pion survolé alimente l'affichage des zones de rotation. Il change dès
  // que la main se vide ou se remplit : les zones suivent cette condition.
  hoveredCounter = isWatcher || hand.length > 0 ? null : hitCounter(wx, wy);

  if (panning) {
    cameraX -= (sx - lastMouseX) / zoom;
    cameraY -= (sy - lastMouseY) / zoom;
    lastMouseX = sx;
    lastMouseY = sy;
    return;
  }

  if (hand.length > 0) {
    const dx = wx - handWorldX;
    const dy = wy - handWorldY;
    for (const counter of hand) {
      counter.x += dx;
      counter.y += dy;
    }
    handWorldX = wx;
    handWorldY = wy;
    movesDirty = true;
    counterInfoText = handInfoText();
  }

  lastMouseX = sx;
  lastMouseY = sy;
}

function onMouseUp(): void {
  panning = false;
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
  // un pion en main a quitté sa case : c'est lui que le pointeur vise, pas ce
  // qui se trouve dessous
  const held = hand.find((counter) => counter.contains(wx, wy));
  const hit = held ?? hitCounter(wx, wy);
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
    if (board.image.complete) {
      const { width, height } = boardDims(board);
      ctx.drawImage(board.image, board.x, board.y, width, height);
    }
  }

  // le bouton de repositionnement est réservé aux joueurs
  if (!isWatcher) buttonFix.draw(ctx);

  // les fantômes de case de départ passent sous les pions, pour que le pion
  // réel posé dessus reste lisible
  for (const counter of counters) {
    counter.drawOriginGhost(ctx);
  }

  for (const counter of counters) {
    if (counter.image.complete) {
      counter.draw(ctx);
    }
  }

  // les zones de rotation par-dessus le pion survolé. Elles ne s'affichent que
  // pour un joueur, pion orientable, main vide : un pion qu'on s'apprête à
  // saisir n'a pas besoin de ce repère, et un spectateur n'agit pas sur le jeu
  if (!isWatcher && hand.length === 0 && hoveredCounter?.orientable) {
    hoveredCounter.drawRotationZones(ctx);
  }

  for (const dice of dices) {
    const image = dice.face();
    if (!image?.complete) continue;
    ctx.drawImage(image, dice.x, dice.y, dice.width, dice.height);
    // le dé assombrit pendant son délai : on voit qu'il n'est pas encore
    // jouable plutôt que de constater qu'un clic a été ignoré
    if (dice.isLocked()) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(dice.x, dice.y, dice.width, dice.height);
    }
  }

  ctx.restore();

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
    } else if (data.event === "fix_positions") {
      applyFixPositions(data as unknown as FixPositionsEvent);
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

function reportServerError(data: ServerErrorEvent): void {
  const code = data.error?.code;
  console.warn("[WS] Erreur du serveur :", code, data.error?.message);
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
  if (typeof state.border === "boolean") counter.border = state.border;

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

function handleSessionEvent(data: GameServerMessage): void {
  const session = data.session;
  if (!session?.key) return;
  if (currentSession && session.key !== currentSession.key) return;

  // le serveur fait foi : c'est lui qui dit si l'on joue ou si l'on regarde,
  // et si l'on a le droit de clore la partie
  const event = data as unknown as SessionCreatedEvent;
  if (event.role) isWatcher = event.role === "watcher";
  if (typeof event.owner === "boolean") isOwner = event.owner;
  updateLeaveLinks();

  currentSession = session;
  storeSession(session);
  updateSessionInfo();

  // la situation initiale n'est chargée qu'une seule fois. Le test sur
  // counters ne suffisait plus : une partie sans pion le relisait à chaque
  // message de session et remettait les dés à zéro
  if (!componentsLoaded) {
    componentsLoaded = true;
    loadComponents(session.components);
  }
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

// le lien de retour ramène sur l'onglet du jeu d'origine ; repli index.html
// si la page a été ouverte sans paramètre (lien direct, marque-page)
const leaveUrl = lobbyReturnUrl(originGameName());
const backLink = document.getElementById("back-link") as HTMLAnchorElement | null;
if (backLink) {
  backLink.href = leaveUrl;
}

// Le second lien n'existe que pour l'owner : le serveur le dit dans l'événement
// de session, cette page se contente de le montrer ou de le cacher.
const closeLink = document.getElementById("close-link") as HTMLAnchorElement | null;
if (closeLink) {
  closeLink.href = leaveUrl;
}

function updateLeaveLinks(): void {
  if (!closeLink) return;
  closeLink.hidden = !isOwner || isClosed;
}

// l'owner a-t-il demandé la clôture ? c'est lui, et lui seul, qui part sur le
// lobby une fois la partie archivée
let pendingClose = false;

function onCloseSession(event: MouseEvent): void {
  // le lien reste une ancre de secours si le serveur ne répond jamais
  event.preventDefault();

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

loadComponents(currentSession?.components);
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
canvas.addEventListener("mouseleave", onMouseUp);
canvas.addEventListener("wheel", onMouseWheel, { passive: false });

// relâchement hors du canvas
window.addEventListener("mouseup", onMouseUp);

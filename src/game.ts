import { Button } from "./engine/button";
import { allBoardsLoaded, boardDims, createBoard } from "./engine/board";
import type { Board } from "./engine/board";
import { Counter } from "./engine/counter";
import { loadPlayerIdentity, loadSession, storeSession } from "./session";
import type {
  AcquireEvent,
  BoardItem,
  MoveEvent,
  ReleaseEvent,
  Session,
  SessionComponents,
  TokenItem,
} from "./types";
import { getSocket } from "./ws/wsClient";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
const ZOOM_FACTOR = 1.1;
const RESPONSE_TIMEOUT = 2000;

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

const sessionInfo = document.getElementById("session-info");

function updateSessionInfo(): void {
  if (!sessionInfo) return;
  sessionInfo.textContent = currentSession?.key
    ? `Session ${currentSession.key}`
    : "Aucune session active";
}

updateSessionInfo();

// -------------------------------------------------
// Situation initiale
// -------------------------------------------------

let boards: Board[] = [];
let counters: Counter[] = [];
const countersById = new Map<string, Counter>();

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
      return new Counter(
        token.id,
        img,
        token.x,
        token.y,
        token.width,
        token.height,
        token.move_border ?? true,
        token.shadow ?? false,
      );
    });

  for (const counter of counters) {
    countersById.set(counter.name, counter);
  }

  hand = [];
  handAnchor = null;
  clearPending();
  cameraInitialized = false;
}

const buttonFix = new Button(1350, 10, 220, 40, "Fixe la position", () => {
  for (const counter of counters) {
    counter.startTurnReset();
  }
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

function dropCounter(counter: Counter): void {
  if (counter.moveBorder) {
    if (counter.hasMoved()) {
      counter.border = false;
    } else {
      counter.border = true;
      counter.x = counter.startTurnX;
      counter.y = counter.startTurnY;
    }
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

    // le composant relâché reprend la règle de repositionnement
    if (index >= 0) dropCounter(counter);
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

  const message = { action: "release", component_id: counter.name };
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

  if (buttonFix.contains(wx, wy)) {
    buttonFix.callback();
    return;
  }

  // une requête est déjà en attente de réponse du serveur
  if (pending !== null) return;

  // clic sur un composant déjà en main : demande de relâchement
  const held = hand.find((counter) => counter.contains(wx, wy));
  if (held !== undefined) {
    requestRelease(held);
    return;
  }

  // clic sur un pion : demande d'acquisition
  const hit = hitCounter(wx, wy);
  if (hit !== null) {
    requestAcquire(hit);
    return;
  }

  // la main occupe déjà le pion : pas de déplacement de la caméra
  if (hand.length > 0) return;

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

  buttonFix.draw(ctx);

  for (const counter of counters) {
    if (counter.image.complete) {
      counter.draw(ctx);
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
    } else if (data.event === "session_created" || data.event === "session_joined") {
      handleSessionEvent(data);
    }
  } catch (e) {
    console.error("Erreur traitement message:", e);
  }
}

// Un composant en mouvement chez un autre joueur :
// on ne touche pas aux composants tenus par ce joueur-ci.
function applyRemoteMove(message: MoveEvent): void {
  const counter = countersById.get(message.component_id);
  if (!counter) return;
  if (hand.includes(counter)) return;

  counter.x = message.x;
  counter.y = message.y;
}

function handleSessionEvent(data: GameServerMessage): void {
  const session = data.session;
  if (!session?.key) return;
  if (currentSession && session.key !== currentSession.key) return;

  currentSession = session;
  storeSession(session);
  updateSessionInfo();

  // la situation initiale n'est chargée qu'une seule fois
  if (counters.length === 0) {
    loadComponents(session.components);
  }
}

// -------------------------------------------------
// Initialisation
// -------------------------------------------------

loadComponents(currentSession?.components);

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
canvas.addEventListener("mousemove", onMouseMove);
canvas.addEventListener("mouseup", onMouseUp);
canvas.addEventListener("mouseleave", onMouseUp);
canvas.addEventListener("wheel", onMouseWheel, { passive: false });

// relâchement hors du canvas
window.addEventListener("mouseup", onMouseUp);

import { Button } from "./engine/button";
import { allBoardsLoaded, boardDims, createBoard } from "./engine/board";
import { Counter } from "./engine/counter";
import { loadSession } from "./session";
import type { BoardItem, TokenItem } from "./types";
import { getSocket } from "./ws/wsClient";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
const ZOOM_FACTOR = 1.1;

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

const session = loadSession();

const sessionInfo = document.getElementById("session-info");
if (session?.key && sessionInfo) {
  sessionInfo.textContent = `Session ${session.key}`;
} else if (sessionInfo) {
  sessionInfo.textContent = "Aucune session active";
}

function sessionComponents() {
  if (session?.components) return session.components;
  return session?.session?.components;
}

// -------------------------------------------------
// Plateaux décrits par le json
// -------------------------------------------------

const boards = (sessionComponents()?.fixed ?? [])
  .filter((item) => item.kind === "board")
  .map((item) => createBoard(item as BoardItem));

// -------------------------------------------------
// Pions décrits par le json
// -------------------------------------------------

const counters = (sessionComponents()?.movable ?? [])
  .filter((item) => item.kind === "token")
  .map((token) => {
    const item = token as TokenItem;
    const img = new Image();
    img.src = item.front_src;
    return new Counter(
      item.id,
      img,
      item.x,
      item.y,
      item.width,
      item.height,
      item.move_border ?? true,
      item.shadow ?? false,
    );
  });

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
// Souris
// -------------------------------------------------

let lastMouseX = 0;
let lastMouseY = 0;
let panning = false;
let selectedCounter: Counter | null = null;
let counterInfoText = "";

function counterPositionText(counter: Counter): string {
  return `${counter.name}  x=${Math.floor(counter.x)}  y=${Math.floor(counter.y)}`;
}

function screenToWorld(sx: number, sy: number): [number, number] {
  return [cameraX + sx / zoom, cameraY + sy / zoom];
}

function dropCounter(): void {
  if (selectedCounter === null) return;

  if (selectedCounter.moveBorder) {
    if (selectedCounter.hasMoved()) {
      selectedCounter.border = false;
    } else {
      selectedCounter.border = true;
      selectedCounter.x = selectedCounter.startTurnX;
      selectedCounter.y = selectedCounter.startTurnY;
    }
  }

  counterInfoText = counterPositionText(selectedCounter);
  selectedCounter = null;
}

function onMouseDown(event: MouseEvent): void {
  const sx = event.offsetX;
  const sy = event.offsetY;
  const [wx, wy] = screenToWorld(sx, sy);

  if (buttonFix.contains(wx, wy)) {
    buttonFix.callback();
    return;
  }

  if (selectedCounter !== null) {
    dropCounter();
    return;
  }

  let hit: Counter | null = null;
  for (let i = counters.length - 1; i >= 0; i -= 1) {
    if (counters[i].contains(wx, wy)) {
      hit = counters[i];
      break;
    }
  }

  if (hit !== null) {
    selectedCounter = hit;
    counterInfoText = counterPositionText(hit);
  } else {
    panning = true;
  }

  lastMouseX = sx;
  lastMouseY = sy;
}

function onMouseMove(event: MouseEvent): void {
  const sx = event.offsetX;
  const sy = event.offsetY;

  if (panning) {
    cameraX -= (sx - lastMouseX) / zoom;
    cameraY -= (sy - lastMouseY) / zoom;
    lastMouseX = sx;
    lastMouseY = sy;
    return;
  }

  if (selectedCounter !== null) {
    const [wx, wy] = screenToWorld(sx, sy);
    selectedCounter.x = wx - Math.floor(selectedCounter.width / 2);
    selectedCounter.y = wy - Math.floor(selectedCounter.height / 2);
    counterInfoText = counterPositionText(selectedCounter);
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
    counter.draw(ctx);
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
// WebSocket partagé (SharedWorker)
// -------------------------------------------------

const socket = getSocket();
if (socket) {
  socket.setMessageHandler((data) => {
    console.log("[WS] Message reçu :", JSON.stringify(data));
  });
}

// -------------------------------------------------
// Boucle du jeu
// -------------------------------------------------

function gameLoop(): void {
  draw();
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
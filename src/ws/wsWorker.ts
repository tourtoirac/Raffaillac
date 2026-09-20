/// <reference lib="webworker" />

interface WorkerMessage {
  type: "send" | "connect";
  data?: unknown;
}

let ws: WebSocket | null = null;
let wsUrl: string | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let configLoaded = false;

const MAX_RECONNECT_DELAY = 15000;
const ports = new Set<MessagePort>();

function broadcast(message: unknown): void {
  ports.forEach((port) => {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  });
}

function setState(state: boolean, message: string): void {
  connected = state;
  broadcast({ type: "state", connected: state, message, configLoaded });
}

function connect(): void {
  if (!wsUrl) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    attempts = 0;
    setState(true, "Connecté");
  };

  ws.onmessage = (event) => {
    try {
      broadcast({ type: "ws", data: JSON.parse(event.data as string) });
    } catch {
      console.error("[ws_worker] Message JSON invalide reçu :", event.data);
    }
  };

  ws.onerror = (event) => {
    console.error("[ws_worker] Erreur WebSocket :", event);
  };

  ws.onclose = () => {
    ws = null;
    setState(false, "Déconnecté");
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
  }
  const delay = Math.min(1000 * Math.pow(2, attempts), MAX_RECONNECT_DELAY);
  attempts += 1;
  reconnectTimer = setTimeout(connect, delay);
}

function handlePortMessage(event: MessageEvent): void {
  const message = event.data as WorkerMessage;
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "send":
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message.data));
      } else {
        console.warn("[ws_worker] WebSocket non connectée, message non envoyé :", message.data);
      }
      break;
    case "connect":
      connect();
      break;
    default:
      console.warn("[ws_worker] Type de message inconnu :", message.type);
  }
}

async function loadConfig(): Promise<void> {
  try {
    const response = await fetch("/conf.json");
    const config = await response.json() as { host: string; port: number };
    wsUrl = `ws://${config.host}:${config.port}`;
    configLoaded = true;
    connect();
  } catch (error) {
    console.error("[ws_worker] Erreur chargement conf.json :", error);
    setState(false, "Config introuvable");
  }
}

function onconnect(event: MessageEvent): void {
  const port = event.ports[0];
  ports.add(port);

  port.onmessage = (e: MessageEvent) => handlePortMessage(e);

  port.postMessage({
    type: "state",
    connected,
    message: connected ? "Connecté" : "Connexion en cours...",
    configLoaded,
  });

  if (!configLoaded) {
    void loadConfig();
  } else {
    connect();
  }
}

const workerScope = self as unknown as SharedWorkerGlobalScope;
workerScope.onconnect = onconnect;

export {};
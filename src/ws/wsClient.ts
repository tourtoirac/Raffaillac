import WsWorker from "./wsWorker?sharedworker&worker";

export interface SocketStateMessage {
  type: "state";
  connected: boolean;
  message: string;
  configLoaded: boolean;
}

export interface SocketWsMessage {
  type: "ws";
  data: unknown;
}

export interface ObgSocket {
  send(data: unknown): void;
  setMessageHandler(fn: (data: unknown) => void): void;
  setStateHandler(fn: (message: SocketStateMessage) => void): void;
}

declare global {
  interface Window {
    obgSocket?: ObgSocket;
  }
}

function createSocket(): ObgSocket | null {
  let worker: SharedWorker;
  try {
    worker = new WsWorker();
  } catch (error) {
    console.error("[ws_client] SharedWorker indisponible :", error);
    return null;
  }

  let wsHandler: ((data: unknown) => void) | null = null;
  let stateHandler: ((message: SocketStateMessage) => void) | null = null;
  const buffer: unknown[] = [];

  function deliver(data: unknown): void {
    if (wsHandler) {
      wsHandler(data);
    } else {
      buffer.push(data);
    }
  }

  worker.port.onmessage = (event: MessageEvent<SocketStateMessage | SocketWsMessage>) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "ws") {
      deliver(message.data);
    } else if (message.type === "state") {
      if (stateHandler) {
        stateHandler(message);
      }
    }
  };

  function flush(): void {
    while (buffer.length > 0) {
      const data = buffer.shift();
      if (data !== undefined && wsHandler) {
        wsHandler(data);
      }
    }
  }

  return {
    send(data) {
      worker.port.postMessage({ type: "send", data });
    },
    setMessageHandler(fn) {
      wsHandler = fn;
      flush();
    },
    setStateHandler(fn) {
      stateHandler = fn;
    },
  };
}

export function getSocket(): ObgSocket | null {
  if (window.obgSocket === undefined) {
    window.obgSocket = createSocket() ?? undefined;
  }
  return window.obgSocket ?? null;
}
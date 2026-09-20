import { storeSession } from "./session";
import type {
  ActiveSession,
  AppConfig,
  GameInfo,
  ListGameEvent,
  Session,
  SessionCreatedEvent,
  SessionsInfoEvent,
} from "./types";
import { getSocket } from "./ws/wsClient";
import type { SocketStateMessage } from "./ws/wsClient";

interface ServerMessage {
  event: string;
  content?: { active?: Record<string, ActiveSession[]> };
  game_list?: GameInfo[];
  session?: Session;
  [key: string]: unknown;
}

const statusElement = document.getElementById("status") as HTMLDivElement;
const tabsContainer = document.getElementById("tabs-container") as HTMLDivElement;
const tablesContainer = document.getElementById("tables-container") as HTMLDivElement;

let config: AppConfig | null = null;
let gameInfo: Record<string, GameInfo> = {};
let sessionsData: Record<string, ActiveSession[]> = {};

// -------------------------------------------------
// Connexion WebSocket
// -------------------------------------------------

function connectSharedSocket(): void {
  const socket = getSocket();
  if (!socket) {
    statusElement.textContent = "WebSocket indisponible dans ce navigateur.";
    return;
  }

  socket.setStateHandler((message: SocketStateMessage) => {
    if (!message.connected) {
      statusElement.textContent =
        (message.message || "Déconnecté") + " Reconnexion...";
      return;
    }
    statusElement.textContent = "Connecté au serveur. Chargement des jeux...";
    socket.send({
      action: "list_game",
      game_name_list: config?.game_name_list ?? [],
    });
  });

  socket.setMessageHandler((raw) => {
    handleServerMessage(raw as ServerMessage);
  });
}

function handleServerMessage(data: ServerMessage): void {
  try {
    if (data.event === "list_game") {
      handleListGame(data as unknown as ListGameEvent);
      getSocket()?.send({
        action: "list_sessions",
        game_name_list: config?.game_name_list ?? [],
      });
    } else if (data.event === "sessions_info") {
      handleSessionsInfo(data as unknown as SessionsInfoEvent);
    } else if (data.event === "session_created") {
      handleSessionCreated(data as unknown as SessionCreatedEvent);
    } else if (data.event === "server_shutdown") {
      statusElement.textContent = "Le serveur va s'éteindre. Déconnexion...";
    }
  } catch (e) {
    console.error("Erreur traitement message:", e);
  }
}

function handleListGame(data: ListGameEvent): void {
  gameInfo = {};
  if (data.game_list) {
    for (const game of data.game_list) {
      gameInfo[game.name] = game;
    }
  }
}

function handleSessionsInfo(data: SessionsInfoEvent): void {
  sessionsData = data.content?.active ?? {};
  renderAll();
}

function handleSessionCreated(data: SessionCreatedEvent): void {
  const session = data.session;
  if (session?.key) {
    storeSession(session);
  }
  window.location.href = "game.html";
}

// -------------------------------------------------
// Modale de création
// -------------------------------------------------

let pendingGameName: string | null = null;

function openCreateModal(gameName: string): void {
  pendingGameName = gameName;
  (document.getElementById("input-nickname") as HTMLInputElement).value = "";
  (document.getElementById("input-key") as HTMLInputElement).value = "";
  hideError("nickname-error");
  document.getElementById("create-modal")!.classList.add("show");
  document.getElementById("input-nickname")!.focus();
}

function closeCreateModal(): void {
  document.getElementById("create-modal")!.classList.remove("show");
  pendingGameName = null;
}

function confirmCreateSession(): void {
  const nickname = (document.getElementById("input-nickname") as HTMLInputElement).value.trim();
  const key = (document.getElementById("input-key") as HTMLInputElement).value.trim() || "";
  const gameName = pendingGameName;

  if (!nickname) {
    showError("nickname-error");
    return;
  }
  hideError("nickname-error");

  getSocket()?.send({
    action: "create_session",
    game_name: gameName,
    nickname,
    key,
  });
  closeCreateModal();
}

// -------------------------------------------------
// Modale d'adhésion
// -------------------------------------------------

let pendingJoin: { sessionCode: string; nickname: string } | null = null;

function openJoinModal(sessionCode: string, nickname: string): void {
  pendingJoin = { sessionCode, nickname };
  (document.getElementById("join-nickname") as HTMLInputElement).value = nickname;
  (document.getElementById("join-key") as HTMLInputElement).value = "";
  hideError("join-key-error");
  document.getElementById("join-modal")!.classList.add("show");
  document.getElementById("join-key")!.focus();
}

function closeJoinModal(): void {
  document.getElementById("join-modal")!.classList.remove("show");
  pendingJoin = null;
}

function confirmJoinSession(): void {
  if (!pendingJoin) return;
  const key = (document.getElementById("join-key") as HTMLInputElement).value.trim();

  if (!key) {
    showError("join-key-error");
    return;
  }
  hideError("join-key-error");

  getSocket()?.send({
    action: "join_session",
    session_code: pendingJoin.sessionCode,
    nickname: pendingJoin.nickname,
    key,
    role: "player",
  });
  closeJoinModal();
}

// -------------------------------------------------
// Helpers modales
// -------------------------------------------------

function showError(id: string): void {
  (document.getElementById(id) as HTMLDivElement).style.display = "block";
}

function hideError(id: string): void {
  (document.getElementById(id) as HTMLDivElement).style.display = "none";
}

// -------------------------------------------------
// Rendu du lobby
// -------------------------------------------------

function renderAll(): void {
  if (!config) return;
  tabsContainer.innerHTML = "";
  tablesContainer.innerHTML = "";

  const gameNames = [...config.game_name_list].sort((a, b) => a.localeCompare(b));

  gameNames.forEach((name, index) => {
    const game = gameInfo[name];
    const sessions = sessionsData[name] || [];
    const variants = game?.variant ?? {};
    const variantKeys = Object.keys(variants);

    const btn = document.createElement("button");
    btn.className = "tab-button" + (index === 0 ? " active" : "");
    btn.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    btn.onclick = () => switchTab(btn, index);
    tabsContainer.appendChild(btn);

    const container = document.createElement("div");
    container.className = "table-container" + (index === 0 ? " active" : "");
    container.id = "table-" + index;

    if (sessions.length > 0) {
      const table = document.createElement("table");
      table.innerHTML = `
        <thead>
          <tr>
            <th>Code</th>
            <th>Joueurs</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector("tbody") as HTMLTableSectionElement;
      for (const session of sessions) {
        const row = document.createElement("tr");
        const codeCell = document.createElement("td");
        codeCell.textContent = session.code || "-";

        const playersCell = document.createElement("td");
        if (session.players && session.players.length > 0) {
          for (const player of session.players) {
            const pBtn = document.createElement("button");
            pBtn.className = "player-btn";
            pBtn.textContent = player.nickname;
            pBtn.onclick = () => openJoinModal(session.code ?? "", player.nickname);
            if (player.owner) {
              const badge = document.createElement("span");
              badge.className = "owner-badge";
              badge.textContent = "(owner)";
              pBtn.appendChild(badge);
            }
            playersCell.appendChild(pBtn);
          }
        } else {
          playersCell.textContent = "-";
        }

        row.appendChild(codeCell);
        row.appendChild(playersCell);
        tbody.appendChild(row);
      }

      container.appendChild(table);
    } else {
      const emptyMsg = document.createElement("p");
      emptyMsg.textContent = "Aucune session active.";
      emptyMsg.style.color = "#888";
      container.appendChild(emptyMsg);
    }

    if (variantKeys.length > 1) {
      const dropdown = document.createElement("div");
      dropdown.className = "create-dropdown";
      dropdown.innerHTML = `
        <button class="create-dropdown-btn">Create ▾</button>
        <div class="create-dropdown-content" id="dropdown-${index}"></div>
      `;
      const dropdownContent = dropdown.querySelector(".create-dropdown-content") as HTMLDivElement;
      for (const vKey of variantKeys) {
        const a = document.createElement("a");
        a.textContent = variants[vKey].name;
        a.onclick = (e) => {
          e.stopPropagation();
          dropdownContent.classList.remove("show");
          openCreateModal(name);
        };
        dropdownContent.appendChild(a);
      }
      const dropdownBtn = dropdown.querySelector(".create-dropdown-btn") as HTMLButtonElement;
      dropdownBtn.onclick = () => {
        dropdownContent.classList.toggle("show");
      };
      container.appendChild(dropdown);
    } else {
      const createBtn = document.createElement("button");
      createBtn.textContent = "Create";
      createBtn.className = "create-game-btn";
      createBtn.onclick = () => openCreateModal(name);
      container.appendChild(createBtn);
    }

    tablesContainer.appendChild(container);
  });
}

function switchTab(btn: HTMLButtonElement, index: number): void {
  tabsContainer.querySelectorAll(".tab-button").forEach((b) => {
    b.classList.remove("active");
  });
  btn.classList.add("active");

  tablesContainer.querySelectorAll(".table-container").forEach((c) => {
    c.classList.remove("active");
  });
  (tablesContainer.children[index] as HTMLDivElement).classList.add("active");
}

// -------------------------------------------------
// Initialisation
// -------------------------------------------------

function bindEventHandlers(): void {
  document.getElementById("modal-cancel")!.onclick = closeCreateModal;
  document.getElementById("modal-confirm")!.onclick = confirmCreateSession;
  document.getElementById("input-nickname")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateSession();
  });
  document.getElementById("input-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateSession();
  });
  document.getElementById("create-modal")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeCreateModal();
  });

  document.getElementById("join-cancel")!.onclick = closeJoinModal;
  document.getElementById("join-confirm")!.onclick = confirmJoinSession;
  document.getElementById("join-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmJoinSession();
  });
  document.getElementById("join-modal")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeJoinModal();
  });
}

async function main(): Promise<void> {
  bindEventHandlers();

  try {
    const response = await fetch("conf.json");
    config = (await response.json()) as AppConfig;
  } catch (err) {
    statusElement.textContent = "Erreur chargement conf.json: " + err;
    return;
  }

  if (!config?.game_name_list?.length) {
    statusElement.textContent = "Aucun jeu configuré dans conf.json.";
    return;
  }

  connectSharedSocket();
}

void main();
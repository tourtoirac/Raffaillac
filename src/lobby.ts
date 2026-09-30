import { gameEntryUrl } from "./navigation";
import { storePlayerIdentity, storeSession } from "./session";
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

// onglet courant : initialisé par ?game=Waterloo puis mis à jour à chaque
// changement d'onglet, pour survivre à un rechargement de la page
let selectedGame = new URLSearchParams(window.location.search).get("game");

function selectGame(gameName: string): void {
  selectedGame = gameName;
  const url = new URL(window.location.href);
  url.searchParams.set("game", gameName);
  window.history.replaceState(null, "", url);
}

function selectedGameIndex(gameNames: string[]): number {
  const wanted = selectedGame;
  if (wanted) {
    const index = gameNames.findIndex(
      (name) => name.toLowerCase() === wanted.toLowerCase(),
    );
    if (index >= 0) return index;
  }
  return 0;
}

// seuls les jeux présents dans sessions_info sont affichés
function visibleGameNames(): string[] {
  if (!config) return [];
  return [...config.game_name_list]
    .filter((name) => name in sessionsData)
    .sort((a, b) => a.localeCompare(b));
}

// nom du jeu réellement affiché : selectedGame peut être absent de la liste
function activeGameName(): string | null {
  const gameNames = visibleGameNames();
  return gameNames[selectedGameIndex(gameNames)] ?? null;
}

// jeu de la partie en cours d'ouverture. Il doit survivre à la fermeture des
// modales, donc il est mémorisé au moment de la confirmation et pas lu depuis
// l'onglet courant à la réception de la réponse.
let openingGameName: string | null = null;

// -------------------------------------------------
// Journal du cartouche : les N derniers messages reçus
// -------------------------------------------------

const MAX_STATUS_LINES = 5;
const statusLog: string[] = [statusElement.textContent?.trim() ?? ""].filter(Boolean);

function renderStatus(): void {
  statusElement.textContent = "";
  for (const line of statusLog) {
    const row = document.createElement("div");
    row.className = "status-line";
    if (line.length > MAX_JSON_LENGTH) {
      const collapsed = line.slice(0, MAX_JSON_LENGTH) + "…";
      row.classList.add("status-line-expandable");
      row.title = "Cliquer pour déplier / replier";
      row.textContent = collapsed;
      row.onclick = () => {
        const expanded = row.classList.toggle("status-line-expanded");
        row.textContent = expanded ? line : collapsed;
      };
    } else {
      row.textContent = line;
    }
    statusElement.appendChild(row);
  }
}

function pushStatus(text: string): void {
  statusLog.push(text);
  while (statusLog.length > MAX_STATUS_LINES) {
    statusLog.shift();
  }
  renderStatus();
}

// messages reçus mais non journalisés (poll technique du serveur)
const SILENT_EVENTS = new Set(["keep_alive"]);

// un message peut être volumineux (session_created transporte tous les
// composants du plateau) : on tronque pour garder le cartouche lisible,
// un clic sur la ligne déplie le JSON complet
const MAX_JSON_LENGTH = 400;

function formatMessage(data: ServerMessage): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

// -------------------------------------------------
// Connexion WebSocket
// -------------------------------------------------

function connectSharedSocket(): void {
  const socket = getSocket();
  if (!socket) {
    pushStatus("WebSocket indisponible dans ce navigateur.");
    return;
  }

  socket.setStateHandler((message: SocketStateMessage) => {
    if (!message.connected) {
      pushStatus((message.message || "Déconnecté") + " Reconnexion...");
      return;
    }
    pushStatus("Connecté au serveur. Chargement des jeux...");
    socket.send({
      action: "list_game",
      game_name_list: config?.game_name_list ?? [],
    });
  });

  socket.setMessageHandler((raw) => {
    handleServerMessage(raw as ServerMessage);
  });
}

function refreshSessions(): void {
  getSocket()?.send({
    action: "list_sessions",
    game_name_list: config?.game_name_list ?? [],
  });
}

function handleServerMessage(data: ServerMessage): void {
  if (!SILENT_EVENTS.has(data.event)) {
    pushStatus(formatMessage(data));
  }
  try {
    if (data.event === "list_game") {
      handleListGame(data as unknown as ListGameEvent);
      refreshSessions();
    } else if (data.event === "sessions_info") {
      handleSessionsInfo(data as unknown as SessionsInfoEvent);
    } else if (data.event === "session_created" || data.event === "session_joined") {
      // message de session reçu après create_session ou join_session
      handleSessionCreated(data as unknown as SessionCreatedEvent);
    } else if (data.event === "session_players_changed") {
      // un joueur est entré ou sorti : on redemande la liste pour rafraîchir
      refreshSessions();
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
  window.location.href = gameEntryUrl(openingGameName ?? activeGameName());
}

// -------------------------------------------------
// Modale de création
// -------------------------------------------------

let pendingGameName: string | null = null;
let pendingVariantName = "default";
let pendingPlayerLimits: { min: number; max: number } | null = null;

// bornes de joueurs annoncées par la description de la variante
function gamePlayerLimits(gameName: string, variantName: string): { min: number; max: number } | null {
  const variants = gameInfo[gameName]?.variant ?? {};
  const description =
    variants[variantName] ?? variants["default"] ?? variants[Object.keys(variants)[0]];
  const min = description?.min_players;
  const max = description?.max_players;
  if (typeof min !== "number" || typeof max !== "number") {
    return null;
  }
  return { min, max };
}

function openCreateModal(gameName: string, variantName?: string): void {
  pendingGameName = gameName;
  pendingVariantName = variantName || "default";
  (document.getElementById("input-nickname") as HTMLInputElement).value = "";
  (document.getElementById("input-key") as HTMLInputElement).value = "";
  (document.getElementById("input-access-key") as HTMLInputElement).value = "";
  (document.getElementById("input-allow-watchers") as HTMLInputElement).checked = true;
  hideError("nickname-error");

  const limits = gamePlayerLimits(gameName, pendingVariantName);
  pendingPlayerLimits = limits;

  // bornes fixes : on les transmet sans proposer de saisie
  const fields = document.getElementById("players-fields") as HTMLDivElement;
  const showFields = limits !== null && limits.min !== limits.max;
  fields.classList.toggle("show", showFields);
  if (limits) {
    (document.getElementById("input-min-players") as HTMLInputElement).value = String(limits.min);
    (document.getElementById("input-max-players") as HTMLInputElement).value = String(limits.max);
  }

  document.getElementById("create-modal")!.classList.add("show");
  document.getElementById("input-nickname")!.focus();
}

function readNumberInput(id: string, fallback: number): number {
  const value = (document.getElementById(id) as HTMLInputElement).valueAsNumber;
  return Number.isFinite(value) ? value : fallback;
}

function closeCreateModal(): void {
  document.getElementById("create-modal")!.classList.remove("show");
  pendingGameName = null;
  pendingPlayerLimits = null;
}

function confirmCreateSession(): void {
  const nickname = (document.getElementById("input-nickname") as HTMLInputElement).value.trim();
  const key = (document.getElementById("input-key") as HTMLInputElement).value.trim() || "";
  const accessKey =
    (document.getElementById("input-access-key") as HTMLInputElement).value.trim() || "";
  const allowsWatchers =
    (document.getElementById("input-allow-watchers") as HTMLInputElement).checked;
  const gameName = pendingGameName;

  if (!nickname) {
    showError("nickname-error");
    return;
  }
  hideError("nickname-error");

  const playersVisible =
    (document.getElementById("players-fields") as HTMLDivElement).classList.contains("show");
  openingGameName = gameName;
  const message: Record<string, unknown> = {
    action: "create_session",
    game_name: gameName,
    variant_name: pendingVariantName,
    nickname,
    key,
    allows_watchers: allowsWatchers,
    access_key: accessKey,
  };

  // sans description exploitable, on laisse Chabanas appliquer ses valeurs
  if (pendingPlayerLimits) {
    message.session_min_players = playersVisible
      ? readNumberInput("input-min-players", pendingPlayerLimits.min)
      : pendingPlayerLimits.min;
    message.session_max_players = playersVisible
      ? readNumberInput("input-max-players", pendingPlayerLimits.max)
      : pendingPlayerLimits.max;
  }

  getSocket()?.send(message);
  storePlayerIdentity(nickname, "player");
  closeCreateModal();
}

// -------------------------------------------------
// Modale d'adhésion
// -------------------------------------------------

let pendingJoin: { sessionCode: string; nickname: string; gameName: string } | null = null;

function isSessionFull(session: ActiveSession): boolean {
  const max = session.max_players;
  if (typeof max !== "number") return false;
  return (session.players?.length ?? 0) >= max;
}

// le jeu est mémorisé dès l'ouverture de la modale : l'onglet peut changer
// avant la réponse du serveur
function openJoinModal(sessionCode: string, nickname: string, gameName: string): void {
  pendingJoin = { sessionCode, nickname, gameName };
  const nicknameInput = document.getElementById("join-nickname") as HTMLInputElement;
  nicknameInput.value = nickname;
  // un pseudo fourni reste verrouillé, sinon le joueur le saisit
  nicknameInput.readOnly = nickname !== "";
  (document.getElementById("join-key") as HTMLInputElement).value = "";
  hideError("join-nickname-error");
  hideError("join-key-error");
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
  const nickname = (document.getElementById("join-nickname") as HTMLInputElement).value.trim();
  const key = (document.getElementById("join-key") as HTMLInputElement).value.trim();

  if (!nickname) {
    showError("join-nickname-error");
    return;
  }
  hideError("join-nickname-error");

  if (!key) {
    showError("join-key-error");
    return;
  }
  hideError("join-key-error");

  openingGameName = pendingJoin.gameName;
  getSocket()?.send({
    action: "join_session",
    session_code: pendingJoin.sessionCode,
    nickname,
    key,
    role: "player",
  });
  storePlayerIdentity(nickname, "player");
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

  const gameNames = visibleGameNames();

  if (gameNames.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.textContent = "Aucun jeu disponible.";
    emptyMsg.style.color = "#888";
    tablesContainer.appendChild(emptyMsg);
    return;
  }

  const activeIndex = selectedGameIndex(gameNames);

  gameNames.forEach((name, index) => {
    const game = gameInfo[name];
    const sessions = sessionsData[name] || [];
    const variants = game?.variant ?? {};
    const variantKeys = Object.keys(variants);

    const btn = document.createElement("button");
    btn.className = "tab-button" + (index === activeIndex ? " active" : "");
    btn.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    btn.onclick = () => switchTab(btn, index, name);
    tabsContainer.appendChild(btn);

    const container = document.createElement("div");
    container.className = "table-container" + (index === activeIndex ? " active" : "");
    container.id = "table-" + index;

    if (sessions.length > 0) {
      const table = document.createElement("table");
      table.innerHTML = `
        <thead>
          <tr>
            <th>Code</th>
            <th>Joueurs</th>
            <th>Rejoindre</th>
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
            pBtn.onclick = () => openJoinModal(session.code ?? "", player.nickname, name);
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

        const actionCell = document.createElement("td");
        actionCell.className = "join-actions";

        if (!isSessionFull(session)) {
          const joinBtn = document.createElement("button");
          joinBtn.className = "join-session-btn";
          joinBtn.textContent = "Join";
          // aucun pseudo prérempli : le joueur choisit son propre nom
          joinBtn.onclick = () => openJoinModal(session.code ?? "", "", name);
          actionCell.appendChild(joinBtn);
        }

        const watchBtn = document.createElement("button");
        watchBtn.className = "watch-session-btn";
        watchBtn.textContent = "Spectateur";
        actionCell.appendChild(watchBtn);

        row.appendChild(codeCell);
        row.appendChild(playersCell);
        row.appendChild(actionCell);
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
          openCreateModal(name, vKey);
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
      createBtn.onclick = () => openCreateModal(name, variantKeys[0]);
      container.appendChild(createBtn);
    }

    tablesContainer.appendChild(container);
  });
}

function switchTab(btn: HTMLButtonElement, index: number, gameName: string): void {
  tabsContainer.querySelectorAll(".tab-button").forEach((b) => {
    b.classList.remove("active");
  });
  btn.classList.add("active");

  tablesContainer.querySelectorAll(".table-container").forEach((c) => {
    c.classList.remove("active");
  });
  (tablesContainer.children[index] as HTMLDivElement).classList.add("active");

  selectGame(gameName);
}

// -------------------------------------------------
// Initialisation
// -------------------------------------------------

function bindEventHandlers(): void {
  document.getElementById("modal-cancel")!.onclick = closeCreateModal;
  document.getElementById("create-modal-close")!.onclick = closeCreateModal;
  document.getElementById("modal-confirm")!.onclick = confirmCreateSession;
  document.getElementById("input-nickname")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateSession();
  });
  document.getElementById("input-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateSession();
  });
  document.getElementById("input-access-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateSession();
  });

  document.getElementById("join-cancel")!.onclick = closeJoinModal;
  document.getElementById("join-modal-close")!.onclick = closeJoinModal;
  document.getElementById("join-confirm")!.onclick = confirmJoinSession;
  document.getElementById("join-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmJoinSession();
  });
}

async function main(): Promise<void> {
  bindEventHandlers();

  try {
    const response = await fetch("conf.json");
    config = (await response.json()) as AppConfig;
  } catch (err) {
    pushStatus("Erreur chargement conf.json: " + err);
    return;
  }

  if (!config?.game_name_list?.length) {
    pushStatus("Aucun jeu configuré dans conf.json.");
    return;
  }

  connectSharedSocket();
}

void main();
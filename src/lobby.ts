import { gameEntryUrl } from "./navigation";
import { storePlayerIdentity, storeSession } from "./session";
import type {
  ActiveSession,
  GameInfo,
  ListGameEvent,
  Session,
  SessionCreatedEvent,
  SessionsInfoEvent,
} from "./types";
import { getSocket } from "./ws/wsClient";
import type { SocketStateMessage } from "./ws/wsClient";

interface ServerErrorEvent {
  error?: { code?: string; message?: string };
}

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

// The server decides which games are offered: one tab per game of sessions_info
function visibleGameNames(): string[] {
  return Object.keys(sessionsData).sort((a, b) => a.localeCompare(b));
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

// refus d'adhésion qui méritent de rendre la modale : une saisie à corriger,
// ou une raison que seul le serveur connaît (spectateurs non autorisés, trop de
// spectateurs, partie pleine)
const REFUSAL_CODES = new Set([
  "access_key_incorrect",
  "session_unavailable",
  "watchers_not_allowed",
  "watchers_full",
  "nickname_connected",
  "invalid_nationality",
]);

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
    socket.send({ action: "list_game" });
  });

  socket.setMessageHandler((raw) => {
    handleServerMessage(raw as ServerMessage);
  });
}

function refreshSessions(): void {
  getSocket()?.send({ action: "list_sessions" });
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
    } else if (data.event === "error") {
      const code = (data as unknown as ServerErrorEvent).error?.code;
      // le serveur a refuse l'adhesion : on rend la modale pour corriger
      if (code === "invalid_nationality" && lastJoinAttempt === null) {
        // refused creation: the modal normally prevents it, the game may have
        // changed since the lobby read its description
        openingGameName = null;
        window.alert("Ce jeu demande de choisir une nationalité parmi celles qu'il propose.");
      } else if (code && REFUSAL_CODES.has(code)) {
        reopenJoinModalAfterRefusal(code);
        lastJoinAttempt = null;
      } else if (code === "duplicate_component_ids") {
        // The game_json is broken, not the player's input: nothing to retry,
        // so the creation modal stays closed and the player is told why.
        openingGameName = null;
        window.alert(
          "Impossible de lancer la partie : plusieurs composants de ce jeu " +
            "portent le même identifiant. Le jeu doit être corrigé.",
        );
      }
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
  lastJoinAttempt = null;
  window.location.href = gameEntryUrl(openingGameName ?? activeGameName());
}

// -------------------------------------------------
// Modale de création
// -------------------------------------------------

let pendingGameName: string | null = null;
let pendingVariantName = "default";
let pendingPlayerLimits: { min: number; max: number } | null = null;
// the nationalities the creation modal offers; empty when the game has none
let pendingNationalities: string[] = [];

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

// the sides a game of that variant asks its players to choose from
function variantNationalities(gameName: string, variantName: string): string[] {
  const variants = gameInfo[gameName]?.variant ?? {};
  return variants[variantName]?.nationalities ?? [];
}

// Fills a nationality select and shows its field only when the game declares
// nationalities. Nothing is preselected: the choice is the player's.
function fillNationalities(fieldId: string, selectId: string, nationalities: string[]): void {
  const select = document.getElementById(selectId) as HTMLSelectElement;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Choisir —";
  select.appendChild(placeholder);
  for (const nationality of nationalities) {
    const option = document.createElement("option");
    option.value = nationality;
    option.textContent = nationality;
    select.appendChild(option);
  }
  (document.getElementById(fieldId) as HTMLDivElement).style.display =
    nationalities.length > 0 ? "block" : "none";
}

function openCreateModal(gameName: string, variantName?: string): void {
  pendingGameName = gameName;
  pendingVariantName = variantName || "default";
  (document.getElementById("input-nickname") as HTMLInputElement).value = "";
  (document.getElementById("input-key") as HTMLInputElement).value = "";
  (document.getElementById("input-access-key") as HTMLInputElement).value = "";
  (document.getElementById("input-allow-watchers") as HTMLInputElement).checked = true;
  hideError("nickname-error");
  hideError("nationality-error");
  pendingNationalities = variantNationalities(gameName, pendingVariantName);
  fillNationalities("create-nationality-field", "input-nationality", pendingNationalities);

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

  // a game with nationalities seats nobody without one: the server refuses
  const nationality = (document.getElementById("input-nationality") as HTMLSelectElement).value;
  if (pendingNationalities.length > 0 && !nationality) {
    showError("nationality-error");
    return;
  }
  hideError("nationality-error");

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
  if (pendingNationalities.length > 0) message.nationality = nationality;

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

let pendingJoin: {
  sessionCode: string;
  nickname: string;
  gameName: string;
  role: "player" | "watcher";
  // the nationalities a new player must choose from; empty when none is asked
  nationalities: string[];
} | null = null;

function isSessionFull(session: ActiveSession): boolean {
  const max = session.max_players;
  if (typeof max !== "number") return false;
  return (session.players?.length ?? 0) >= max;
}

// le jeu et le role sont mémorisés dès l'ouverture de la modale : l'onglet peut
// changer avant la réponse du serveur
function openJoinModal(
  sessionCode: string,
  nickname: string,
  gameName: string,
  role: "player" | "watcher" = "player",
  // only for a new player: a watcher has no nationality, and a player coming
  // back to their seat keeps the one they chose
  nationalities: string[] = [],
): void {
  const isWatcher = role === "watcher";
  pendingJoin = { sessionCode, nickname, gameName, role, nationalities };
  fillNationalities("join-nationality-field", "join-nationality", nationalities);
  hideError("join-nationality-error");
  const nicknameInput = document.getElementById("join-nickname") as HTMLInputElement;
  nicknameInput.value = nickname;
  // un pseudo fourni reste verrouillé, sinon l'utilisateur le saisit
  nicknameInput.readOnly = nickname !== "";
  (document.getElementById("join-key") as HTMLInputElement).value = "";
  (document.getElementById("join-access-key") as HTMLInputElement).value = "";
  (document.getElementById("join-nickname-error") as HTMLDivElement).textContent =
    "Le nickname est obligatoire.";
  hideError("join-nickname-error");
  hideError("join-key-error");
  hideError("join-access-key-error");
  hideError("join-role-error");
  // un spectateur n'a pas de key : le champ disparaît du formulaire plutôt que
  // d'être laissé vide, il n'aurait rien à saisir
  (document.getElementById("join-key-field") as HTMLDivElement).style.display = isWatcher
    ? "none"
    : "block";
  (document.getElementById("join-modal-title") as HTMLHeadingElement).textContent =
    isWatcher ? "Regarder une session" : "Rejoindre une session";
  (document.getElementById("join-confirm") as HTMLButtonElement).textContent =
    isWatcher ? "Regarder" : "Rejoindre";
  document.getElementById("join-modal")!.classList.add("show");
  if (isWatcher) {
    nicknameInput.focus();
  } else {
    (document.getElementById("join-key") as HTMLInputElement).focus();
  }
}

function closeJoinModal(): void {
  document.getElementById("join-modal")!.classList.remove("show");
  pendingJoin = null;
}

// ce que le joueur a soumis, conserve apres fermeture de la modale : si le
// serveur refuse l'adhesion, on lui rouvre la modale avec sa saisie intacte
// plutot que de lui faire tout retaper
let lastJoinAttempt: {
  sessionCode: string;
  gameName: string;
  role: "player" | "watcher";
  nickname: string;
  key: string;
  accessKey: string;
  nationality: string;
  nationalities: string[];
} | null = null;

function reopenJoinModalAfterRefusal(code: string): void {
  if (!lastJoinAttempt) return;
  const attempt = lastJoinAttempt;
  openJoinModal(
    attempt.sessionCode,
    attempt.nickname,
    attempt.gameName,
    attempt.role,
    attempt.nationalities,
  );
  (document.getElementById("join-nationality") as HTMLSelectElement).value = attempt.nationality;
  (document.getElementById("join-key") as HTMLInputElement).value = attempt.key;
  (document.getElementById("join-access-key") as HTMLInputElement).value = attempt.accessKey;
  // le message va sous le champ fautif quand il y en a un : une clé d'accès
  // refusée est une erreur de saisie, une partie pleine ne l'est pas
  switch (code) {
    case "invalid_nationality":
      showError("join-nationality-error");
      break;
    case "access_key_incorrect":
      showError("join-access-key-error");
      break;
    case "nickname_connected":
      (document.getElementById("join-nickname-error") as HTMLDivElement).textContent =
        "Ce pseudo est déjà en jeu.";
      showError("join-nickname-error");
      break;
    case "watchers_not_allowed":
      (document.getElementById("join-role-error") as HTMLDivElement).textContent =
        "Cette partie n'accepte pas les spectateurs.";
      showError("join-role-error");
      break;
    case "watchers_full":
      (document.getElementById("join-role-error") as HTMLDivElement).textContent =
        "Cette partie a déjà trop de spectateurs.";
      showError("join-role-error");
      break;
    default:
      if (attempt.role === "watcher") {
        // un spectateur n'a pas de key à corriger : le refus vient du serveur
        (document.getElementById("join-role-error") as HTMLDivElement).textContent =
          "Le serveur a refusé cette adhésion.";
        showError("join-role-error");
      } else {
        showError("join-key-error");
      }
  }
}

function confirmJoinSession(): void {
  if (!pendingJoin) return;
  const isWatcher = pendingJoin.role === "watcher";
  const nickname = (document.getElementById("join-nickname") as HTMLInputElement).value.trim();
  const key = (document.getElementById("join-key") as HTMLInputElement).value.trim();

  if (!nickname) {
    showError("join-nickname-error");
    return;
  }
  hideError("join-nickname-error");

  // la clé d'utilisateur est facultative : sans elle, le serveur ouvre un
  // nouveau siège pour ce pseudo. Elle ne sert qu'à retrouver sa place ensuite.
  hideError("join-key-error");

  const nationality = (document.getElementById("join-nationality") as HTMLSelectElement).value;
  if (pendingJoin.nationalities.length > 0 && !nationality) {
    showError("join-nationality-error");
    return;
  }
  hideError("join-nationality-error");

  // l'access_key n'est obligatoire que si le créateur en a défini une : elle est
  // transmise telle quelle, le serveur tranche
  const accessKey =
    (document.getElementById("join-access-key") as HTMLInputElement).value.trim();

  openingGameName = pendingJoin.gameName;
  lastJoinAttempt = {
    sessionCode: pendingJoin.sessionCode,
    gameName: pendingJoin.gameName,
    role: pendingJoin.role,
    nickname,
    key,
    accessKey,
    nationality,
    nationalities: pendingJoin.nationalities,
  };
  const joinMessage: Record<string, unknown> = {
    action: "join_session",
    session_code: pendingJoin.sessionCode,
    nickname,
    access_key: accessKey,
    role: pendingJoin.role,
  };
  // le champ n'est pas envoyé pour un spectateur : le serveur n'a pas à le
  // attendre, et une key vide pourrait être prise pour une key saisie
  if (!isWatcher) joinMessage.key = key;
  if (pendingJoin.nationalities.length > 0) joinMessage.nationality = nationality;
  getSocket()?.send(joinMessage);
  storePlayerIdentity(nickname, pendingJoin.role);
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
            // un joueur en jeu occupe sa place : son bouton est vert et
            // inactif. Dès qu'il se déconnecte, la place se libère et le bouton
            // redevient cliquable pour reprendre ce pseudo directement.
            const connected = player.connected === true;
            const pBtn = document.createElement("button");
            pBtn.className = "player-btn" + (connected ? " connected" : "");
            // the side the player took, when the game has nationalities
            pBtn.textContent = player.nationality
              ? `${player.nickname} (${player.nationality})`
              : player.nickname;
            pBtn.disabled = connected;
            if (connected) {
              pBtn.title = "En jeu";
            } else {
              pBtn.title = "Rejoindre en tant que " + player.nickname;
              pBtn.onclick = () => openJoinModal(session.code ?? "", player.nickname, name);
            }
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

        // une partie commencée ne prend plus de nouveau joueur : seuls les
        // pseudos déjà assis peuvent revenir, par leur bouton ci-dessus
        if (!isSessionFull(session) && !session.started) {
          const joinBtn = document.createElement("button");
          joinBtn.className = "join-session-btn";
          joinBtn.textContent = "Join";
          // aucun pseudo prérempli : le joueur choisit son propre nom
          joinBtn.onclick = () =>
            openJoinModal(session.code ?? "", "", name, "player", session.nationalities ?? []);
          actionCell.appendChild(joinBtn);
        }

        // un spectateur suit la partie sans y jouer : meme adhésion, meme
        // access_key, pas de key, et il ne compte pas dans la limite de joueurs
        if (session.allows_watchers !== false) {
          const watchBtn = document.createElement("button");
          watchBtn.className = "watch-session-btn";
          watchBtn.textContent = "Spectateur";
          watchBtn.onclick = () => openJoinModal(session.code ?? "", "", name, "watcher");
          actionCell.appendChild(watchBtn);
        }

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

function main(): void {
  bindEventHandlers();
  connectSharedSocket();
}

main();
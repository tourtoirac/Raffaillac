import {
  AIR_FORCE_LABEL,
  AIR_FORCE_TAB,
  HAUTEFORT as AIR_FORCE_SERVICE,
  airForceAvailable,
  renderAirForceTab,
  startAirForceLobby,
} from "./airForceLobby";
import {
  JUDGE_DREDD,
  JUDGE_DREDD_LABEL,
  JUDGE_DREDD_TAB,
  judgeDreddAvailable,
  renderJudgeDreddTab,
  startJudgeDreddLobby,
} from "./judgeDreddLobby";
import {
  MONSTER_DERBY,
  MONSTER_DERBY_LABEL,
  MONSTER_DERBY_TAB,
  monsterDerbyAvailable,
  renderMonsterDerbyTab,
  startMonsterDerbyLobby,
} from "./monsterDerbyLobby";
import {
  SUPER_SLAPSHOT,
  SUPER_SLAPSHOT_LABEL,
  SUPER_SLAPSHOT_TAB,
  renderSuperSlapshotTab,
  startSuperSlapshotLobby,
  superSlapshotAvailable,
} from "./superSlapshotLobby";
import { ZARGOS, ZARGOS_LABEL, ZARGOS_TAB, renderZargosTab, startZargosLobby, zargosAvailable } from "./zargosLobby";
import { GAME_OPEN_ELSEWHERE_MESSAGE, isGameOpenElsewhere } from "./gameLock";
import { gameEntryUrl } from "./navigation";
import {
  LOCKED_MARK,
  WRONG_KEY_MESSAGE,
  forgetPrototypeKey,
  prototypeKey,
  renderLockedTab,
  serviceLocked,
  servicePrivate,
  storePrototypeKey,
  unlockService,
} from "./prototype";
import { storePlayerIdentity, storeSession } from "./session";
import type {
  ActiveSession,
  GameInfo,
  GameType,
  ListGameEvent,
  ServerErrorEvent,
  Session,
  SessionCreatedEvent,
  SessionsInfoEvent,
  SessionDocument,
} from "./types";
import { invalidComponentMessage, serverFullMessage } from "./serverErrors";
import { Pager, emptyListMessage, matchesSearch } from "./sessionList";
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

// The log of the server messages is a development aid: it is only shown when
// the page is served from this machine, never to the players of a deployed
// site.
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
(document.getElementById("status-container") as HTMLDivElement).hidden =
  !LOCAL_HOSTNAMES.includes(window.location.hostname);
const typeTabsContainer = document.getElementById("type-tabs") as HTMLDivElement;
const tabsContainer = document.getElementById("tabs-container") as HTMLDivElement;
const tablesContainer = document.getElementById("tables-container") as HTMLDivElement;

let gameInfo: Record<string, GameInfo> = {};
let sessionsData: Record<string, ActiveSession[]> = {};
// games in progress (with players in them) of the whole platform and their
// limit, from the last sessions_info
let activeGames: number | null = null;
let maxActiveGames: number | null = null;

// the platform runs its maximum number of games in progress: no new game, and
// no joining, until a place is free
function platformFull(): boolean {
  return activeGames !== null && maxActiveGames !== null && activeGames >= maxActiveGames;
}

// greys a button out while the platform is full
function lockWhenFull(button: HTMLButtonElement): HTMLButtonElement {
  if (platformFull()) {
    button.disabled = true;
    button.classList.add("locked");
    button.title = serverFullMessage(maxActiveGames);
  }
  return button;
}

// search by session code or nickname, applied to the list of every game; each
// list is shown 10 sessions at a time
const searchInput = document.getElementById("session-search") as HTMLInputElement;
let searchQuery = "";
const pager = new Pager(() => renderAll());
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  pager.reset();
  renderAll();
});

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

// The types of game, in the order of their tabs. Chabanas says which one a
// game belongs to; a game it gives no type to is filed as a wargame. The
// refereed games are not Chabanas games: their rules are applied by a service
// of their own (Hautefort, with a module per game: Air Force, Judge Dredd),
// not by the OBG table.
// The games in prototyping are listed apart, under a tab of their own shown only
// when there is one: a public version and a prototype of the same game live side
// by side, each under its tab.
const GAME_TYPES: GameType[] = ["Boardgame", "Wargame", "Refereed", "Prototype"];
const DEFAULT_GAME_TYPE: GameType = "Wargame";
const TYPE_LABELS: Record<GameType, string> = {
  Boardgame: "Boardgame",
  Wargame: "Wargame",
  Refereed: "Arbitrés",
  Prototype: "Prototypes",
};
const REFEREED_GAMES = [AIR_FORCE_TAB, JUDGE_DREDD_TAB, MONSTER_DERBY_TAB, SUPER_SLAPSHOT_TAB, ZARGOS_TAB];
// the Hautefort module of each refereed game: it checks the key of a prototype
const REFEREED_SERVICES: Record<string, URL> = {
  [AIR_FORCE_TAB]: AIR_FORCE_SERVICE,
  [JUDGE_DREDD_TAB]: JUDGE_DREDD,
  [MONSTER_DERBY_TAB]: MONSTER_DERBY,
  [SUPER_SLAPSHOT_TAB]: SUPER_SLAPSHOT,
  [ZARGOS_TAB]: ZARGOS,
};

// type tab chosen by the player: read from ?type=Wargame, then kept there
let selectedType: GameType | null = readGameType(
  new URLSearchParams(window.location.search).get("type"),
);

function readGameType(value: string | null | undefined): GameType | null {
  return GAME_TYPES.find((type) => type.toLowerCase() === value?.toLowerCase()) ?? null;
}

// a game in prototyping, its key given or not
function isPrototype(gameName: string): boolean {
  const service = REFEREED_SERVICES[gameName];
  if (service) return servicePrivate(service);
  return gameInfo[gameName]?.private === true;
}

function gameTypeOf(gameName: string): GameType {
  if (isPrototype(gameName)) return "Prototype";
  if (REFEREED_GAMES.includes(gameName)) return "Refereed";
  return readGameType(gameInfo[gameName]?.type) ?? DEFAULT_GAME_TYPE;
}

// every game the server offers: one entry per game of sessions_info, plus the
// refereed games whose service answers (they have no entry in gameInfo)
function offeredGameNames(): string[] {
  const names = Object.keys(sessionsData);
  if (airForceAvailable()) names.push(AIR_FORCE_TAB);
  if (judgeDreddAvailable()) names.push(JUDGE_DREDD_TAB);
  if (monsterDerbyAvailable()) names.push(MONSTER_DERBY_TAB);
  if (superSlapshotAvailable()) names.push(SUPER_SLAPSHOT_TAB);
  if (zargosAvailable()) names.push(ZARGOS_TAB);
  return names.sort((a, b) => a.localeCompare(b));
}

// a game in prototyping whose key was not given during this visit
function gameLocked(name: string): boolean {
  const service = REFEREED_SERVICES[name];
  if (service) return serviceLocked(service);
  return gameInfo[name]?.private === true && !prototypeKey(name);
}

function tabLabel(name: string): string {
  return (gameLocked(name) ? LOCKED_MARK : "") + gameLabel(name);
}

function gameLabel(name: string): string {
  if (name === AIR_FORCE_TAB) return AIR_FORCE_LABEL;
  if (name === JUDGE_DREDD_TAB) return JUDGE_DREDD_LABEL;
  if (name === MONSTER_DERBY_TAB) return MONSTER_DERBY_LABEL;
  if (name === SUPER_SLAPSHOT_TAB) return SUPER_SLAPSHOT_LABEL;
  if (name === ZARGOS_TAB) return ZARGOS_LABEL;
  const game = gameInfo[name];
  return game?.thumbnail_display || game?.display_name || name.charAt(0).toUpperCase() + name.slice(1);
}

// The type tab shown: the one the player chose, else the one of the game the
// page was opened on (?game=), else the first type that has a game.
// the type tabs shown: the Prototypes tab only when a prototype is offered
function shownGameTypes(): GameType[] {
  const offered = offeredGameNames();
  return GAME_TYPES.filter((type) => type !== "Prototype" || offered.some(isPrototype));
}

function activeGameType(): GameType {
  if (selectedType && shownGameTypes().includes(selectedType)) return selectedType;
  const offered = offeredGameNames();
  const wanted = selectedGame?.toLowerCase();
  const opened = offered.find((name) => name.toLowerCase() === wanted);
  if (opened) return gameTypeOf(opened);
  return shownGameTypes().find((type) => offered.some((name) => gameTypeOf(name) === type)) ?? GAME_TYPES[0];
}

function selectGameType(type: GameType): void {
  selectedType = type;
  const url = new URL(window.location.href);
  url.searchParams.set("type", type);
  window.history.replaceState(null, "", url);
  renderAll();
}

// The server decides which games are offered; the lobby lists those of the
// type tab shown, one tab per game.
function visibleGameNames(): string[] {
  const type = activeGameType();
  return offeredGameNames().filter((name) => gameTypeOf(name) === type);
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

// the key of a table game sent to the server, waiting for its answer
let pendingUnlock: { gameName: string; key: string; resolve: (error: string | null) => void } | null = null;

// asks the server (Tourtoirac, then Chabanas) whether that key opens the game
function unlockTableGame(gameName: string, key: string): Promise<string | null> {
  const socket = getSocket();
  if (!socket) return Promise.resolve("Le serveur ne répond pas.");
  pendingUnlock?.resolve(null);
  return new Promise((resolve) => {
    pendingUnlock = { gameName, key, resolve };
    socket.send({ action: "unlock_game", game_name: gameName, prototype_key: key });
  });
}

// the key of a refereed game, checked by its Hautefort module
async function unlockRefereedGame(service: URL, key: string): Promise<string | null> {
  if (!(await unlockService(service, key))) return WRONG_KEY_MESSAGE;
  renderAll();
  return null;
}

// a creation or a join refused for the key kept: it no longer opens the game
function prototypeRefused(): void {
  if (openingGameName) forgetPrototypeKey(openingGameName);
  openingGameName = null;
  lastJoinAttempt = null;
  closeCreateModal();
  closeJoinModal();
  window.alert("Ce jeu est en prototypage : la clé donnée n'est plus valable.");
  renderAll();
}

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
  pushStatus(formatMessage(data));
  try {
    if (data.event === "list_game") {
      handleListGame(data as unknown as ListGameEvent);
      refreshSessions();
    } else if (data.event === "sessions_info") {
      handleSessionsInfo(data as unknown as SessionsInfoEvent);
    } else if (data.event === "session_created" || data.event === "session_joined") {
      // message de session reçu après create_session ou join_session
      handleSessionCreated(data as unknown as SessionCreatedEvent);
    } else if (data.event === "game_unlocked") {
      // the answer to unlock_game; another tab of the shared socket may have asked
      if (pendingUnlock && pendingUnlock.gameName === data.game_name) {
        storePrototypeKey(pendingUnlock.gameName, pendingUnlock.key);
        pendingUnlock.resolve(null);
        pendingUnlock = null;
        renderAll();
      }
    } else if (data.event === "error") {
      const code = (data as unknown as ServerErrorEvent).error?.code;
      // le serveur a refuse l'adhesion : on rend la modale pour corriger
      if (code === "prototype_key_incorrect" && pendingUnlock) {
        pendingUnlock.resolve(WRONG_KEY_MESSAGE);
        pendingUnlock = null;
      } else if (code === "prototype_key_incorrect") {
        prototypeRefused();
      } else if (code === "invalid_nationality" && lastJoinAttempt === null) {
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
      } else if (code === "server_full") {
        // the platform runs its maximum number of games, every game included
        openingGameName = null;
        lastJoinAttempt = null;
        closeCreateModal();
        closeJoinModal();
        window.alert(serverFullMessage(maxActiveGames));
        refreshSessions();
      } else if (code === "invalid_component") {
        // Same on creation and on join: the game_json is broken, the modal
        // stays closed and the message names the component to fix.
        openingGameName = null;
        lastJoinAttempt = null;
        window.alert(invalidComponentMessage((data as unknown as ServerErrorEvent).error));
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
  activeGames = data.content?.active_games ?? null;
  maxActiveGames = data.content?.max_active_games ?? null;
  renderAll();
}

function handleSessionCreated(data: SessionCreatedEvent): void {
  // The WebSocket is shared by every tab: a session event answers the request
  // of whichever tab made it. A lobby that asked for nothing stays where it is.
  if (openingGameName === null) return;
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

async function confirmCreateSession(): Promise<void> {
  if (await isGameOpenElsewhere()) {
    window.alert(GAME_OPEN_ELSEWHERE_MESSAGE);
    return;
  }
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
  // a game in prototyping: the key given when its tab was unlocked
  if (gameName && prototypeKey(gameName)) message.prototype_key = prototypeKey(gameName);

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

async function confirmJoinSession(): Promise<void> {
  if (await isGameOpenElsewhere()) {
    window.alert(GAME_OPEN_ELSEWHERE_MESSAGE);
    return;
  }
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
  if (prototypeKey(pendingJoin.gameName)) joinMessage.prototype_key = prototypeKey(pendingJoin.gameName);
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

function renderTypeTabs(): void {
  const active = activeGameType();
  typeTabsContainer.replaceChildren(
    ...shownGameTypes().map((type) => {
      const btn = document.createElement("button");
      btn.className = "type-tab" + (type === active ? " active" : "");
      btn.textContent = TYPE_LABELS[type];
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(type === active));
      btn.onclick = () => selectGameType(type);
      return btn;
    }),
  );
}

function renderAll(): void {
  renderTypeTabs();
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
    const sessions = (sessionsData[name] || []).filter((session) =>
      matchesSearch(searchQuery, session.code, (session.players ?? []).map((p) => p.nickname)),
    );
    const variants = game?.variant ?? {};
    const variantKeys = Object.keys(variants);

    const btn = document.createElement("button");
    btn.className = "tab-button" + (index === activeIndex ? " active" : "");
    // the name stays the identifier sent to Chabanas: only the label changes
    btn.textContent = tabLabel(name);
    btn.onclick = () => switchTab(btn, index, name);
    tabsContainer.appendChild(btn);

    const container = document.createElement("div");
    container.className = "table-container" + (index === activeIndex ? " active" : "");
    container.id = "table-" + index;

    // a game in prototyping shows nothing of its games before its key is given
    if (gameLocked(name)) {
      const service = REFEREED_SERVICES[name];
      renderLockedTab(container, gameLabel(name), (key) =>
        service ? unlockRefereedGame(service, key) : unlockTableGame(name, key),
      );
      tablesContainer.appendChild(container);
      return;
    }

    // the refereed games are played in their own service, not on the OBG table
    if (REFEREED_GAMES.includes(name)) {
      const renderTab = name === AIR_FORCE_TAB ? renderAirForceTab
        : name === JUDGE_DREDD_TAB ? renderJudgeDreddTab
        : name === MONSTER_DERBY_TAB ? renderMonsterDerbyTab
        : name === SUPER_SLAPSHOT_TAB ? renderSuperSlapshotTab : renderZargosTab;
      renderTab(container, searchQuery, pager, lockWhenFull);
      tablesContainer.appendChild(container);
      return;
    }

    const documents = renderDocumentsSelect(game?.documents ?? []);
    if (documents) container.appendChild(documents);

    if (sessions.length > 0) {
      const table = document.createElement("table");
      table.innerHTML = `
        <thead>
          <tr>
            <th>Jeu</th>
            <th>Code</th>
            <th>Joueurs</th>
            <th>Rejoindre</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector("tbody") as HTMLTableSectionElement;
      for (const session of pager.slice(name, sessions)) {
        const row = document.createElement("tr");
        // the game or the variant the session plays
        const gameCell = document.createElement("td");
        gameCell.textContent = session.display_name || game?.display_name || name;
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
          actionCell.appendChild(lockWhenFull(joinBtn));
        }

        // un spectateur suit la partie sans y jouer : meme adhésion, meme
        // access_key, pas de key, et il ne compte pas dans la limite de joueurs
        if (session.allows_watchers !== false) {
          const watchBtn = document.createElement("button");
          watchBtn.className = "watch-session-btn";
          watchBtn.textContent = "Spectateur";
          watchBtn.onclick = () => openJoinModal(session.code ?? "", "", name, "watcher");
          actionCell.appendChild(lockWhenFull(watchBtn));
        }

        row.appendChild(gameCell);
        row.appendChild(codeCell);
        row.appendChild(playersCell);
        row.appendChild(actionCell);
        tbody.appendChild(row);
      }

      container.appendChild(table);
      const controls = pager.controls(name, sessions.length);
      if (controls) container.appendChild(controls);
    } else {
      container.appendChild(emptyListMessage(searchQuery));
    }

    // an inactive game offers only its active variants: always name them in the menu
    if (variantKeys.length > 1 || (variantKeys.length === 1 && variantKeys[0] !== "default")) {
      const dropdown = document.createElement("div");
      dropdown.className = "create-dropdown";
      dropdown.innerHTML = `
        <button class="create-dropdown-btn">Create ▾</button>
        <div class="create-dropdown-content" id="dropdown-${index}"></div>
      `;
      const dropdownContent = dropdown.querySelector(".create-dropdown-content") as HTMLDivElement;
      for (const vKey of variantKeys) {
        const a = document.createElement("a");
        a.textContent = variants[vKey].display_name || variants[vKey].name;
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
      lockWhenFull(dropdownBtn);
      container.appendChild(dropdown);
    } else {
      const createBtn = document.createElement("button");
      createBtn.textContent = "Create";
      createBtn.className = "create-game-btn";
      createBtn.onclick = () => openCreateModal(name, variantKeys[0]);
      container.appendChild(lockWhenFull(createBtn));
    }

    tablesContainer.appendChild(container);
  });
}

// The documents of the game (rules, charts...), above its sessions: the same
// select as in the game page, under a first "Consulter" entry that only serves
// as a label. Those of the variants are only given to their sessions.
function renderDocumentsSelect(documents: SessionDocument[]): HTMLSelectElement | null {
  if (documents.length === 0) return null;
  const select = document.createElement("select");
  select.className = "documents-select";
  select.setAttribute("aria-label", "Consulter un document du jeu");
  select.add(new Option("Consulter un document", ""));
  for (const entry of documents) select.add(new Option(entry.name, entry.src));
  select.addEventListener("change", () => {
    const src = select.value;
    // back to "Consulter": the same document can then be opened again
    select.selectedIndex = 0;
    if (src) window.open(src, "_blank", "noopener");
  });
  return select;
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
    if (e.key === "Enter") void confirmCreateSession();
  });
  document.getElementById("input-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void confirmCreateSession();
  });
  document.getElementById("input-access-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void confirmCreateSession();
  });

  document.getElementById("join-cancel")!.onclick = closeJoinModal;
  document.getElementById("join-modal-close")!.onclick = closeJoinModal;
  document.getElementById("join-confirm")!.onclick = confirmJoinSession;
  document.getElementById("join-key")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void confirmJoinSession();
  });
}

function main(): void {
  bindEventHandlers();
  connectSharedSocket();
  // a refereed game filling or emptying changes the count of the platform too
  const refereedChanged = (): void => {
    renderAll();
    refreshSessions();
  };
  startAirForceLobby(refereedChanged);
  startJudgeDreddLobby(refereedChanged);
  startMonsterDerbyLobby(refereedChanged);
  startSuperSlapshotLobby(refereedChanged);
  startZargosLobby(refereedChanged);
}

main();
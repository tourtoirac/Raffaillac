// Page of the games in progress: the sessions of every game, the refereed
// ones (Air Force, Judge Dredd) included, with at least one player in them, on
// one list, with the number of games in progress of the platform and its limit.
// Each row leads to the lobby tab of its game.

import { AIR_FORCE_LABEL, AIR_FORCE_TAB, airForceGames, airForceMatches, startAirForceLobby } from "./airForceLobby";
import {
  JUDGE_DREDD_LABEL,
  JUDGE_DREDD_TAB,
  judgeDreddGames,
  judgeDreddMatches,
  startJudgeDreddLobby,
} from "./judgeDreddLobby";
import {
  MONSTER_DERBY_LABEL,
  MONSTER_DERBY_TAB,
  monsterDerbyGames,
  monsterDerbyMatches,
  startMonsterDerbyLobby,
} from "./monsterDerbyLobby";
import {
  SUPER_SLAPSHOT_LABEL,
  SUPER_SLAPSHOT_TAB,
  startSuperSlapshotLobby,
  superSlapshotGames,
  superSlapshotMatches,
} from "./superSlapshotLobby";
import { ZARGOS_LABEL, ZARGOS_TAB, startZargosLobby, zargosGames, zargosMatches } from "./zargosLobby";
import { lobbyReturnUrl } from "./navigation";
import { Pager, emptyListMessage, matchesSearch } from "./sessionList";
import type { ActiveSession, GameInfo, ListGameEvent, SessionsInfoEvent } from "./types";
import { getSocket } from "./ws/wsClient";

interface Row {
  gameName: string;
  gameLabel: string;
  code: string;
  players: { nickname: string; owner: boolean; connected: boolean }[];
  started: boolean;
}

const countElement = document.getElementById("games-count") as HTMLParagraphElement;
const listElement = document.getElementById("games-list") as HTMLDivElement;
const searchInput = document.getElementById("session-search") as HTMLInputElement;

let gameInfo: Record<string, GameInfo> = {};
let sessionsData: Record<string, ActiveSession[]> = {};
let activeGames: number | null = null;
let maxActiveGames: number | null = null;

let searchQuery = "";
const pager = new Pager(() => render());
const PAGER_KEY = "all";

function gameLabel(name: string): string {
  return gameInfo[name]?.display_name || name.charAt(0).toUpperCase() + name.slice(1);
}

function rows(): Row[] {
  const all: Row[] = [];
  for (const [name, sessions] of Object.entries(sessionsData)) {
    for (const session of sessions) {
      if (!matchesSearch(searchQuery, session.code, (session.players ?? []).map((p) => p.nickname))) continue;
      all.push({
        gameName: name,
        gameLabel: gameLabel(name),
        code: session.code ?? "-",
        players: (session.players ?? []).map((p) => ({
          nickname: p.nickname,
          owner: p.owner === true,
          connected: p.connected === true,
        })),
        started: session.started === true,
      });
    }
  }
  for (const game of airForceGames()) {
    if (!airForceMatches(game, searchQuery)) continue;
    all.push({
      gameName: AIR_FORCE_TAB,
      gameLabel: AIR_FORCE_LABEL,
      code: game.code,
      players: game.players.map((p) => ({ nickname: p.nickname, owner: p.owner, connected: p.connected })),
      started: game.status !== "waiting",
    });
  }
  for (const game of judgeDreddGames()) {
    if (!judgeDreddMatches(game, searchQuery)) continue;
    all.push({
      gameName: JUDGE_DREDD_TAB,
      gameLabel: JUDGE_DREDD_LABEL,
      code: game.code,
      players: game.players.map((p) => ({ nickname: p.nickname, owner: p.owner, connected: p.connected })),
      started: game.status !== "waiting",
    });
  }
  for (const game of monsterDerbyGames()) {
    if (!monsterDerbyMatches(game, searchQuery)) continue;
    all.push({
      gameName: MONSTER_DERBY_TAB,
      gameLabel: MONSTER_DERBY_LABEL,
      code: game.code,
      players: game.players.map((p) => ({ nickname: p.nickname, owner: p.owner, connected: p.connected })),
      started: game.status !== "waiting",
    });
  }
  for (const game of superSlapshotGames()) {
    if (!superSlapshotMatches(game, searchQuery)) continue;
    all.push({
      gameName: SUPER_SLAPSHOT_TAB,
      gameLabel: SUPER_SLAPSHOT_LABEL,
      code: game.code,
      players: game.players.map((p) => ({ nickname: p.nickname, owner: p.owner, connected: p.connected })),
      started: game.status !== "waiting",
    });
  }
  for (const game of zargosGames()) {
    if (!zargosMatches(game, searchQuery)) continue;
    all.push({
      gameName: ZARGOS_TAB,
      gameLabel: ZARGOS_LABEL,
      code: game.code,
      players: game.players.map((p) => ({ nickname: p.nickname, owner: p.owner, connected: p.connected })),
      started: game.status !== "waiting",
    });
  }
  // a game in progress has a player in it: the others wait in the lobby
  return all
    .filter((row) => row.players.some((player) => player.connected))
    .sort((a, b) => a.gameLabel.localeCompare(b.gameLabel) || a.code.localeCompare(b.code));
}

function renderCount(): void {
  if (activeGames === null || maxActiveGames === null) {
    countElement.textContent = "";
    return;
  }
  countElement.textContent = `${activeGames} partie(s) en cours sur ${maxActiveGames} possibles, tous jeux confondus.`;
  countElement.classList.toggle("full", activeGames >= maxActiveGames);
}

function render(): void {
  renderCount();
  listElement.replaceChildren();
  const shown = rows();
  if (shown.length === 0) {
    listElement.appendChild(emptyListMessage(searchQuery));
    return;
  }
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Jeu</th>
        <th>Code</th>
        <th>Joueurs</th>
        <th>État</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody") as HTMLTableSectionElement;
  for (const row of pager.slice(PAGER_KEY, shown)) {
    const tr = document.createElement("tr");
    const gameCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = lobbyReturnUrl(row.gameName);
    link.textContent = row.gameLabel;
    link.title = "Ouvrir ce jeu dans le lobby";
    gameCell.appendChild(link);

    const codeCell = document.createElement("td");
    codeCell.textContent = row.code;

    const playersCell = document.createElement("td");
    if (row.players.length === 0) playersCell.textContent = "-";
    for (const player of row.players) {
      const tag = document.createElement("span");
      tag.className = "player" + (player.connected ? " connected" : "");
      tag.textContent = player.nickname + (player.owner ? " (owner)" : "");
      tag.title = player.connected ? "En jeu" : "Absent";
      playersCell.appendChild(tag);
    }

    const stateCell = document.createElement("td");
    stateCell.textContent = row.started ? "Commencée" : "En attente de joueurs";

    tr.append(gameCell, codeCell, playersCell, stateCell);
    tbody.appendChild(tr);
  }
  listElement.appendChild(table);
  const controls = pager.controls(PAGER_KEY, shown.length);
  if (controls) listElement.appendChild(controls);
}

function connect(): void {
  const socket = getSocket();
  if (!socket) {
    listElement.textContent = "WebSocket indisponible dans ce navigateur.";
    return;
  }
  socket.setStateHandler((message) => {
    if (message.connected) socket.send({ action: "list_game" });
  });
  socket.setMessageHandler((raw) => {
    const data = raw as { event?: string };
    if (data.event === "list_game") {
      gameInfo = {};
      for (const game of (data as ListGameEvent).game_list ?? []) gameInfo[game.name] = game;
      socket.send({ action: "list_sessions" });
    } else if (data.event === "sessions_info") {
      const content = (data as unknown as SessionsInfoEvent).content;
      sessionsData = content?.active ?? {};
      activeGames = content?.active_games ?? null;
      maxActiveGames = content?.max_active_games ?? null;
      render();
    } else if (data.event === "session_players_changed") {
      socket.send({ action: "list_sessions" });
    }
  });
}

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  pager.reset();
  render();
});

connect();
// the refereed games come from their service (the modules of Hautefort), which also
// push their changes; one created or ended changes the count of the platform as well
const refereedChanged = (): void => {
  render();
  getSocket()?.send({ action: "list_sessions" });
};
startAirForceLobby(refereedChanged);
startJudgeDreddLobby(refereedChanged);
startMonsterDerbyLobby(refereedChanged);
startSuperSlapshotLobby(refereedChanged);
startZargosLobby(refereedChanged);

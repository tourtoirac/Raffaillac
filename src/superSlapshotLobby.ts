// "Super Slapshot" tab of the lobby, among the refereed games. Its games live in
// the superslapshot module of the Hautefort service, published next to the lobby
// under hautefort/superslapshot/ (same origin: the Raffaillac nginx forwards it).
// This tab lists them, creates and joins them through the API of the module,
// and opens its game page (serviceModal.ts). A game takes 2 to 7 managers, each
// with the color of a marker given in turn, and starts when its owner says so
// on the game page.

import {
  type Field,
  type SeatGrant,
  enterServiceGame,
  openModal,
  postJson,
  serviceUrl,
  textField,
  watchersCheckbox,
} from "./serviceModal";
import { setServicePrivate } from "./prototype";
import { emptyListMessage, matchesSearch } from "./sessionList";
import type { Pager } from "./sessionList";

// not "super_slapshot": the lobby compares game names whatever their case, and the
// table version of the game was Super_Slapshot in Chabanas
export const SUPER_SLAPSHOT_TAB = "super_slapshot_refereed";
export const SUPER_SLAPSHOT_LABEL = "Super Slapshot";

// the Super Slapshot module of Hautefort
export const SUPER_SLAPSHOT = serviceUrl("hautefort/superslapshot/");
// seat tokens, read back by the Super Slapshot game page (same origin, same tab)
const SEATS_KEY = "superslapshot_seats";

export interface SuperSlapshotPlayer {
  nickname: string;
  color: string;
  color_name: string;
  owner: boolean;
  connected: boolean;
  has_key: boolean;
  wins: number;
}

export interface SuperSlapshotGame {
  id: string;
  code: string;
  status: "waiting" | "playing" | "finished";
  turn: number;
  allows_watchers: boolean;
  has_access_key: boolean;
  players: SuperSlapshotPlayer[];
  open_colors: string[];
  watchers: number;
}

interface Catalog {
  colors: { key: string; name: string }[];
  wins: number;
}

let games: SuperSlapshotGame[] = [];
let catalog: Catalog | null = null;
let connected = false;
// an administrator may turn the module off (OBG /manage/ pages): its tab goes away
let active = true;
let rerender: () => void = () => {};

export function superSlapshotAvailable(): boolean {
  return connected && active;
}

// the games the module lists (not finished, not archived)
export function superSlapshotGames(): readonly SuperSlapshotGame[] {
  return games;
}

export function superSlapshotMatches(game: SuperSlapshotGame, query: string): boolean {
  return matchesSearch(query, game.code, game.players.map((p) => p.nickname));
}

// -------------------------------------------------
// Connection to the Super Slapshot module of Hautefort
// -------------------------------------------------

export function startSuperSlapshotLobby(onChange: () => void): void {
  rerender = onChange;
  void fetch(new URL("api/catalog", SUPER_SLAPSHOT))
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .then((c) => {
      catalog = c;
    })
    .catch(() => {});
  let delay = 2000;
  const open = (): void => {
    const url = new URL("ws/lobby", SUPER_SLAPSHOT);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as { event: string; games?: SuperSlapshotGame[]; active?: boolean; private?: boolean };
      if (data.event !== "games") return;
      games = data.games ?? [];
      // absent from an older Hautefort: the module is on
      active = data.active !== false;
      // in prototyping: the lobby locks the tab until its key is given
      setServicePrivate(SUPER_SLAPSHOT, data.private === true);
      connected = true;
      delay = 2000;
      rerender();
    };
    ws.onclose = () => {
      // Hautefort down: the tab disappears until it is back
      if (connected) {
        connected = false;
        rerender();
      }
      window.setTimeout(open, delay);
      delay = Math.min(delay * 2, 30000);
    };
  };
  open();
}

function enterGame(grant: SeatGrant): void {
  enterServiceGame(SUPER_SLAPSHOT, SEATS_KEY, grant);
}

function openCreateModal(): void {
  const c = catalog;
  if (!c) {
    window.alert("Hautefort ne répond pas : impossible de créer une partie.");
    return;
  }
  let watchers: HTMLInputElement | null = null;
  openModal(
    "Créer une partie — Super Slapshot",
    [
      textField("nickname", "Nickname (obligatoire)", "Votre pseudo"),
      textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"),
      textField("access_key", "Clé d'accès au jeu (optionnel)", "Clé d'accès au jeu"),
    ],
    "Créer",
    async (v) => {
      enterGame(
        await postJson(SUPER_SLAPSHOT, "api/games", {
          nickname: v.nickname,
          key: v.key,
          access_key: v.access_key,
          allows_watchers: watchers?.checked ?? true,
        }),
      );
    },
    (form) => {
      watchers = watchersCheckbox(form, "ss-allow-watchers");
    },
  );
}

function openJoinModal(game: SuperSlapshotGame, role: "player" | "watcher", nickname = ""): void {
  const comingBack = nickname !== "";
  const fields: Field[] = [textField("nickname", "Nickname (obligatoire)", "Votre pseudo", nickname, comingBack)];
  if (role === "player" || comingBack) fields.push(textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"));
  if (game.has_access_key) fields.push(textField("access_key", "Clé d'accès au jeu", "Clé d'accès au jeu"));
  const title = comingBack ? `Reprendre la place de ${nickname}` : role === "watcher" ? "Regarder la partie" : "Rejoindre la partie";
  openModal(`${title} ${game.code}`, fields, role === "watcher" && !comingBack ? "Regarder" : "Rejoindre", async (v) => {
    enterGame(
      await postJson(SUPER_SLAPSHOT, `api/games/${game.id}/join`, {
        nickname: v.nickname,
        key: v.key ?? "",
        access_key: v.access_key ?? "",
        role,
      }),
    );
  });
}

// -------------------------------------------------
// Tab content
// -------------------------------------------------

export function renderSuperSlapshotTab(
  container: HTMLDivElement,
  query: string,
  pager: Pager,
  lockWhenFull: (button: HTMLButtonElement) => HTMLButtonElement,
): void {
  const shown = games.filter((game) => superSlapshotMatches(game, query));
  if (shown.length > 0) {
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
    for (const game of pager.slice(SUPER_SLAPSHOT_TAB, shown)) {
      const row = document.createElement("tr");
      const codeCell = document.createElement("td");
      codeCell.textContent = game.code;
      codeCell.title = game.status === "waiting" ? "En attente des managers" : `Tour ${game.turn}`;

      const playersCell = document.createElement("td");
      for (const player of game.players) {
        // same rule as the OBG tables: a seat in play is green and locked, an
        // empty one can be taken back by its nickname
        const btn = document.createElement("button");
        btn.className = "player-btn" + (player.connected ? " connected" : "");
        btn.textContent = game.status === "waiting" ? `${player.nickname} (${player.color_name})` : `${player.nickname} (${player.wins} V)`;
        btn.disabled = player.connected;
        btn.title = player.connected ? "En jeu" : "Rejoindre en tant que " + player.nickname;
        if (!player.connected) btn.onclick = () => openJoinModal(game, "player", player.nickname);
        if (player.owner) {
          const badge = document.createElement("span");
          badge.className = "owner-badge";
          badge.textContent = "(owner)";
          btn.appendChild(badge);
        }
        playersCell.appendChild(btn);
      }

      const actionCell = document.createElement("td");
      actionCell.className = "join-actions";
      if (game.open_colors.length > 0) {
        const joinBtn = document.createElement("button");
        joinBtn.className = "join-session-btn";
        joinBtn.textContent = "Join";
        joinBtn.onclick = () => openJoinModal(game, "player");
        actionCell.appendChild(lockWhenFull(joinBtn));
      }
      if (game.allows_watchers) {
        const watchBtn = document.createElement("button");
        watchBtn.className = "watch-session-btn";
        watchBtn.textContent = "Spectateur";
        watchBtn.onclick = () => openJoinModal(game, "watcher");
        actionCell.appendChild(lockWhenFull(watchBtn));
      }
      row.append(codeCell, playersCell, actionCell);
      tbody.appendChild(row);
    }
    container.appendChild(table);
    const controls = pager.controls(SUPER_SLAPSHOT_TAB, shown.length);
    if (controls) container.appendChild(controls);
  } else {
    container.appendChild(emptyListMessage(query));
  }
  const createBtn = document.createElement("button");
  createBtn.textContent = "Create";
  createBtn.className = "create-game-btn";
  createBtn.onclick = openCreateModal;
  container.appendChild(lockWhenFull(createBtn));
}

// "Judge Dredd" tab of the lobby, among the refereed games. Its games live in
// the judgedredd module of the Hautefort service, published next to the lobby
// under hautefort/judgedredd/ (same origin: the Raffaillac nginx forwards it).
// This tab lists them, creates and joins them through the API of the module,
// and opens its game page
// (serviceModal.ts). A game takes 2 to 6 players, each with the judge of a
// color, and starts when its owner says so on the game page.

import {
  type Field,
  type SeatGrant,
  enterServiceGame,
  openModal,
  postJson,
  selectField,
  serviceUrl,
  textField,
  watchersCheckbox,
} from "./serviceModal";
import { emptyListMessage, matchesSearch } from "./sessionList";
import type { Pager } from "./sessionList";

// not "judge_dredd": the lobby compares game names whatever their case, and the
// table version of the game is named Judge_Dredd in Chabanas
export const JUDGE_DREDD_TAB = "judge_dredd_refereed";
export const JUDGE_DREDD_LABEL = "Judge Dredd";

// the Judge Dredd module of Hautefort
const JUDGE_DREDD = serviceUrl("hautefort/judgedredd/");
// seat tokens, read back by the Judge Dredd game page (same origin, same tab)
const SEATS_KEY = "judgedredd_seats";

export interface JudgeDreddPlayer {
  nickname: string;
  color: string;
  color_name: string;
  owner: boolean;
  connected: boolean;
  has_key: boolean;
}

export interface JudgeDreddGame {
  id: string;
  code: string;
  status: "waiting" | "playing" | "finished";
  turn: number;
  allows_watchers: boolean;
  has_access_key: boolean;
  players: JudgeDreddPlayer[];
  open_colors: string[];
  watchers: number;
}

interface Catalog {
  colors: { key: string; name: string }[];
}

let games: JudgeDreddGame[] = [];
let colors: { key: string; name: string }[] = [];
let connected = false;
// an administrator may turn the module off (OBG /manage/ pages): its tab goes away
let active = true;
let rerender: () => void = () => {};

export function judgeDreddAvailable(): boolean {
  return connected && active;
}

// the games the module lists (not finished, not archived)
export function judgeDreddGames(): readonly JudgeDreddGame[] {
  return games;
}

export function judgeDreddMatches(game: JudgeDreddGame, query: string): boolean {
  return matchesSearch(query, game.code, game.players.map((p) => p.nickname));
}

// -------------------------------------------------
// Connection to the Judge Dredd module of Hautefort
// -------------------------------------------------

export function startJudgeDreddLobby(onChange: () => void): void {
  rerender = onChange;
  void fetch(new URL("api/catalog", JUDGE_DREDD))
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .then((c) => {
      colors = c?.colors ?? [];
    })
    .catch(() => {});
  let delay = 2000;
  const open = (): void => {
    const url = new URL("ws/lobby", JUDGE_DREDD);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as { event: string; games?: JudgeDreddGame[]; active?: boolean };
      if (data.event !== "games") return;
      games = data.games ?? [];
      // absent from an older Hautefort: the module is on
      active = data.active !== false;
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
  enterServiceGame(JUDGE_DREDD, SEATS_KEY, grant);
}

function colorField(available: string[]): Field {
  return selectField(
    "color",
    "Couleur du juge",
    colors.filter((c) => available.includes(c.key)).map((c) => ({ value: c.key, label: c.name })),
  );
}

function openCreateModal(): void {
  if (!colors.length) {
    window.alert("Hautefort ne répond pas : impossible de créer une partie.");
    return;
  }
  let watchers: HTMLInputElement | null = null;
  openModal(
    "Créer une partie — Judge Dredd",
    [
      textField("nickname", "Nickname (obligatoire)", "Votre pseudo"),
      textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"),
      colorField(colors.map((c) => c.key)),
      textField("access_key", "Clé d'accès au jeu (optionnel)", "Clé d'accès au jeu"),
    ],
    "Créer",
    async (v) => {
      enterGame(
        await postJson(JUDGE_DREDD, "api/games", {
          nickname: v.nickname,
          key: v.key,
          access_key: v.access_key,
          allows_watchers: watchers?.checked ?? true,
          color: v.color,
        }),
      );
    },
    (form) => {
      watchers = watchersCheckbox(form, "jd-allow-watchers");
    },
  );
}

function openJoinModal(game: JudgeDreddGame, role: "player" | "watcher", nickname = ""): void {
  const comingBack = nickname !== "";
  const fields: Field[] = [textField("nickname", "Nickname (obligatoire)", "Votre pseudo", nickname, comingBack)];
  if (role === "player" || comingBack) fields.push(textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"));
  if (role === "player" && !comingBack) fields.push(colorField(game.open_colors));
  if (game.has_access_key) fields.push(textField("access_key", "Clé d'accès au jeu", "Clé d'accès au jeu"));
  const title = comingBack ? `Reprendre la place de ${nickname}` : role === "watcher" ? "Regarder la partie" : "Rejoindre la partie";
  openModal(`${title} ${game.code}`, fields, role === "watcher" && !comingBack ? "Regarder" : "Rejoindre", async (v) => {
    enterGame(
      await postJson(JUDGE_DREDD, `api/games/${game.id}/join`, {
        nickname: v.nickname,
        key: v.key ?? "",
        access_key: v.access_key ?? "",
        role,
        color: v.color ?? null,
      }),
    );
  });
}

// -------------------------------------------------
// Tab content
// -------------------------------------------------

export function renderJudgeDreddTab(
  container: HTMLDivElement,
  query: string,
  pager: Pager,
  lockWhenFull: (button: HTMLButtonElement) => HTMLButtonElement,
): void {
  const shown = games.filter((game) => judgeDreddMatches(game, query));
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
    for (const game of pager.slice(JUDGE_DREDD_TAB, shown)) {
      const row = document.createElement("tr");
      const codeCell = document.createElement("td");
      codeCell.textContent = game.code;
      codeCell.title = game.status === "waiting" ? "En attente des joueurs" : `Tour ${game.turn}`;

      const playersCell = document.createElement("td");
      for (const player of game.players) {
        // same rule as the OBG tables: a seat in play is green and locked, an
        // empty one can be taken back by its nickname
        const btn = document.createElement("button");
        btn.className = "player-btn" + (player.connected ? " connected" : "");
        btn.textContent = `${player.nickname} (${player.color_name})`;
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
    const controls = pager.controls(JUDGE_DREDD_TAB, shown.length);
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

// "The Alamo" tab of the lobby, among the refereed games. Its games live in the
// alamo module of the Hautefort service, published next to the lobby under
// hautefort/alamo/ (same origin: the Raffaillac nginx forwards it). This tab lists
// them, creates and joins them through the API of the module, and opens its game
// page (serviceModal.ts). The owner picks a side (Texan or Mexican) and the optional
// rules of the booklet (all checked by default); the game starts when the second
// player takes the free side.

import {
  type Field,
  type SeatGrant,
  enterServiceGame,
  openModal,
  postJson,
  serviceUrl,
  selectField,
  textField,
  watchersCheckbox,
} from "./serviceModal";
import { setServicePrivate } from "./prototype";
import { setServiceDocuments } from "./serviceDocuments";
import type { SessionDocument } from "./types";
import { emptyListMessage, highlightedFirst, isHighlighted, matchesSearch } from "./sessionList";
import type { Pager } from "./sessionList";

// not "alamo": the lobby compares game names whatever their case, and the table
// version of the game is named Alamo in Chabanas
export const ALAMO_TAB = "alamo_refereed";
export const ALAMO_LABEL = "The Alamo";

// the Alamo module of Hautefort
export const ALAMO = serviceUrl("hautefort/alamo/");
// seat tokens, read back by the Alamo game page (same origin, same tab)
const SEATS_KEY = "alamo_seats";

export interface AlamoPlayer {
  nickname: string;
  side: string;
  side_name: string;
  owner: boolean;
  connected: boolean;
  has_key: boolean;
}

export interface AlamoGame {
  id: string;
  code: string;
  status: "waiting" | "playing" | "finished";
  turn: number;
  variant: string | null;
  variant_name: string | null;
  allows_watchers: boolean;
  has_access_key: boolean;
  players: AlamoPlayer[];
  open_sides: { key: string; name: string }[];
  watchers: number;
}

interface Catalog {
  sides: { key: string; name: string }[];
  options: { key: string; name: string }[];
}

let games: AlamoGame[] = [];
let catalog: Catalog | null = null;
let connected = false;
// an administrator may turn the module off (OBG /manage/ pages): its tab goes away
let active = true;
let rerender: () => void = () => {};

export function alamoAvailable(): boolean {
  return connected && active;
}

// the games the module lists (not finished, not archived)
export function alamoGames(): readonly AlamoGame[] {
  return games;
}

export function alamoMatches(game: AlamoGame, query: string): boolean {
  return matchesSearch(query, game.code, game.players.map((p) => p.nickname));
}

// -------------------------------------------------
// Connection to the Alamo module of Hautefort
// -------------------------------------------------

export function startAlamoLobby(onChange: () => void): void {
  rerender = onChange;
  void fetch(new URL("api/catalog", ALAMO))
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .then((c) => {
      catalog = c;
    })
    .catch(() => {});
  let delay = 2000;
  const open = (): void => {
    const url = new URL("ws/lobby", ALAMO);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as { event: string; games?: AlamoGame[]; active?: boolean; private?: boolean; documents?: SessionDocument[] };
      if (data.event !== "games") return;
      games = data.games ?? [];
      // absent from an older Hautefort: the module is on
      active = data.active !== false;
      // in prototyping: the lobby locks the tab until its key is given
      setServicePrivate(ALAMO, data.private === true);
      // its rules and charts, shown above its games
      setServiceDocuments(ALAMO, data.documents);
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
  enterServiceGame(ALAMO, SEATS_KEY, grant);
}

function openCreateModal(): void {
  const c = catalog;
  if (!c) {
    window.alert("Hautefort ne répond pas : impossible de créer une partie.");
    return;
  }
  let watchers: HTMLInputElement | null = null;
  const options = new Map<string, HTMLInputElement>();
  openModal(
    "Créer une partie — The Alamo",
    [
      textField("nickname", "Nickname (obligatoire)", "Votre pseudo"),
      textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"),
      selectField("side", "Camp", c.sides.map((s) => ({ value: s.key, label: s.name }))),
      textField("access_key", "Clé d'accès au jeu (optionnel)", "Clé d'accès au jeu"),
    ],
    "Créer",
    async (v) => {
      enterGame(
        await postJson(ALAMO, "api/games", {
          nickname: v.nickname,
          key: v.key,
          access_key: v.access_key,
          side: v.side,
          options: Object.fromEntries([...options].map(([k, box]) => [k, box.checked])),
          allows_watchers: watchers?.checked ?? true,
        }),
      );
    },
    (form) => {
      // the optional rules of the booklet, all played by default
      for (const o of c.options ?? []) {
        const row = document.createElement("div");
        row.className = "checkbox-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.id = `al-option-${o.key}`;
        box.checked = true;
        const label = document.createElement("label");
        label.htmlFor = box.id;
        label.textContent = `Règle optionnelle : ${o.name}`;
        row.append(box, label);
        form.appendChild(row);
        options.set(o.key, box);
      }
      watchers = watchersCheckbox(form, "al-allow-watchers");
    },
  );
}

function openJoinModal(game: AlamoGame, role: "player" | "watcher", nickname = ""): void {
  const comingBack = nickname !== "";
  const fields: Field[] = [textField("nickname", "Nickname (obligatoire)", "Votre pseudo", nickname, comingBack)];
  if (role === "player" || comingBack) fields.push(textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"));
  if (game.has_access_key) fields.push(textField("access_key", "Clé d'accès au jeu", "Clé d'accès au jeu"));
  const title = comingBack ? `Reprendre la place de ${nickname}` : role === "watcher" ? "Regarder la partie" : "Rejoindre la partie";
  openModal(`${title} ${game.code}`, fields, role === "watcher" && !comingBack ? "Regarder" : "Rejoindre", async (v) => {
    enterGame(
      await postJson(ALAMO, `api/games/${game.id}/join`, {
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

export function renderAlamoTab(
  container: HTMLDivElement,
  query: string,
  pager: Pager,
  lockWhenFull: (button: HTMLButtonElement) => HTMLButtonElement,
): void {
  const shown = highlightedFirst(games.filter((game) => alamoMatches(game, query)), (game) => game.code);
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
    for (const game of pager.slice(ALAMO_TAB, shown)) {
      const row = document.createElement("tr");
      if (isHighlighted(game.code)) row.className = "highlighted";
      const codeCell = document.createElement("td");
      codeCell.textContent = game.code;
      codeCell.title = (game.status === "waiting" ? "En attente de l'adversaire" : `Tour ${game.turn}`) +
        (game.variant_name ? ` · ${game.variant_name}` : "");

      const playersCell = document.createElement("td");
      for (const player of game.players) {
        // same rule as the OBG tables: a seat in play is green and locked, an
        // empty one can be taken back by its nickname
        const btn = document.createElement("button");
        btn.className = "player-btn" + (player.connected ? " connected" : "");
        btn.textContent = `${player.nickname} (${player.side_name})`;
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
      if (game.open_sides.length > 0) {
        const joinBtn = document.createElement("button");
        joinBtn.className = "join-session-btn";
        joinBtn.textContent = `Join (${game.open_sides[0].name})`;
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
    const controls = pager.controls(ALAMO_TAB, shown.length);
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

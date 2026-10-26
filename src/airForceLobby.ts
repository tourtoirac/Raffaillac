// "Air Force" tab of the lobby, among the refereed games. Air Force is not
// played on the OBG table: its games live in the airforce module of the
// Hautefort service, published next to the lobby under hautefort/airforce/
// (same origin: the Raffaillac nginx forwards it). This tab lists them, creates
// and joins them through the API of the module, and opens its game page
// (serviceModal.ts).

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

export const AIR_FORCE_TAB = "air_force";
export const AIR_FORCE_LABEL = "Air Force";

// the Air Force module of Hautefort, next to the lobby whatever the public path
// (/ locally, /obg/ in production)
const HAUTEFORT = serviceUrl("hautefort/airforce/");
// seat tokens, read back by the Hautefort game page (same origin, same tab)
const SEATS_KEY = "hautefort_seats";

export interface AirForcePlayer {
  nickname: string;
  side: string;
  side_name: string;
  aircraft_name: string | null;
  owner: boolean;
  connected: boolean;
  has_key: boolean;
}

export interface AirForceGame {
  id: string;
  code: string;
  scenario_name: string;
  status: "waiting" | "playing" | "finished";
  turn: number;
  max_turns: number | null; // null: no limit
  planes_per_side: number;
  allows_watchers: boolean;
  has_access_key: boolean;
  players: AirForcePlayer[];
  open_sides: { key: string; name: string; aircraft: string[] }[];
  watchers: number;
}

interface CatalogSide {
  key: string;
  name: string;
  aircraft: { key: string; name: string }[];
}

interface Catalog {
  scenarios: {
    key: string;
    name: string;
    min_planes: number;
    max_planes: number;
    default_planes: number;
    max_turns: number; // default length
    turn_options?: (number | null)[]; // null: no limit
    sides: CatalogSide[];
  }[];
}

let games: AirForceGame[] = [];
let catalog: Catalog | null = null;
let connected = false;
// an administrator may turn the module off (OBG /manage/ pages): its tab goes away
let active = true;
let rerender: () => void = () => {};

export function airForceAvailable(): boolean {
  return connected && active;
}

// the games Hautefort lists (not finished, not archived)
export function airForceGames(): readonly AirForceGame[] {
  return games;
}

export function airForceMatches(game: AirForceGame, query: string): boolean {
  return matchesSearch(query, game.code, game.players.map((p) => p.nickname));
}

// -------------------------------------------------
// Connection to Hautefort
// -------------------------------------------------

export function startAirForceLobby(onChange: () => void): void {
  rerender = onChange;
  void fetch(new URL("api/catalog", HAUTEFORT))
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .then((c) => {
      catalog = c;
    })
    .catch(() => {});
  let delay = 2000;
  const open = (): void => {
    const url = new URL("ws/lobby", HAUTEFORT);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as { event: string; games?: AirForceGame[]; active?: boolean };
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

function post(path: string, body: unknown): Promise<SeatGrant> {
  return postJson(HAUTEFORT, path, body);
}

function enterGame(grant: SeatGrant): void {
  enterServiceGame(HAUTEFORT, SEATS_KEY, grant);
}

function aircraftOptions(side: CatalogSide | undefined, keys?: string[]): { value: string; label: string }[] {
  const list = side?.aircraft ?? [];
  return list.filter((a) => !keys || keys.includes(a.key)).map((a) => ({ value: a.key, label: a.name }));
}

function openCreateModal(): void {
  const scenario = catalog?.scenarios[0];
  if (!scenario) {
    window.alert("Hautefort ne répond pas : impossible de créer une partie.");
    return;
  }
  const side = selectField("side", "Camp", scenario.sides.map((s) => ({ value: s.key, label: s.name })));
  const aircraft = selectField("aircraft", "Avion", aircraftOptions(scenario.sides[0]));
  const planes = selectField(
    "planes",
    "Avions par camp",
    Array.from({ length: scenario.max_planes - scenario.min_planes + 1 }, (_, i) => {
      const n = String(scenario.min_planes + i);
      return { value: n, label: n };
    }),
    String(scenario.default_planes),
  );
  const turns = selectField(
    "turns",
    "Nombre de tours",
    (scenario.turn_options ?? [scenario.max_turns]).map((t) => ({
      value: t === null ? "" : String(t),
      label: t === null ? "Sans limite" : String(t),
    })),
    String(scenario.max_turns),
  );
  side.input.onchange = () => {
    const chosen = scenario.sides.find((s) => s.key === side.input.value);
    const select = aircraft.input as HTMLSelectElement;
    select.replaceChildren(
      ...aircraftOptions(chosen).map((o) => {
        const option = document.createElement("option");
        option.value = o.value;
        option.textContent = o.label;
        return option;
      }),
    );
  };
  let watchers: HTMLInputElement | null = null;
  openModal(
    `Créer une partie — ${scenario.name}`,
    [
      textField("nickname", "Nickname (obligatoire)", "Votre pseudo"),
      textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"),
      side,
      aircraft,
      planes,
      turns,
      textField("access_key", "Clé d'accès au jeu (optionnel)", "Clé d'accès au jeu"),
    ],
    "Créer",
    async (v) => {
      enterGame(
        await post("api/games", {
          nickname: v.nickname,
          key: v.key,
          access_key: v.access_key,
          allows_watchers: watchers?.checked ?? true,
          scenario: scenario.key,
          side: v.side,
          aircraft: v.aircraft,
          planes_per_side: Number(v.planes),
          max_turns: v.turns ? Number(v.turns) : null,
        }),
      );
    },
    (form) => {
      watchers = watchersCheckbox(form, "af-allow-watchers");
    },
  );
}

function openJoinModal(game: AirForceGame, role: "player" | "watcher", nickname = ""): void {
  const fields: Field[] = [textField("nickname", "Nickname (obligatoire)", "Votre pseudo", nickname, nickname !== "")];
  const comingBack = nickname !== "";
  if (role === "player" || comingBack) fields.push(textField("key", "Clé d'utilisateur (Optionnel)", "Clé de vérification"));
  const open = game.open_sides[0];
  if (role === "player" && !comingBack && open) {
    const side = catalog?.scenarios[0]?.sides.find((s) => s.key === open.key);
    fields.push(selectField("aircraft", `Avion (${open.name})`, aircraftOptions(side, open.aircraft)));
  }
  if (game.has_access_key) fields.push(textField("access_key", "Clé d'accès au jeu", "Clé d'accès au jeu"));
  const title = comingBack ? `Reprendre la place de ${nickname}` : role === "watcher" ? "Regarder la partie" : "Rejoindre la partie";
  openModal(`${title} ${game.code}`, fields, role === "watcher" && !comingBack ? "Regarder" : "Rejoindre", async (v) => {
    enterGame(
      await post(`api/games/${game.id}/join`, {
        nickname: v.nickname,
        key: v.key ?? "",
        access_key: v.access_key ?? "",
        role,
        aircraft: v.aircraft ?? null,
        side: open?.key ?? null,
      }),
    );
  });
}

// -------------------------------------------------
// Tab content
// -------------------------------------------------

export function renderAirForceTab(
  container: HTMLDivElement,
  query: string,
  pager: Pager,
  lockWhenFull: (button: HTMLButtonElement) => HTMLButtonElement,
): void {
  const shown = games.filter((game) => airForceMatches(game, query));
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
    for (const game of pager.slice(AIR_FORCE_TAB, shown)) {
      const row = document.createElement("tr");
      const codeCell = document.createElement("td");
      codeCell.textContent = game.code;
      const length = game.max_turns === null ? "sans limite de tours" : `${game.max_turns} tours`;
      codeCell.title = `${game.scenario_name}, ${game.planes_per_side} avion(s) par camp, ${length}` +
        (game.status === "playing" ? `, tour ${game.turn}` : "");

      const playersCell = document.createElement("td");
      for (const player of game.players) {
        // same rule as the OBG tables: a seat in play is green and locked, an
        // empty one can be taken back by its nickname
        const btn = document.createElement("button");
        btn.className = "player-btn" + (player.connected ? " connected" : "");
        btn.textContent = `${player.nickname} (${player.side_name}, ${player.aircraft_name ?? "?"})`;
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
    const controls = pager.controls(AIR_FORCE_TAB, shown.length);
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

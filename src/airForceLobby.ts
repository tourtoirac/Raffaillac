// "Air Force" tab of the lobby. Air Force is not played on the OBG table: its
// games live in the Hautefort service, published next to the lobby under
// hautefort/ (same origin: the Raffaillac nginx forwards it). This tab lists
// them, creates and joins them through the Hautefort API, and opens its game
// page. As everywhere in OBG there is no account: a nickname, an optional
// personal key to take one's seat back, an optional access key for the game.

export const AIR_FORCE_TAB = "air_force";
export const AIR_FORCE_LABEL = "Air Force";

// Hautefort, next to the lobby whatever the public path (/ locally, /obg/ in production)
const HAUTEFORT = new URL("hautefort/", new URL(import.meta.env.BASE_URL, window.location.href));
// seat tokens, read back by the Hautefort game page (same origin, same tab)
const SEATS_KEY = "hautefort_seats";

interface AirForcePlayer {
  nickname: string;
  side: string;
  side_name: string;
  aircraft_name: string | null;
  owner: boolean;
  connected: boolean;
  has_key: boolean;
}

interface AirForceGame {
  id: string;
  code: string;
  scenario_name: string;
  status: "waiting" | "playing" | "finished";
  turn: number;
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
    sides: CatalogSide[];
  }[];
}

interface SeatGrant {
  game_id: string;
  token: string;
  nickname: string;
  role: "player" | "watcher";
  side: string | null;
}

let games: AirForceGame[] = [];
let catalog: Catalog | null = null;
let connected = false;
let rerender: () => void = () => {};

export function airForceAvailable(): boolean {
  return connected;
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
      const data = JSON.parse(e.data as string) as { event: string; games?: AirForceGame[] };
      if (data.event !== "games") return;
      games = data.games ?? [];
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

async function post(path: string, body: unknown): Promise<SeatGrant> {
  const response = await fetch(new URL(path, HAUTEFORT), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as SeatGrant & { error?: { message: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `Erreur ${response.status}`);
  return data;
}

function enterGame(grant: SeatGrant): void {
  let seats: Record<string, unknown> = {};
  try {
    seats = JSON.parse(window.sessionStorage.getItem(SEATS_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    seats = {};
  }
  seats[grant.game_id] = { token: grant.token, nickname: grant.nickname, role: grant.role, side: grant.side };
  window.sessionStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  const url = new URL(".", HAUTEFORT);
  url.searchParams.set("game", grant.game_id);
  window.location.href = url.toString();
}

// -------------------------------------------------
// Modal (same look as the OBG modals of index.html)
// -------------------------------------------------

interface Field {
  name: string;
  label: string;
  input: HTMLInputElement | HTMLSelectElement;
}

function textField(name: string, label: string, placeholder = "", value = "", readOnly = false): Field {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.value = value;
  input.readOnly = readOnly;
  return { name, label, input };
}

function selectField(name: string, label: string, options: { value: string; label: string }[], value?: string): Field {
  const input = document.createElement("select");
  for (const o of options) {
    const option = document.createElement("option");
    option.value = o.value;
    option.textContent = o.label;
    input.appendChild(option);
  }
  if (value !== undefined) input.value = value;
  return { name, label, input };
}

function openModal(
  title: string,
  fields: Field[],
  confirmLabel: string,
  onConfirm: (values: Record<string, string>) => Promise<void>,
  extra?: (form: HTMLDivElement, fields: Map<string, Field>) => void,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay show";
  const form = document.createElement("div");
  form.className = "modal-form";
  const close = document.createElement("button");
  close.className = "modal-close";
  close.type = "button";
  close.textContent = "×";
  close.onclick = () => overlay.remove();
  const heading = document.createElement("h3");
  heading.textContent = title;
  form.append(close, heading);
  const byName = new Map<string, Field>();
  for (const f of fields) {
    const label = document.createElement("label");
    label.textContent = f.label;
    form.append(label, f.input);
    byName.set(f.name, f);
  }
  extra?.(form, byName);
  const error = document.createElement("div");
  error.className = "error-msg";
  error.style.display = "none";
  const buttons = document.createElement("div");
  buttons.className = "form-buttons";
  const cancel = document.createElement("button");
  cancel.className = "btn-cancel";
  cancel.textContent = "Annuler";
  cancel.onclick = () => overlay.remove();
  const confirm = document.createElement("button");
  confirm.className = "btn-confirm";
  confirm.textContent = confirmLabel;
  confirm.onclick = async () => {
    const values: Record<string, string> = {};
    for (const [name, f] of byName) values[name] = f.input.value.trim();
    if (!values.nickname) {
      error.textContent = "Le nickname est obligatoire.";
      error.style.display = "block";
      return;
    }
    confirm.disabled = true;
    try {
      await onConfirm(values);
    } catch (e) {
      error.textContent = (e as Error).message;
      error.style.display = "block";
      confirm.disabled = false;
    }
  };
  buttons.append(cancel, confirm);
  form.append(error, buttons);
  overlay.appendChild(form);
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !confirm.disabled) confirm.click();
    if (e.key === "Escape") overlay.remove();
  });
  document.body.appendChild(overlay);
  (fields.find((f) => !(f.input as HTMLInputElement).readOnly)?.input ?? confirm).focus();
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
        }),
      );
    },
    (form) => {
      const row = document.createElement("div");
      row.className = "checkbox-row";
      watchers = document.createElement("input");
      watchers.type = "checkbox";
      watchers.id = "af-allow-watchers";
      watchers.checked = true;
      const label = document.createElement("label");
      label.htmlFor = "af-allow-watchers";
      label.textContent = "Permettre les spectateurs";
      row.append(watchers, label);
      form.appendChild(row);
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

export function renderAirForceTab(container: HTMLDivElement): void {
  if (games.length > 0) {
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
    for (const game of games) {
      const row = document.createElement("tr");
      const codeCell = document.createElement("td");
      codeCell.textContent = game.code;
      codeCell.title = `${game.scenario_name}, ${game.planes_per_side} avion(s) par camp` +
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
        actionCell.appendChild(joinBtn);
      }
      if (game.allows_watchers) {
        const watchBtn = document.createElement("button");
        watchBtn.className = "watch-session-btn";
        watchBtn.textContent = "Spectateur";
        watchBtn.onclick = () => openJoinModal(game, "watcher");
        actionCell.appendChild(watchBtn);
      }
      row.append(codeCell, playersCell, actionCell);
      tbody.appendChild(row);
    }
    container.appendChild(table);
  } else {
    const empty = document.createElement("p");
    empty.textContent = "Aucune session active.";
    empty.style.color = "#888";
    container.appendChild(empty);
  }
  const createBtn = document.createElement("button");
  createBtn.textContent = "Create";
  createBtn.className = "create-game-btn";
  createBtn.onclick = openCreateModal;
  container.appendChild(createBtn);
}

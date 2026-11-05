// What a page shows of a maintenance of the site, announced by the
// administration of OBG (hautefort/maintenance.py, Tourtoirac/maintenance.py):
//
// - announced: a notice at the top of the page counts down to the start; one
//   minute before, a popup tells it once more;
// - started (event maintenance_started, or the socket closed with the code
//   MAINTENANCE_CLOSE_CODE): a screen covers the page until the server answers
//   again; the page keeps reconnecting and comes back to its game by itself;
// - none (sent by the server on every connection): nothing, the notices go away.
//
// Twin of Hautefort/front/common/maintenance.ts: keep both alike. Its styles are its
// own, so every page gets it without touching its stylesheet.

export const MAINTENANCE_CLOSE_CODE = 4012;

export interface MaintenanceState {
  phase: "none" | "announced" | "started";
  starts_at: string | null;
  duration_minutes: number;
  message: string;
}

/** "game": a game page (the game is interrupted); "lobby": the list of the games */
export type MaintenanceContext = "game" | "lobby";

// the popup comes that long before the start
const WARNING_BEFORE_MS = 60 * 1000;

let context: MaintenanceContext = "game";
let state: MaintenanceState | null = null;
let notice: HTMLElement | null = null;
let screen: HTMLElement | null = null;
let ticker: number | null = null;
let warned = false;

export function setMaintenanceContext(value: MaintenanceContext): void {
  context = value;
}

/**
 * A message of the server: true when it was about the maintenance (and taken
 * care of here).
 */
export function handleMaintenanceMessage(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const event = (data as { event?: unknown }).event;
  if (event === "maintenance") {
    apply(read(data));
    return true;
  }
  if (event === "maintenance_started") {
    apply({ ...read(data), phase: "started" });
    return true;
  }
  return false;
}

/** The socket was closed for a maintenance: the screen stays until the server answers again. */
export function maintenanceClosed(): void {
  apply({ ...(state ?? { starts_at: null, duration_minutes: 0, message: "" }), phase: "started" });
}

export function maintenanceInProgress(): boolean {
  return state?.phase === "started";
}

function read(data: object): MaintenanceState {
  const raw = data as Partial<MaintenanceState>;
  const phase = raw.phase === "announced" || raw.phase === "started" ? raw.phase : "none";
  return {
    phase,
    starts_at: typeof raw.starts_at === "string" ? raw.starts_at : null,
    duration_minutes: typeof raw.duration_minutes === "number" ? raw.duration_minutes : 0,
    message: typeof raw.message === "string" ? raw.message : "",
  };
}

function apply(next: MaintenanceState): void {
  const before = state;
  state = next;
  // a new announcement (another time) warns again
  if (next.phase !== "announced" || before?.starts_at !== next.starts_at) warned = false;
  if (next.phase === "announced") {
    hideScreen();
    showNotice();
    tick();
    if (ticker === null) ticker = window.setInterval(tick, 1000);
  } else if (next.phase === "started") {
    hideNotice();
    showScreen();
  } else {
    hideNotice();
    hideScreen();
  }
}

function startsAt(): number | null {
  const time = state?.starts_at ? Date.parse(state.starts_at) : NaN;
  return Number.isNaN(time) ? null : time;
}

function durationText(): string {
  const minutes = state?.duration_minutes ?? 0;
  if (minutes <= 0) return "quelques minutes";
  if (minutes < 60) return `environ ${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `environ ${hours} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

function countdownText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} min ${String(rest).padStart(2, "0")} s` : `${rest} s`;
}

function interruption(): string {
  return context === "game"
    ? `la partie sera interrompue ${durationText()}, puis reprendra là où elle en est.`
    : `les parties seront interrompues ${durationText()}, puis reprendront là où elles en sont. ` +
        "D'ici là, on ne peut plus créer de partie ni en rejoindre une, sauf pour reprendre sa place.";
}

function tick(): void {
  if (state?.phase !== "announced") return;
  const start = startsAt();
  const left = start === null ? 0 : start - Date.now();
  const text = notice?.querySelector<HTMLElement>(".obg-maintenance-text");
  if (text) {
    text.textContent = left > 0
      ? `Maintenance du site dans ${countdownText(left)} : ${interruption()}`
      : `Maintenance du site imminente : ${interruption()}`;
  }
  if (!warned && left > 0 && left <= WARNING_BEFORE_MS) {
    warned = true;
    popup(
      context === "game"
        ? `La partie va être interrompue dans moins d'une minute pour une maintenance du site (${durationText()}). ` +
            "Elle est sauvegardée et reprendra automatiquement là où elle en est : vous pouvez laisser cette page ouverte."
        : `Maintenance du site dans moins d'une minute (${durationText()}).`,
    );
  }
}

function showNotice(): void {
  installStyles();
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "obg-maintenance-notice";
    notice.setAttribute("role", "status");
    const text = document.createElement("p");
    text.className = "obg-maintenance-text";
    const message = document.createElement("p");
    message.className = "obg-maintenance-message";
    notice.append(text, message);
    document.body.append(notice);
  }
  const message = notice.querySelector<HTMLElement>(".obg-maintenance-message");
  if (message) {
    message.textContent = state?.message ?? "";
    message.hidden = !state?.message;
  }
}

function hideNotice(): void {
  notice?.remove();
  notice = null;
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

function endText(): string {
  const start = startsAt();
  const minutes = state?.duration_minutes ?? 0;
  if (start === null || minutes <= 0) return "";
  const end = new Date(start + minutes * 60 * 1000);
  return ` Fin prévue vers ${end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`;
}

function showScreen(): void {
  installStyles();
  screen?.remove();
  screen = document.createElement("div");
  screen.className = "obg-maintenance-screen";
  const box = document.createElement("div");
  box.className = "obg-maintenance-box";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const title = document.createElement("h2");
  title.textContent = "Maintenance du site en cours";
  const text = document.createElement("p");
  text.textContent = (context === "game"
    ? "La partie est sauvegardée et reprendra automatiquement dès la fin de la maintenance : " +
      "vous pouvez laisser cette page ouverte."
    : "Les parties reprendront dès la fin de la maintenance : cette page se reconnectera toute seule.") + endText();
  box.append(title, text);
  if (state?.message) {
    const message = document.createElement("p");
    message.className = "obg-maintenance-message";
    message.textContent = state.message;
    box.append(message);
  }
  screen.append(box);
  document.body.append(screen);
}

function hideScreen(): void {
  screen?.remove();
  screen = null;
}

function popup(message: string): void {
  installStyles();
  const overlay = document.createElement("div");
  overlay.className = "obg-maintenance-screen";
  const box = document.createElement("div");
  box.className = "obg-maintenance-box";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const text = document.createElement("p");
  text.textContent = message;
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "OK";
  ok.addEventListener("click", () => overlay.remove());
  box.append(text, ok);
  overlay.append(box);
  document.body.append(overlay);
}

function installStyles(): void {
  if (document.getElementById("obg-maintenance-styles")) return;
  const style = document.createElement("style");
  style.id = "obg-maintenance-styles";
  style.textContent = `
    .obg-maintenance-notice {
      position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 9000;
      max-width: min(680px, calc(100vw - 16px)); padding: 8px 14px; border-radius: 6px;
      background: #f59e0b; color: #1f1300; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
      font: 14px/1.35 system-ui, sans-serif; text-align: center;
      /* the page stays usable under it */
      pointer-events: none;
    }
    .obg-maintenance-notice p { margin: 0; }
    .obg-maintenance-notice .obg-maintenance-message { margin-top: 4px; font-style: italic; }
    .obg-maintenance-screen {
      position: fixed; inset: 0; z-index: 9500; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.6);
    }
    .obg-maintenance-box {
      max-width: min(460px, calc(100vw - 32px)); padding: 20px 24px; border-radius: 8px;
      background: #fff; color: #222; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
      font: 15px/1.45 system-ui, sans-serif; text-align: center;
    }
    .obg-maintenance-box h2 { margin: 0 0 10px; font-size: 18px; color: #b45309; }
    .obg-maintenance-box p { margin: 0 0 10px; }
    .obg-maintenance-box .obg-maintenance-message { font-style: italic; }
    .obg-maintenance-box button { padding: 4px 18px; font: inherit; cursor: pointer; }
  `;
  document.head.append(style);
}

// Disconnects a player who does nothing in the game for too long.
//
// After IDLE_WARNING_MS without activity a popup asks whether the player is
// still there; its OK button counts as an activity. Left unanswered for
// IDLE_DISCONNECT_MS, the player is disconnected.
//
// A watcher is only watched while alone in the game, with no player connected:
// the tab then only keeps the game loaded on the server, so a forgotten one is
// let go after WATCHER_IDLE_WARNING_MS. A watcher next to players costs
// nothing more and is never disconnected.
//
// Only what happens while the game tab has the focus counts: a player busy
// in another tab or window is idle, even if the mouse crosses the game.

export const IDLE_WARNING_MS = 5 * 60 * 1000;
export const WATCHER_IDLE_WARNING_MS = 60 * 60 * 1000;
export const IDLE_DISCONNECT_MS = 60 * 1000;

// Timers of a background tab are slowed down by the browser: the deadlines
// are compared with the clock, the interval only decides how often.
const CHECK_INTERVAL_MS = 1000;

function warningMessage(delay: number): string {
  const minutes = Math.round(delay / 60000);
  const since = minutes % 60 === 0 ? `${minutes / 60} heure${minutes > 60 ? "s" : ""}` : `${minutes} minutes`;
  return `Pas d'activités dans le jeu depuis ${since}`;
}

export interface IdleWatchOptions {
  /** where moving the mouse counts as an activity: the map */
  readonly moveTarget: HTMLElement;
  /** how long without activity before the popup: IDLE_WARNING_MS for a
   * player, WATCHER_IDLE_WARNING_MS for a watcher alone; null while nobody
   * needs to be watched (a watcher next to players, a game not started or closed) */
  readonly warningDelay: () => number | null;
  /** called once, when the popup was left unanswered */
  readonly onDisconnect: () => void;
}

function tabHasFocus(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function createPopup(onOk: () => void): { overlay: HTMLElement; text: HTMLParagraphElement } {
  const overlay = document.createElement("div");
  overlay.className = "idle-overlay";
  overlay.hidden = true;
  const box = document.createElement("div");
  box.className = "idle-box";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const text = document.createElement("p");
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "OK";
  ok.addEventListener("click", onOk);
  box.append(text, ok);
  overlay.append(box);
  document.body.append(overlay);
  return { overlay, text };
}

export function startIdleWatch(options: IdleWatchOptions): void {
  let lastActivity = Date.now();
  // when the popup was shown; null while it is hidden
  let warnedAt: number | null = null;
  let disconnected = false;

  const { overlay: popup, text: popupText } = createPopup(() => {
    // the answer to the popup is an activity: everything starts again
    popup.hidden = true;
    warnedAt = null;
    lastActivity = Date.now();
  });

  function activity(): void {
    // once the popup is up, only its button proves the player is there
    if (disconnected || warnedAt !== null || !tabHasFocus()) return;
    lastActivity = Date.now();
  }

  options.moveTarget.addEventListener("mousemove", activity);
  window.addEventListener("pointerdown", activity, true);
  window.addEventListener("keydown", activity, true);
  window.addEventListener("wheel", activity, { capture: true, passive: true });

  const timer = window.setInterval(() => {
    const now = Date.now();
    const delay = options.warningDelay();
    if (delay === null) {
      // a watcher next to players or a closed game: nothing to count, the popup goes away
      popup.hidden = true;
      warnedAt = null;
      lastActivity = now;
      return;
    }
    if (warnedAt === null) {
      if (now - lastActivity >= delay) {
        warnedAt = now;
        popupText.textContent = warningMessage(delay);
        popup.hidden = false;
      }
      return;
    }
    if (now - warnedAt >= IDLE_DISCONNECT_MS) {
      disconnected = true;
      popup.hidden = true;
      window.clearInterval(timer);
      options.onDisconnect();
    }
  }, CHECK_INTERVAL_MS);
}

/**
 * The popup left once the player was disconnected: the game stays shown,
 * frozen, until the player goes back into it or to the lobby.
 */
export function showDisconnectedPopup(onResume: () => void, onLobby: () => void): void {
  const overlay = document.createElement("div");
  overlay.className = "idle-overlay";
  const box = document.createElement("div");
  box.className = "idle-box";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  const text = document.createElement("p");
  text.textContent = "Tu as été déconnecté de la partie pour inactivité.";
  const resume = document.createElement("button");
  resume.type = "button";
  resume.textContent = "Revenir dans la partie";
  resume.addEventListener("click", onResume);
  const lobby = document.createElement("button");
  lobby.type = "button";
  lobby.textContent = "Retour au lobby";
  lobby.addEventListener("click", onLobby);
  box.append(text, resume, lobby);
  overlay.append(box);
  document.body.append(overlay);
}

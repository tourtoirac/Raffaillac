// "Copier l'état (debug)" in the banner of the game page, on a development
// machine only (the page opened on localhost): asks Tourtoirac for the
// game_json the session would store if every player left at once (action
// debug_state, answered only when the server runs with OBG_DEBUG_STATE=1),
// hidden information included, and copies it, so the situation of a bug can
// be handed over. The Hautefort game pages have the same button
// (Hautefort front/common/debugState.ts).

const LABEL = "Copier l'état (debug)";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// the answer of the server, waited for that long at most
const ANSWER_TIMEOUT_MS = 5000;

export function isLocalhost(): boolean {
  return LOCAL_HOSTS.has(window.location.hostname);
}

let button: HTMLButtonElement | null = null;
let waiting: number | null = null;

/** wires the button and shows it on localhost only; `ask` sends the debug_state action, false when there is no socket */
export function bindDebugState(target: HTMLButtonElement, ask: () => boolean): void {
  if (!isLocalhost()) return;
  button = target;
  button.hidden = false;
  button.textContent = LABEL;
  button.title = "Copie le game_json qui serait sauvegardé si tous les joueurs partaient maintenant (mains et informations cachées comprises)";
  button.onclick = () => {
    if (!ask()) {
      flash("Pas de connexion au serveur");
      return;
    }
    if (waiting !== null) window.clearTimeout(waiting);
    waiting = window.setTimeout(() => {
      waiting = null;
      flash("Pas de réponse (OBG_DEBUG_STATE=1 ?)");
    }, ANSWER_TIMEOUT_MS);
  };
}

/** the debug_state event of the server: its content is copied */
export async function receiveDebugState(content: unknown): Promise<void> {
  if (waiting === null) return;           // not asked by this page: nothing to copy
  window.clearTimeout(waiting);
  waiting = null;
  const text = JSON.stringify(content, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copiez l'état de la partie :", text);
    return;
  }
  flash("État copié ✓");
}

// the errors the debug_state action answers with (unknown_action: OBG_DEBUG_STATE not set)
const REFUSALS = ["unknown_action", "unknown_user", "no_session"];

/** an error of the server while an answer is awaited: true when it is the refusal of debug_state */
export function debugStateRefused(code: string | undefined): boolean {
  if (waiting === null || !code || !REFUSALS.includes(code)) return false;
  window.clearTimeout(waiting);
  waiting = null;
  flash(code === "unknown_action" ? "Refusé : OBG_DEBUG_STATE=1 absent" : `Refusé : ${code}`);
  return true;
}

function flash(text: string): void {
  if (!button) return;
  const target = button;
  target.textContent = text;
  window.setTimeout(() => (target.textContent = LABEL), 2500);
}

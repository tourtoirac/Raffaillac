import type { Session } from "./types";

const SESSION_KEY = "obg_session";
const PLAYER_IDENTITY_KEY = "obg_player_identity";

export interface PlayerIdentity {
  name: string;
  // admin: the administration of OBG watching the game (Chabanas /manage/ pages)
  role: "player" | "watcher" | "admin";
}

// the nickname of the administration of OBG watching a game
export const ADMIN_NICKNAME = "Administrateur";

export function storeSession(session: Session): void {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
  window.sessionStorage.removeItem(PLAYER_IDENTITY_KEY);
}

// la page de jeu ouvre sa propre connexion : elle doit pouvoir se réidentifier
export function storePlayerIdentity(name: string, role: PlayerIdentity["role"]): void {
  const identity: PlayerIdentity = { name, role };
  window.sessionStorage.setItem(PLAYER_IDENTITY_KEY, JSON.stringify(identity));
}

export function loadPlayerIdentity(): PlayerIdentity | null {
  const raw = window.sessionStorage.getItem(PLAYER_IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
    if (!parsed.name) return null;
    const role = parsed.role === "watcher" || parsed.role === "admin" ? parsed.role : "player";
    return { name: parsed.name, role };
  } catch {
    return null;
  }
}
/**
 * The administration of OBG opens the game page with the session to watch in
 * the fragment (#admin={"key", "code"}), never sent to a server: the page then
 * resumes it as an administrator, a watcher no game refuses. The fragment is
 * taken out of the address bar.
 */
export function adoptAdminSession(): void {
  const raw = new URLSearchParams(window.location.hash.slice(1)).get("admin");
  if (!raw) return;
  try {
    const session = JSON.parse(raw) as Partial<Session>;
    if (session.key) {
      storeSession({ key: session.key, code: session.code });
      storePlayerIdentity(ADMIN_NICKNAME, "admin");
    }
  } catch {
    // a broken link: the page has no session to resume
  }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

import type { Session } from "./types";

const SESSION_KEY = "obg_session";
const PLAYER_IDENTITY_KEY = "obg_player_identity";

export interface PlayerIdentity {
  name: string;
  role: "player" | "watcher";
}

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
    return { name: parsed.name, role: parsed.role === "watcher" ? "watcher" : "player" };
  } catch {
    return null;
  }
}
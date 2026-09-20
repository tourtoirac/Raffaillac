import type { Session } from "./types";

const SESSION_KEY = "obg_session";

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
}
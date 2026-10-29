// Games in prototyping. An administrator gives a game a key (Chabanas admin
// for an OBG table game, /manage/refereed/ for a refereed game): the lobby
// still shows its tab, locked, and asks for the key before showing its games.
// The key the server accepted is kept for the visit only (sessionStorage), and
// sent again with every creation and every join: the server checks it each
// time, the lock of the tab is only a convenience.

const KEYS_STORAGE = "obg_prototype_keys";

// the refereed services (by URL) whose lobby says they are in prototyping
const privateServices = new Set<string>();

function readKeys(): Record<string, string> {
  try {
    const keys = JSON.parse(window.sessionStorage.getItem(KEYS_STORAGE) ?? "{}") as unknown;
    return keys && typeof keys === "object" ? (keys as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeKeys(keys: Record<string, string>): void {
  try {
    window.sessionStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // storage refused: the key is asked again on the next page
  }
}

/** the key accepted for that game during this visit; empty when none */
export function prototypeKey(id: string): string {
  return readKeys()[id] ?? "";
}

export function storePrototypeKey(id: string, key: string): void {
  writeKeys({ ...readKeys(), [id]: key });
}

/** the server refused the key kept (it changed): the tab locks again */
export function forgetPrototypeKey(id: string): void {
  const keys = readKeys();
  delete keys[id];
  writeKeys(keys);
}

/** what the lobby of a refereed service says of it */
export function setServicePrivate(base: URL, isPrivate: boolean): void {
  if (isPrivate) privateServices.add(base.href);
  else privateServices.delete(base.href);
}

/** a refereed service in prototyping */
export function servicePrivate(base: URL): boolean {
  return privateServices.has(base.href);
}

/** a refereed service in prototyping whose key was not given yet */
export function serviceLocked(base: URL): boolean {
  return servicePrivate(base) && !prototypeKey(base.href);
}

/** the header that carries the key of a refereed service, when one was given */
export function prototypeHeaders(base: URL): Record<string, string> {
  const key = prototypeKey(base.href);
  return key ? { "X-Hautefort-Prototype-Key": key } : {};
}

/** asks a refereed service whether that key opens it; kept when it does */
export async function unlockService(base: URL, key: string): Promise<boolean> {
  const response = await fetch(new URL("api/unlock", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prototype_key: key }),
  });
  if (!response.ok) return false;
  storePrototypeKey(base.href, key);
  return true;
}

export const LOCKED_MARK = "🔒 ";
export const WRONG_KEY_MESSAGE = "Clé de prototype refusée.";

/**
 * The content of a locked tab: why it is locked, and a field for the key.
 * `unlock` returns the error to show, or null once the tab is open.
 */
export function renderLockedTab(
  container: HTMLDivElement,
  label: string,
  unlock: (key: string) => Promise<string | null>,
): void {
  const panel = document.createElement("div");
  panel.className = "prototype-lock";
  const text = document.createElement("p");
  text.textContent = `${label} est en prototypage : son accès est réservé. Saisissez la clé qui vous a été donnée.`;
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "Clé de prototype";
  input.autocomplete = "off";
  const button = document.createElement("button");
  button.className = "create-game-btn";
  button.textContent = "Déverrouiller";
  const error = document.createElement("div");
  error.className = "prototype-lock-error";
  const submit = async (): Promise<void> => {
    const key = input.value.trim();
    if (!key) return;
    button.disabled = true;
    error.textContent = "";
    try {
      const refused = await unlock(key);
      if (refused) error.textContent = refused;
    } catch {
      error.textContent = "Le serveur ne répond pas.";
    } finally {
      button.disabled = false;
    }
  };
  button.onclick = () => void submit();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit();
  });
  const row = document.createElement("div");
  row.className = "prototype-lock-row";
  row.append(input, button);
  panel.append(text, row, error);
  container.appendChild(panel);
}

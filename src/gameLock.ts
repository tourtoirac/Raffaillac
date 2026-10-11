// One game at a time per browser. Every tab of the origin shares the single
// WebSocket of the SharedWorker (ws/wsWorker.ts): for the server, two tabs are
// one connection, so a second game page would take over the seat of the first
// and both would receive each other's events.
//
// The guard is a Web Lock held by the game page for as long as it lives. The
// browser releases it by itself when the tab is closed, reloaded or crashes,
// so nothing can stay locked by mistake.

const LOCK_NAME = "obg_game";

// A reload hands the lock from the old document to the new one: the release
// can come a moment after the new page starts.
const RETRY_DELAY_MS = 150;
const RETRIES = 10;

export const GAME_OPEN_ELSEWHERE_MESSAGE =
  "Une partie est déjà ouverte dans un autre onglet de ce navigateur.\n\n" +
  "Ferme-la ou quitte-la avant d'en ouvrir une autre.";

// Web Locks need a secure context (https or localhost). Without them the guard
// is simply off, as before.
function locks(): LockManager | null {
  return typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
}

function tryAcquire(manager: LockManager): Promise<boolean> {
  return new Promise((resolve) => {
    void manager.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(false);
        return undefined;
      }
      resolve(true);
      // never settles: the lock is held until the page goes away
      return new Promise<void>(() => {});
    });
  });
}

// Called by the game page. True when this page now holds the lock.
export async function acquireGameLock(): Promise<boolean> {
  const manager = locks();
  if (manager === null) return true;

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    if (await tryAcquire(manager)) return true;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return false;
}

// Called by the lobby before it creates or joins a session.
export async function isGameOpenElsewhere(): Promise<boolean> {
  const manager = locks();
  if (manager === null) return false;
  const state = await manager.query();
  return (state.held ?? []).some((lock) => lock.name === LOCK_NAME);
}

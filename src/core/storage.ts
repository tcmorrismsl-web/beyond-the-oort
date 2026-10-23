/**
 * The only module allowed to touch browser storage. Safari can throw on
 * access (private browsing, blocked site data, quota), so every call is
 * guarded and returns a result instead of crashing the game.
 */
export type StorageResult = { ok: true } | { ok: false; reason: string };

export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn('storage read failed', key, err);
    return null;
  }
}

export function writeKey(key: string, value: string): StorageResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('storage remove failed', key, err);
  }
}

/**
 * Ask the browser not to evict our data under storage pressure. Safari may
 * clear script-written storage for sites not used in a while unless the game
 * is installed to the Home Screen, so we ask, and the game also offers a
 * save export.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

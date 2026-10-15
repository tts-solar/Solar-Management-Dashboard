import type { KV } from './store'

/**
 * A tiny, zero-dependency IndexedDB key/value backend, plus a synchronous facade over an
 * in-memory cache. localStorage caps at ~5-10 MB (a few plants × a few years fills it);
 * IndexedDB gives hundreds of MB. IndexedDB is async, but the whole app reads storage
 * synchronously at boot, so we preload the scope into a Map and keep the old sync KV shape:
 * reads hit the cache, writes update the cache AND fire an async write-behind to IndexedDB.
 * Every call resolves (never throws) — the caller falls back to localStorage when IDB is
 * absent or blocked (e.g. Firefox on file://), so the offline file never regresses.
 */

const DB_NAME = 'solar-dashboard'
const STORE = 'kv'

/** Open the KV database. Resolves null on absence / block / error so the caller can fall back. */
export function idbOpen(name = DB_NAME, store = STORE): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let idb: IDBFactory | null
    try {
      idb = globalThis.indexedDB ?? null
    } catch {
      return resolve(null) // access itself can throw under strict file:// policies
    }
    if (!idb) return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = idb.open(name, 1)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

/** Read every entry into a Map keyed by the full (suffixed) key. Resolves an empty Map on error. */
export function idbGetAll(db: IDBDatabase, store = STORE): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const out = new Map<string, string>()
    let tx: IDBTransaction
    try {
      tx = db.transaction(store, 'readonly')
    } catch {
      return resolve(out)
    }
    const os = tx.objectStore(store)
    const keysReq = os.getAllKeys()
    const valsReq = os.getAll()
    tx.oncomplete = () => {
      const keys = keysReq.result
      const vals = valsReq.result
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        const v = vals[i]
        if (typeof k === 'string' && typeof v === 'string') out.set(k, v)
      }
      resolve(out)
    }
    tx.onerror = () => resolve(out)
    tx.onabort = () => resolve(out)
  })
}

/** Write-behind put (fire-and-forget). Quota/closed errors are swallowed — the storage meter warns instead. */
export function idbPut(db: IDBDatabase, key: string, value: string, store = STORE): void {
  try {
    db.transaction(store, 'readwrite').objectStore(store).put(value, key)
  } catch {
    // ignore: quota full or db closed — A3's storage meter is the user-facing signal
  }
}

/** Write-behind delete (fire-and-forget). */
export function idbDel(db: IDBDatabase, key: string, store = STORE): void {
  try {
    db.transaction(store, 'readwrite').objectStore(store).delete(key)
  } catch {
    // ignore
  }
}

/**
 * A synchronous KV facade over an in-memory cache, with every key suffixed (same per-file scoping
 * as scopedStorage). Reads return the cached value; writes update the cache and fire the backend's
 * async write-behind, so the long-standing sync KV contract holds on top of async IndexedDB.
 */
export function memKv(
  suffix: string,
  cache: Map<string, string>,
  backend: { put(k: string, v: string): void; del(k: string): void },
): KV {
  return {
    getItem: (k) => cache.get(k + suffix) ?? null,
    setItem: (k, v) => {
      cache.set(k + suffix, v)
      backend.put(k + suffix, v)
    },
    removeItem: (k) => {
      cache.delete(k + suffix)
      backend.del(k + suffix)
    },
  }
}

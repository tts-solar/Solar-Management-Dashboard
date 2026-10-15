import { describe, expect, it } from 'vitest'
import { memKv } from './idb'

/** Record the write-behind calls so we can assert the facade flushes to the backend. */
function fakeBackend() {
  const puts: Array<[string, string]> = []
  const dels: string[] = []
  return {
    puts,
    dels,
    put: (k: string, v: string) => void puts.push([k, v]),
    del: (k: string) => void dels.push(k),
  }
}

describe('memKv — sync facade over an in-memory cache + async write-behind', () => {
  it('setItem updates the cache and fires a suffixed write-behind; getItem reads it back', () => {
    const cache = new Map<string, string>()
    const backend = fakeBackend()
    const kv = memKv(':/a.html', cache, backend)

    kv.setItem('solar-dashboard:plants:v1', '[1]')
    expect(kv.getItem('solar-dashboard:plants:v1')).toBe('[1]')
    expect(cache.get('solar-dashboard:plants:v1:/a.html')).toBe('[1]') // stored suffixed
    expect(backend.puts).toEqual([['solar-dashboard:plants:v1:/a.html', '[1]']])
  })

  it('getItem returns null for a key that was never set', () => {
    const kv = memKv(':/a.html', new Map(), fakeBackend())
    expect(kv.getItem('missing')).toBeNull()
  })

  it('removeItem clears the cache and fires a suffixed delete', () => {
    const cache = new Map<string, string>()
    const backend = fakeBackend()
    const kv = memKv(':/a.html', cache, backend)
    kv.setItem('k', 'v')
    kv.removeItem?.('k')
    expect(kv.getItem('k')).toBeNull()
    expect(cache.has('k:/a.html')).toBe(false)
    expect(backend.dels).toEqual(['k:/a.html'])
  })

  it('two scopes over separate caches do not cross-see (per-file isolation preserved)', () => {
    const a = memKv(':/a.html', new Map(), fakeBackend())
    const b = memKv(':/b.html', new Map(), fakeBackend())
    a.setItem('k', 'from-a')
    expect(a.getItem('k')).toBe('from-a')
    expect(b.getItem('k')).toBeNull() // b cannot see a's data
  })

  it('a shared cache keeps scopes apart by suffix (one IndexedDB store, many files)', () => {
    const shared = new Map<string, string>()
    const a = memKv(':/a.html', shared, fakeBackend())
    const b = memKv(':/b.html', shared, fakeBackend())
    a.setItem('k', 'from-a')
    b.setItem('k', 'from-b')
    expect(a.getItem('k')).toBe('from-a')
    expect(b.getItem('k')).toBe('from-b')
  })
})

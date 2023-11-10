import { isOlderThan } from './util.js'

export interface AsyncCache<T> {
  /**
   * TTL in seconds for cached values.
   */
  readonly ttlSeconds: number
  has(key: string): boolean
  get(key: string): Promise<T> | undefined
  set(key: string, value: Promise<T>): Promise<T>
  delete(key: string): boolean
  /**
   * Release memory from dead values.
   */
  release(): void
}

interface CacheItem<T> {
  date: number
  promise: Promise<T>
}

export function createAsyncCache<T>(ttlSeconds: number): AsyncCache<T> {
  const expired = (date: number) => isOlderThan(date, ttlSeconds)
  const map = new Map<string, CacheItem<T>>()

  const getValue = (key: string) => {
    const item = map.get(key)
    if (item) {
      if (expired(item.date)) {
        map.delete(key)
      } else {
        return item.promise
      }
    }
  }

  return {
    ttlSeconds,
    has: key => {
      return getValue(key) !== undefined
    },
    get: getValue,
    set: (key, value) => {
      const promise = value.catch(err => {
        // Do not cache rejections
        map.delete(key)
        return Promise.reject(err)
      })

      map.set(key, {
        date: Date.now(),
        promise,
      })

      return promise
    },
    delete: key => {
      const item = map.get(key)
      map.delete(key)
      return item ? !expired(item.date) : false
    },
    release: () => {
      for (const [key, value] of map) {
        if (expired(value.date)) {
          map.delete(key)
        }
      }
    },
  }
}

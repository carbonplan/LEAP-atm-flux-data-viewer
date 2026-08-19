import type { IcechunkStore } from 'icechunk-js'
import { STORE_URL } from '@/lib/config'
import { openIcechunkStore } from '@/lib/store-schema'

// One store per URL for the lifetime of the page. React 18+ mounts effects
// twice in dev, and opening the store twice would double every metadata fetch.
let cached: { url: string; promise: Promise<IcechunkStore> } | null = null

export function getStore(url: string = STORE_URL): Promise<IcechunkStore> {
  if (!url) return Promise.reject(new Error('No icechunk URL configured'))
  if (cached?.url === url) return cached.promise

  const promise = openIcechunkStore(url).catch((err) => {
    // Let a later mount retry rather than caching the failure forever.
    if (cached?.url === url) cached = null
    throw err
  })
  cached = { url, promise }
  return promise
}

/** Browser-blocked fetches surface as opaque network errors; say what happened. */
export function describeStoreError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err)
  if (/NetworkError|Failed to fetch|CORS/i.test(msg)) {
    return `Could not read the store from the browser. The bucket is most likely missing a CORS configuration that allows this origin and exposes range requests. (${msg})`
  }
  return msg
}

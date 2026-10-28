// Service worker: keeps the app shell and the last-loaded data so the app opens with no signal.
// The build (vite.config.ts) fills in SHELL, the built files, and VERSION, a hash of them.
// Writes are never cached: ticking and other changes need signal (full offline ticking is M2).

const SHELL = self.__SHELL__
const VERSION = self.__VERSION__
const SHELL_CACHE = `wfd-shell-${VERSION}`
/** Supabase reads (the week, list and recipes), newest copy of each. Cleared on sign-out by the app. */
const DATA_CACHE = 'wfd-data'
const FONT_CACHE = 'wfd-fonts'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wfd-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    // The page itself: fresh when online so updates arrive, the cached shell when not.
    event.respondWith(networkFirst(req, SHELL_CACHE, './'))
  } else if (url.origin === self.location.origin) {
    // Built files have hashed names, so a cached copy is never stale.
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)))
  } else if (url.pathname.includes('/rest/v1/')) {
    event.respondWith(networkFirst(req, DATA_CACHE))
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetchAndKeep(req, FONT_CACHE)))
  }
})

/** Fetches and keeps a copy of a good response. */
async function fetchAndKeep(req, cacheName, key = req) {
  const res = await fetch(req)
  if (res.ok) {
    const cache = await caches.open(cacheName)
    await cache.put(key, res.clone())
  }
  return res
}

/**
 * The network's answer, or the last good one when there is no signal. Matching ignores
 * headers (Supabase varies on them) so a read made with an older login token still matches.
 */
async function networkFirst(req, cacheName, key = req) {
  try {
    return await fetchAndKeep(req, cacheName, key)
  } catch (e) {
    const hit = await caches.match(key, { cacheName, ignoreVary: true })
    if (hit) return hit
    throw e
  }
}

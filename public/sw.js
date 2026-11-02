// Offline support for the parking pass.
//
// The pass QR is drawn in the browser from the booking, so what a driver
// needs underground is (1) the app itself and (2) their bookings list. This
// worker keeps exactly those and nothing else:
//
//   - the app shell and its hashed /assets files (cache-first)
//   - GET /api/bookings (network-first, falling back to the last copy)
//
// Every other request passes straight through to the network untouched.
//
// The bookings copy is per-person data, so the app deletes API_CACHE on
// sign-in and sign-out (see src/api.ts). Bump SHELL_VERSION to retire old
// shell caches on a release.

const SHELL_VERSION = "v1";
const SHELL_CACHE = `ps-shell-${SHELL_VERSION}`;
const API_CACHE = "ps-api-v1";

const SHELL_URL = "/";
const BOOKINGS_PATH = "/api/bookings";
// A weak signal can hang a request for a long time; after this the saved
// copy is used instead of waiting.
const NETWORK_TIMEOUT_MS = 4000;

const withTimeout = (request) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const res = await fetch(SHELL_URL, { cache: "reload" });
    const html = await res.clone().text();
    await cache.put(SHELL_URL, res);
    // The shell is useless without the files it points at.
    const assets = [...new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? [])];
    await Promise.all(assets.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("ps-shell-") && n !== SHELL_CACHE)
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

const navigation = async (request) => {
  try {
    return await withTimeout(request);
  } catch {
    const cached = await caches.match(SHELL_URL);
    if (cached) return cached;
    throw new Error("offline and no saved copy of the app");
  }
};

const asset = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(request, res.clone());
  }
  return res;
};

const bookings = async (request) => {
  const cache = await caches.open(API_CACHE);
  // Keyed by URL only, so the response is partitioned by nothing else;
  // that is safe only because the app clears the cache on every sign-in
  // and sign-out.
  try {
    const res = await withTimeout(request);
    if (res.ok) await cache.put(BOOKINGS_PATH, res.clone());
    return res;
  } catch {
    const saved = await cache.match(BOOKINGS_PATH);
    if (!saved) throw new Error("offline and no saved bookings");
    // Marked so the app can say the list may be out of date.
    const headers = new Headers(saved.headers);
    headers.set("X-Offline-Cache", "1");
    return new Response(saved.body, { status: 200, headers });
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(asset(request));
  } else if (url.pathname === BOOKINGS_PATH) {
    event.respondWith(bookings(request));
  }
});

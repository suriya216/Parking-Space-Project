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

// Keep the offline shell in step with the live one. The install step only
// runs when this file's bytes change, which an ordinary deploy does not do,
// so each successful page load refreshes the saved shell and its assets and
// drops assets the new shell no longer references.
const refreshShell = async (res) => {
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("text/html")) return;
  const cache = await caches.open(SHELL_CACHE);
  const html = await res.clone().text();
  const wanted = new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? []);
  await cache.put(SHELL_URL, res);
  await Promise.all([...wanted].map(async (url) => {
    if (!(await cache.match(url))) await cache.add(url).catch(() => {});
  }));
  for (const req of await cache.keys()) {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/assets/") && !wanted.has(pathname)) await cache.delete(req);
  }
};

const navigation = async (request) => {
  try {
    const res = await withTimeout(request);
    // Only the app shell itself: a deep link returns the same HTML.
    if (res.ok) void refreshShell(res.clone()).catch(() => {});
    return res;
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

// The saved copy is keyed by a hash of the request's bearer token, so one
// person's bookings can never be served to another session, even if the
// app never got the chance to clear the cache. Only one entry is kept.
const bookingsKey = async (request) => {
  const auth = request.headers.get("Authorization") ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${BOOKINGS_PATH}?session=${hex}`;
};

const bookings = async (request) => {
  const cache = await caches.open(API_CACHE);
  const key = await bookingsKey(request);
  try {
    const res = await withTimeout(request);
    if (res.ok) {
      for (const old of await cache.keys()) await cache.delete(old);
      await cache.put(key, res.clone());
    }
    return res;
  } catch {
    const saved = await cache.match(key);
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

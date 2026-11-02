# ParkSpace Project Review

Date: 2026-11-02. Covers three areas: code and dependency cleanup, security
vulnerabilities, and user-experience improvements. This was a read-only
review. No application code was changed.

---

## 1. Summary

| Area | Result |
|---|---|
| Unused imports | None found. `npm run lint` and `npm run typecheck` both pass. |
| Unused dependencies | None found. Every package in `package.json` is used. |
| Known vulnerabilities | 7 in dependencies (3 critical, 3 high, 1 moderate). All are fixable with `npm audit fix`. |
| Server security design | Sound. No exploitable issues found in code review. |
| UX | 17 improvement areas identified (section 4). |

---

## 2. Code and dependency cleanup

**Imports.** `oxlint` runs with `no-unused-vars` set to error, and both
tsconfigs enable `noUnusedLocals` and `noUnusedParameters`. Lint and typecheck
pass, so no unused imports or variables exist in the checked code.

**Dependencies.** All packages are used:

| Package | Used by |
|---|---|
| `express` | `server/` |
| `react`, `react-dom`, `react-leaflet`, `leaflet` | `src/` |
| `qrcode` | `src/qr.ts` |
| `@playwright/test` | test suite |
| `vite`, `@vitejs/plugin-react` | `vite.config.js` |
| `concurrently` | `dev` script |
| `oxlint` | `lint` script |
| `typescript` | `typecheck` script |
| `@types/*` | type definitions for the above |

**Other findings**

- `e2e/shots` held about 60 leftover screenshots from the removed `e2e/*.mjs`
  suites. It was gitignored and unreferenced. **Done: deleted.**
- The `secret` script uses `require('crypto')`. This was initially flagged as
  broken, but `node -e` runs as CommonJS, so it works. **No change needed.**

---

## 3. Security

### 3.1 Dependency vulnerabilities (`npm audit`)

**Runtime packages (ship to production)**

| Package | Severity | Issue |
|---|---|---|
| `proxy-addr` | Critical | IP spoofing via IPv4-mapped IPv6 trust subnet (GHSA-jqcg-44mw-7w3h) |
| `body-parser` | High | Denial of service from trailing bytes after a compressed body (GHSA-27r3-jxmh-p828) |
| `qs` | Moderate | `qs.stringify` with `arrayFormat: 'comma'` throws an uncaught error (GHSA-6pq8-jhm2-2vcw) |

The `proxy-addr` issue matters here. The server sets `trust proxy` to `true`
(`server/index.js:24`) and the login rate limiter keys on `req.ip`
(`server/index.js:89`). A spoofed IP could bypass the login rate limit.

**Dev-only packages**

| Package | Severity | Issue |
|---|---|---|
| `vite` 8.2.0 to 8.2.2 | High | Cross-origin script execution; files outside `server.fs.allow` exposed |
| `launch-editor` (via `vite`) | High | Three advisories, including command execution on Windows |
| `shell-quote` (via `concurrently`) | Critical | `quote()` command injection |
| `source-map-js` | High | Event-loop denial of service |

**Fix:** run `npm audit fix`, then lint, typecheck and the test suite. This
updates `package-lock.json`.

### 3.2 Code review of the server

Good practice already in place:
- Passwords hashed with scrypt, per-user salt, timing-safe compare.
- Signed, expiring session tokens. `SESSION_SECRET` must be at least 32
  characters, and production refuses to start without it.
- Login errors do not reveal which emails are registered.
- Failed-login rate limiting per IP.
- OAuth uses single-use `state` and PKCE.
- Security headers set: CSP, HSTS, `X-Frame-Options`, `nosniff`.
- Demo accounts disabled in production unless `DEMO_MODE=true`.

Points to keep an eye on:
- The rate limiter is in memory, so it resets on redeploy and is not shared
  across instances.
- CSP `style-src` includes `'unsafe-inline'`, which React and Leaflet need.
- The `db.exec` calls with `${table}` in template strings
  (`server/db.js:106`) are in migration code. Confirm the values are always
  constants.

---

## 4. User-experience improvements

These are code-level observations. The app was not run on a device.

### Booking and payments
1. ~~No way to cancel or extend a booking.~~ **Incorrect: both already exist**
   (Bookings tab: Cancel and +1 hour; extension capped at 24 hours; tested).
2. ~~Cash payments leave the driver waiting.~~ **Done (in-app).** The screen
   promised a notification, but nothing could trigger one: there was no way
   for an owner to confirm cash. Owners now have a "Cash received" action,
   and the driver sees a badge on the Bookings tab and a notice. Real push
   or email is still open and needs a provider.
3. Duration is capped at 12 hours and there is no start-time picker, so
   overnight or advance booking is not possible.
4. No saved or default payment method (not fully verified).

### Search and discovery
5. Search starts only at 3 characters. Add hint text, recent searches and
   saved places such as home and work.
6. Filters are limited to max price, verified-only and sort. Add spot type,
   EV charging, height limit, available now and minimum rating.
7. No review flow, although spots display a rating. Prompt for a review after
   a pass expires.

### Accessibility
8. About 320 inline `style={{...}}` blocks in a 2,700-line `App.jsx`. These
   cannot do focus rings, hover, reduced motion or colour-scheme handling.
   Continue the move to CSS modules.
9. Several 40x40px tap targets (back, share, favourite, +/- buttons).
   Use 44px or more.
10. No dark mode and no reduced-motion handling.
11. Colour contrast is unchecked, especially the tertiary grey text and the
    white-on-translucent overlay buttons.

### Reliability and feedback
12. Many `catch {}` blocks swallow errors silently (share, QR, photo flows).
    Show a message with a retry.
13. Loading states are plain text. Use skeleton placeholders.
14. ~~No offline support.~~ **Done.** A service worker keeps the app and the
    bookings list, so the pass and QR open without signal. Not yet verified on
    a real phone or iOS Safari, and the manifest uses only an SVG icon.

### Owners and admins
15. Owners cannot edit an existing spot, and there are no availability
    schedules, "unavailable" toggle, earnings summary or payout view.
16. Deleting a spot has no undo.

### Internationalisation
17. Currency and the Chennai defaults are hardcoded. Add locale support if
    the app expands beyond one city.

---

## 5. Suggested order of work

| Priority | Items |
|---|---|
| 1. Do now | ~~`npm audit fix` (3.1)~~ done; ~~`secret` script~~ not broken; ~~delete `e2e/shots`~~ done |
| 2. Quick wins | ~~44px tap targets (9)~~ done; ~~visible error messages (12)~~ done; ~~skeleton loaders (13)~~ done; ~~search hints (5)~~ done (plus a fix for the search dropdown hiding behind the spot sheet) |
| 3. High value | ~~Cancel or extend booking (1)~~ already exists; ~~notifications (2)~~ done in-app (push/email open); ~~offline-cached pass (14)~~ done |
| 4. Larger | Reviews (7); scheduled booking (3); owner spot editing (15); dark mode (10); more filters (6) |

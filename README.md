# ParkSpace

Peer-to-peer parking. Drivers find and book a space near them, owners list
a driveway or garage, admins moderate both.

React 19 + Vite on the front, Express 5 + `node:sqlite` on the back,
Leaflet and OpenStreetMap for the map. Seeded with real Chennai locations,
so distances and map placement are genuine.

---

## Prerequisites

| | |
|---|---|
| Node | **≥ 24** (the server uses the built-in `node:sqlite`) |
| OS | Windows, macOS or Linux |

No database to provision — SQLite lives at `server/parkspace.db` and is
created and seeded automatically on first start.

---

## Setup

```bash
npm install
npm run dev
```

This starts both halves at once (via `concurrently`):

| Process | Port | Script |
|---|---|---|
| Express API | 3001 | `npm run dev:api` |
| Vite dev server | 5173 | `npm run dev:web` |

Open **http://localhost:5173**. Vite proxies `/api/*` to Express
(`vite.config.js`), so there's no CORS setup and no API base URL in the
client. Either half can be run alone with `npm run dev:api` / `npm run dev:web`.

### Signing in

Three accounts are seeded, one per role:

| Role | Email |
|---|---|
| Driver | `driver@parkspace.test` |
| Owner | `owner@parkspace.test` |
| Admin | `admin@parkspace.test` |

Passwords live in
[tests/fixtures/users.fixture.ts](tests/fixtures/users.fixture.ts), the
single source of truth for them, mirroring `SEED_USERS` in
[server/db.js](server/db.js). They are deliberately not shown in the app.

### Social sign-in (optional)

Google, Apple and GitHub can run the real Authorization Code + PKCE flow,
but need credentials to appear at all — a provider with none configured
shows no button, rather than a fake demo login.

```bash
cp .env.example .env     # fill in the provider values you want
npm run dev               # .env is loaded automatically
```

[.env.example](.env.example) walks through registering each provider,
including the exact redirect URI it needs. Apple is the fiddly one — it
needs a paid developer account and an https tunnel for local dev; see the
comments there and [server/apple.js](server/apple.js).

### Resetting the data

```bash
npm run db:reset
```

Clears anything added by testing or manual use and re-seeds from scratch
(3 users, 6 spots, 3 bookings). Run this whenever the local data looks odd.

---

## Common scripts

```bash
npm run dev            # API + web, with hot reload
npm run build           # production bundle into dist/
npm run preview         # serve the built bundle
npm run prod:local      # run the server in production mode, locally
npm start                # plain server, no Vite (serves dist/)
npm run secret           # generate a SESSION_SECRET for deployment

npm run typecheck       # tsc over the app and the test suite
npm run lint             # oxlint + a UTF-8/mojibake check
npm test                 # build, then the Playwright suite
```

Run `typecheck`, `lint`, `build` and `test` before pushing — CI runs the
same four.

---

## Project structure

```
src/            the React app — entry point, API client, components, screens
server/         the Express API — routes, SQLite schema/queries, auth
shared/         types and the data-testid contract, imported by both
                the app and the tests, so a rename breaks the build
                instead of a test silently failing
tests/          Playwright suite — see tests/README.md
public/         favicon, stock spot illustrations
```

`src/App.jsx` is mid-migration from one large file into the `screens/`
tree, in TypeScript — new UI code should be `.tsx`.

---

## Testing and deployment

These have their own docs, since they're big enough to need them:

- **[tests/README.md](tests/README.md)** — running and writing tests,
  the page-object/locator layout, the test-id contract, known gotchas.
- **[DEPLOY.md](DEPLOY.md)** — Fly.io deployment, required environment
  variables, and the production security checks.

---

## Troubleshooting

**`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in the server log.** A
TLS-inspecting corporate proxy — see the comment in `.env.example` about
`NODE_EXTRA_CA_CERTS`. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

**The app looks wrong / data is stale.** `npm run db:reset`.

**Port already in use.** A stale dev server from a previous run — stop
it, or let it be reused (Playwright reuses an existing server outside CI).

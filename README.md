# ParkSpace

Peer-to-peer parking. Drivers find and book a space near them, owners list a
driveway or garage, admins moderate both.

React 19 + Vite on the front, Express 5 + Postgres on the back, Leaflet and
OpenStreetMap for the map. Seeded with real Chennai locations.

**Live demo:** https://parking-space-project-1.onrender.com/ (Render free tier:
it sleeps when idle, so the first load can take up to a minute.)

## Run it locally

Requires **Node 24 or newer**.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. This starts the Express API on port 3001 and
the Vite dev server on 5173; Vite proxies `/api/*` to Express.

No database to install. With `DATABASE_URL` unset the server uses
[PGlite](https://pglite.dev) (Postgres compiled to WASM), stored in
`server/pgdata/` and seeded on first start.

### Seeded accounts

| Role | Email |
|---|---|
| Driver | `driver@parkspace.test` |
| Owner | `owner@parkspace.test` |
| Admin | `admin@parkspace.test` |

Passwords are in [tests/fixtures/users.fixture.ts](tests/fixtures/users.fixture.ts).
Anyone can also register a driver or owner account from the sign-in screen.

## Configuration

Put these in a `.env` file at the repo root (it is gitignored). Everything is
optional locally.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Hosted Postgres connection string (for example Neon). Unset means local PGlite. **Required in production**, otherwise registered users are lost on restart. |
| `SESSION_SECRET` | Signs session tokens. Required in production (32+ characters); generate with `npm run secret`. |
| `DEMO_MODE` | `true` exposes the seeded test accounts. Keep it off in production. |
| `APP_PUBLIC_URL` | The site's public origin, used in emailed links and OAuth redirects. |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Sends password-reset emails. |
| `GOOGLE_*`, `GITHUB_*`, `APPLE_*` | Optional social sign-in. A provider with no credentials shows no button. |

## Scripts

```bash
npm run dev          # API + web with hot reload
npm run build        # production bundle into dist/
npm start            # server only, serves dist/
npm run prod:local   # production mode locally, on port 3002
npm run db:reset     # restore the local demo data (refuses to run if DATABASE_URL is set)

npm run lint         # oxlint + encoding check
npm run typecheck    # app and test suite
npm test             # build, then the full Playwright suite

node scripts/db-query.mjs [table]   # read-only database viewer
```

## Testing

Playwright + TypeScript. Unit and API suites need no browser; the UI suite runs
the same specs on iOS (WebKit), Android (Chromium) and desktop viewports.

```bash
npm run test:unit      # logic only
npm run test:api       # API, OAuth and production-security specs
npm run test:desktop   # UI on desktop (also test:ios, test:android)
npm run test:e2e       # all three UI projects
```

No `npm run dev` is needed first: `playwright.config.ts` starts its own API and
web server against a throwaway local database, and never uses `DATABASE_URL`.
See [tests/README.md](tests/README.md) for adding specs and debugging failures.

**Manual helper, not part of CI:** register a user through the real form and sign
in as them.

```bash
$env:REG_EMAIL='someone@example.com'; $env:REG_PASSWORD='...'; npm run test:register
```

## Deploying

Hosted on **Render** (Docker, free tier) with **Neon** Postgres for data.
Render's free disk is wiped on every restart, so the database must be external.

1. Create a free Neon project and copy its connection string.
2. In Render, add `DATABASE_URL` (the Neon string) and `SESSION_SECRET`
   under **Environment**.
3. Deploy. The log should show `[db] postgres (DATABASE_URL)`.

Full steps and limitations are in [DEPLOY.md](DEPLOY.md). Uploaded spot photos
are still stored on Render's temporary disk and reset on restart.

## Project layout

```
src/        React app (api.ts is the typed API client; screens/, components/, map/)
server/     Express API: index.js routes, db.js Postgres schema + queries,
            session.js signed tokens, oauth.js / apple.js social sign-in
shared/     types and test ids used by both the app and the tests
tests/      Playwright suite
scripts/    encoding check, local production runner, db viewer
```

New UI code should be TypeScript (`.tsx`); styles are CSS Modules on top of the
design tokens in `src/styles/tokens.css`.

## Troubleshooting

**Registered users disappear on the live site.** `DATABASE_URL` is not set on
Render, so the server fell back to the temporary local database. Check the
deploy log for `pglite:` instead of `postgres`.

**Login says "Invalid email or password" for a real user.** The password is
wrong, or the account does not exist in the database the server is using.
Check which database that is with `node --env-file=.env scripts/db-query.mjs users`.

**`password authentication failed` on startup.** The `DATABASE_URL` password is
stale. Copy a fresh connection string from Neon.

**`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in the server log.** A TLS-inspecting
corporate proxy. Set `NODE_EXTRA_CA_CERTS` to the proxy's certificate. Never set
`NODE_TLS_REJECT_UNAUTHORIZED=0`.

**Port already in use.** A stale dev server from an earlier run. Stop it, or let
Playwright reuse it.

# ParkSpace

Peer-to-peer parking. Drivers find and book a space near them, owners list
a driveway or garage, admins moderate both.

React 19 + Vite on the front, Express 5 + `node:sqlite` on the back,
Leaflet and OpenStreetMap for the map. Seeded with real Chennai
locations, so distances and map placement are genuine.

- **Dev workflow** → [Running it locally](#running-it-locally)
- **Test workflow** → [Testing](#testing)
- **How the two connect** → [The test-id contract](#the-test-id-contract)

---

## Prerequisites

| | |
|---|---|
Node | **≥ 24** (the server uses the built-in `node:sqlite`) |
OS | Windows, macOS or Linux |
Browsers | installed once by Playwright, see below |

```bash
npm install
npx playwright install chromium webkit   # for the UI suites
```

No database to provision — SQLite lives at `server/parkspace.db` and is
created and seeded on first start.

---

## Running it locally

```bash
npm run dev
```

Starts both halves at once via `concurrently`:

| Process | Port | Script |
|---|---|---|
Express API | **3001** | `npm run dev:api` |
Vite dev server | **5173** | `npm run dev:web` |

Open **http://localhost:5173**. Vite proxies `/api/*` to Express
(`vite.config.js`), so there is no CORS setup and no API base URL in the
client.

Either half can be run alone with `npm run dev:api` / `npm run dev:web`.

### Signing in

Three accounts are seeded, one per role:

| Role | Email |
|---|---|
Driver | `driver@parkspace.test` |
Owner | `owner@parkspace.test` |
Admin | `admin@parkspace.test` |

Passwords live in **[tests/fixtures/users.fixture.ts](tests/fixtures/users.fixture.ts)**,
which is the single source of truth for them and mirrors `SEED_USERS` in
[server/db.js](server/db.js).

They are deliberately *not* shown in the app. A "Test accounts" panel on
the sign-in screen used to print every seed email **and its plaintext
password** with one-tap login buttons — so the app shipped its own
credentials to every visitor, and seven test suites authenticated by
clicking those buttons instead of ever exercising the login form. Both
problems are gone.

### Social sign-in

Google, Apple and GitHub run the real Authorization Code + PKCE flow. A
provider with no credentials configured gets **no button at all** — the
divider and the whole block are absent, and the password form stands
alone.

There is no demo fallback, on purpose. `POST /api/demo-sso` used to back
the Google and Apple buttons by signing in the seeded driver for whoever
tapped them, regardless of what was typed. That is indistinguishable from
broken authentication, so the endpoint and the buttons were both removed.

To enable a provider, see [.env.example](.env.example). Apple is the
fiddly one — it needs a paid developer account, four values rather than
two, and an https redirect URI, because it refuses both `http` and
`localhost`. [server/apple.js](server/apple.js) explains why.

### Resetting the data

```bash
npm run db:reset
```

Clears everything tests and manual poking added, then re-runs the
idempotent seed. Ends at **3 users, 6 spots, 3 bookings** and fails loudly
if it doesn't. Run it whenever the app looks odd.

### Optional: real OAuth

```bash
cp .env.example .env     # then fill in the values
npm run dev              # .env is loaded automatically
```

[.env.example](.env.example) walks through registering a Google or GitHub
OAuth app, including the exact redirect URI each provider needs. Leave a
provider blank to disable it. It also covers `NODE_EXTRA_CA_CERTS`, which
you need behind a TLS-inspecting corporate proxy — see
[Troubleshooting](#troubleshooting).

### Other dev commands

```bash
npm run build         # production bundle into dist/
npm run preview       # serve the built bundle
npm run prod:local    # run the server in production mode locally
npm run secret        # generate a SESSION_SECRET
npm start             # plain server, no Vite (serves dist/)
```

---

## Project structure

```
src/                      the React app
  main.jsx                entry point
  App.jsx                 root + driver/owner/admin screens (mid-split, see below)
  api.ts                  typed API client; translates every error for humans
  prefs.ts                user preferences + distance formatting
  qr.ts                   booking QR payload
  backstack.ts            centralised browser-Back handling
  constants.ts            fallback map centre, vehicle types, accuracy floor
  styles/                 the global style layer — see Styling below
  theme/                  the TypeScript mirror of the design tokens
  components/             Icon, Btn, Badge, Sheet, Field/Select/Notice, Row, ScreenHeader
  hooks/                  useBackGuard, useGeolocation
  map/                    Leaflet surface, map controls, marker icons
  screens/auth/           AuthScreen, ForgotPasswordSheet

server/                   the API
  index.js                Express routes, security headers, rate limiting
  db.js                   SQLite schema, seed data, queries
  oauth.js                Authorization Code + PKCE, provider registry
  apple.js                Sign in with Apple — ES256 client secret, id_token
  session.js              signed session tokens
  reset.js                restore the demo dataset

shared/                   imported by BOTH the app and the tests
  models.ts               domain types (User, Spot, Booking, …)
  testids.ts              the data-testid contract

tests/                    Playwright suite — see tests/README.md
scripts/                  encoding check/repair, local prod runner
public/                   favicon, stock spot illustrations
```

### A migration in progress

`src/App.jsx` was a single 2756-line file holding ~45 components. It is
being broken up into the tree above, in TypeScript, one area at a time
with the full test suite run between each step.

Done: all four library modules, the theme, the primitives, the hooks, the
map, and the auth screens. Still inline in `App.jsx` (~2141 lines): the
driver home, spot detail and booking flow, the profile sheets, the owner
and admin dashboards, and the `App` root.

`allowJs` is on in [tsconfig.json](tsconfig.json) for exactly this
reason — `.jsx` and `.tsx` coexist until the split finishes. New code
should be `.tsx`/`.ts`.

---

## Styling

Three layers. Which one a style belongs in is decided by *scope*, not
preference.

```
src/styles/
  tokens.css      design tokens as CSS custom properties — the source
  base.css        reset, document defaults
  layout.css      app-shell classes: dvh, safe areas, media queries
  touch.css       tap delay and highlight defaults
  leaflet.css     map markers + overrides of leaflet's own chrome
  index.css       imports the five above, in that order
  cx.ts           class-name join helper

src/components/Btn.module.css      component-scoped, next to its component
src/screens/auth/AuthScreen.module.css
…
```

### 1. Tokens — `src/styles/tokens.css`

Every shared value: colours, tints, fonts, radii, tap targets, shadows,
overlays, the z-index scale. Reference `var(--ps-…)` rather than
repeating a literal.

```css
.panel {
  background: var(--ps-color-white);
  border-radius: var(--ps-radius-sheet);
  z-index: var(--ps-z-modal);
}
```

`src/theme/*.ts` mirrors the tokens for the TypeScript side, which is
still needed wherever a **real value** has to reach JavaScript — `Icon`
sets an SVG `stroke` attribute, and Leaflet's `pathOptions` writes SVG
attributes directly; neither can use a `var()`.

Two sources can drift, so
[tests/specs/unit/tokens.spec.ts](tests/specs/unit/tokens.spec.ts) fails
if they disagree. It checks every colour, the z-index scale, the font
stacks and the 16px input floor, and asserts that any colour added to
`theme/colors.ts` has a token. This matters: before `tokens.css` existed,
`#62d2a2`, `#0d1b2a` and `#5fa8d3` were written in `index.css` *and*
defined again in `theme/colors.ts`.

### 2. Global CSS — `src/styles/*.css`

Only for rules that genuinely **cannot** be scoped or inlined:

| File | Why it has to be global |
|---|---|
`layout.css` | `100vh`/`100dvh` fallback pairs, `env(safe-area-inset-*)`, media queries |
`touch.css` | element selectors, so no interactive element is missed |
`leaflet.css` | markers are HTML strings built by `L.divIcon()`, and these class names are how the test suite locates the map |
`base.css` | `*`, `html`, `body`, `#root` |

**`leaflet.css` must stay global.** `.leaflet-container`, `.ps-price-tag`,
`.ps-user-dot` and `.ps-pin-marker` form a three-way contract:
`src/map/markers.ts` writes them, `leaflet.css` styles them, and
`tests/locators/driver.locators.ts` locates by them. CSS Modules would
hash the names and every map assertion would stop matching. Rename in all
three places or not at all.

### 3. CSS Modules — `*.module.css`

Everything else, in a file next to its component:

```tsx
import { cx } from "../styles/cx";
import s from "./Btn.module.css";

<button className={cx(s.btn, full && s.full, s[size], s[variant])} />
```

Variants are classes selected by prop, not style objects built at render
time. `Btn` exposes `busy` for the in-flight state — it dims the button
*and* swallows the click, so a double-tap can't fire a second request.

### Inline styles

`style={{}}` is not the convention. It survives only in `App.jsx`, whose
290 remaining occurrences move out as each screen is extracted — see the
migration note above. `Btn` keeps a documented `style` escape hatch for a
genuine one-off.

Adding a style? Ask in order: is the value shared → **token**; does it
need `env()`, a media query or a fallback pair → **global**; otherwise →
the component's **module**.

---

## Testing

Playwright + TypeScript, strict mode, **385 tests** by default (753 with
the full device matrix). Full detail, including how to add a spec, is in
**[tests/README.md](tests/README.md)**.

### Projects

Run by default:

| Project | Tests | Engine | Viewport |
|---|---|---|---|
`unit` | 13 | none | — |
`api` | 96 | none | — |
`ios` | 92 | **WebKit** — Mobile Safari's engine | iPhone 13, 390×664 |
`android` | 92 | **Chromium** — Chrome on Android's engine | Pixel 7, 412×839 |
`desktop` | 92 | Chromium | 1440×900 |

All three UI projects run the *same* specs. Both the engine and the
viewport differ, and both matter: [src/styles/layout.css](src/styles/layout.css)
switches on **height** as well as width, and an iPhone 13 at 664px sits
*inside* `@media (max-height: 700px)` while a Pixel 7 at 839px sits
outside it. So iOS and Android exercise different CSS branches rather
than repeating each other.

Opt-in, via `npm run test:devices`:

| Project | Viewport | Why this one |
|---|---|---|
`ios-small` | iPhone 13 Mini, 375×629 | shortest viewport supported |
`android-narrow` | Galaxy S9+, 320×658 | narrowest — 320px was a real bug |
`ios-tablet` | iPad Mini, 768×1024 | crosses `min-width: 720px` |
`android-tablet` | Galaxy Tab S9, 640×1024 | just under that breakpoint |

Each was picked because it lands on a different side of a breakpoint, not
just because it is another phone. They are off by default because they
triple the UI run.

**These are emulated profiles** — a real engine with a device's viewport,
user agent, scale factor and touch. That is what matters for a web app,
but it is not an instrumented device: true native coverage needs
`playwright._android` against a device or emulator, or a device cloud.

### Running

```bash
npm test               # build, then the default projects (~5 min)

npm run test:unit      # 13  — instant, no servers
npm run test:api       # 96  — no browser
npm run test:e2e       # 276 — ios + android + desktop
npm run test:mobile    # 184 — ios + android
npm run test:ios       # 92
npm run test:android   # 92
npm run test:desktop   # 92
npm run test:devices   # 552 — the full phone/tablet matrix
```

**No prior `npm run dev` is needed.** `playwright.config.ts` has a
`webServer` block that resets the database, starts Express on 3001 and
Vite on 5173, and reuses them if they're already up. `npm test` runs
`vite build` first because the production specs assert on the built bundle
being served from a single origin.

Narrow a run the usual ways:

```bash
npx playwright test tests/specs/ui/booking.spec.ts
npx playwright test -g "cancel"                    # by title
npx playwright test --project=android --repeat-each=3   # hunt a flake
```

### Test architecture

Four layers, each with one job:

```
specs/        what should be true          "a driver can cancel a booking"
pages/        how a user does it           BookingsPage.cancelByRef(ref)
locators/     what elements are called     bookingsLocators(page).cancel
shared/       the data-testid strings      TID.bookingCancel
```

Locator modules only *name* elements — they never act. Page objects own
the behaviour. That split means a markup change is a one-file edit in
`locators/`, and specs stay readable as user intent rather than selector
soup.

Fixtures wire it together. Specs import `test`/`expect` from
`@fixtures/index`, never from `@playwright/test` directly, so every test
arrives with page objects and a typed API client already built:

```ts
import { expect, test } from "@fixtures/index";

test("a driver can book a spot", async ({ asDriver, spotDetail }) => {
  await asDriver.openSpotAt(0);          // already signed in, home loaded
  await spotDetail.waitForLoaded();
  const ref = await spotDetail.bookFor(2);
  expect(ref).toMatch(/^PS-/);
});
```

| Fixture | Gives you |
|---|---|
`api` | typed API client — arrange state over HTTP instead of clicking |
`signIn(role)` | sign the browser in as a seeded role |
`asDriver` / `asOwner` / `asAdmin` | signed in *and* on a loaded dashboard |
`authPage`, `driverHome`, `spotDetail`, `bookings`, `profile`, `ownerDashboard`, `adminDashboard` | page objects, built lazily |

Most specs inject a session via the API rather than driving the login
form — a few hundred milliseconds instead of a full round trip, and no
dependency on the login UI. The specs that *are* about signing in
(`specs/ui/auth.spec.ts`) drive the real form. Both matter; conflating
them is how a suite ends up with 40 tests that all fail when one label
changes.

### The test-id contract

This is the handshake between the dev and test sides, and the thing to
understand before touching either.

[shared/testids.ts](shared/testids.ts) is imported by **both**
`src/App.jsx` and the locator modules:

```ts
// shared/testids.ts
export const TID = { bookingCancel: "booking-cancel", /* … */ } as const;
```

```jsx
// the app renders it
<Btn testId={TID.bookingCancel} onClick={…}>Cancel</Btn>
```

```ts
// the locator finds it
cancel: page.getByTestId(TID.bookingCancel)
```

So **renaming an id is a TypeScript error in the tests**, not a locator
that silently times out thirty seconds later. Before this existed the
suite located things by visible text and raw CSS — including, in the login
case, by matching the credentials printed on screen.

Two rules when adding UI:

1. Add the id to `shared/testids.ts` first, then use `TID.x` on both
   sides. Never hand-write a `data-testid` string.
2. Prefer `getByRole` where a button already has a stable, unique label.
   Ids are for elements where text or role would be ambiguous.

Repeated rows carry **two** attributes — a shared `data-testid` so a spec
can count them, plus a record-identity attribute so one specific row is
addressable. An element can only have one `data-testid`, which is why
identity is not baked into it:

```jsx
<div data-testid={TID.spotCard} {...record(RECORD_ATTR.spot, spot.id)}>
```

### When a test fails

```bash
npm run test:report    # HTML report from the last run
npm run test:headed    # watch it in a real browser
npm run test:debug     # step through with the inspector
```

Traces are captured on first retry, failure screenshots always, video in
CI — all into `test-results/`. Open a trace with
`npx playwright show-trace test-results/<dir>/trace.zip` for a
step-by-step timeline with DOM snapshots.

### Gotchas that have bitten us

- **The suite is `fullyParallel`.** Anything counting rows must use its
  own throwaway account; the seeded driver and owner are shared.
- **Unique test data needs process entropy.** Each worker is a separate
  process, so a timestamp plus a module counter collides across workers.
  `newAccount()` and `stamp()` mix in `process.pid` and randomness.
- **Four actions go through `window.confirm`** (cancel booking, delete
  listing, delete user, delete spot). Playwright auto-dismisses dialogs,
  so page objects must arm `acceptNextConfirm()` first.
- **The duration control is a stepper** and the max-price filter is an
  `<input type="range">` driven by React state — neither can be
  `fill()`ed.
- **Distances switch unit by magnitude**, not just preference: `850 m`
  below a kilometre, `300 ft` below a tenth of a mile.
- **Navigations use `domcontentloaded`,** not `networkidle` — with a Vite
  HMR socket and a map fetching tiles the network may never go idle.

---

## Quality gates

Run before pushing; CI should run the same four:

```bash
npm run typecheck   # tsc over the app AND the suite, both strict
npm run lint        # oxlint + the mojibake check
npm run build       # must produce a bundle
npm test            # 385 tests across iOS, Android and desktop
```

`npm run lint` includes `npm run check:encoding`, which walks `src/`,
`shared/`, `server/`, `tests/` and `scripts/` looking for mojibake — UTF-8
that was decoded as a single-byte codepage and re-saved. This app is full
of `₹`, en/em dashes, `★`, `•` and `›`, so one bad round trip through a
codepage-guessing tool silently corrupts the UI. If it reports a file,
`node scripts/encoding-repair.mjs <file>` reverses it exactly.

---

## Suggested loop for a change

1. `npm run dev`, make the change.
2. If you added UI: add the id to `shared/testids.ts`, render it via
   `TID.x`, add it to the relevant `tests/locators/*.ts`.
3. Put the behaviour on a page object, not in the spec.
4. Write the spec against the page object.
5. `npm run test:ios -g "<your title>"` until green, then
   `npm run test:mobile` to cover Android too.
6. `npm run typecheck && npm run lint && npm test`.

---

## API reference

All under `/api`. Auth is `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
Auth | `POST /login` `POST /register` `POST /password-reset` `GET /me` `PATCH /me` `POST /me/password` |
OAuth | `GET /auth/providers` `GET /auth/:provider/start` `GET`+`POST /auth/:provider/callback` `POST /auth/exchange` |
Spots | `GET /spots` `POST /spots` `PATCH /spots/:id` `DELETE /spots/:id` |
Bookings | `GET /bookings` `POST /bookings` `PATCH /bookings/:id` |
Favourites | `GET /favourites` `PUT /favourites/:spotId` `DELETE /favourites/:spotId` |
Vehicles | `GET /vehicles` `POST /vehicles` `DELETE /vehicles/:id` |
Payments | `GET /payment-methods` `POST /payment-methods` `DELETE /payment-methods/:id` |
Photos | `GET /spot-photos` `POST /spot-photos` `DELETE /spot-photos/:id` |
Owner | `GET /owner/earnings` |
Admin | `GET /users` `PATCH /users/:id` `DELETE /users/:id` `GET /stats` |
Misc | `GET /places` `GET /health` |
Demo-only | `GET /demo-accounts` — 404 unless `DEMO_MODE` |

`GET /spots` returns `distance: null` unless you pass `lat` and `lng`;
with them it returns real haversine distances sorted nearest-first, and
honours an optional `radius` in metres.

The callback accepts both `GET` and `POST`: Google and GitHub redirect
back with query params, Apple form-posts because requesting `name email`
scope obliges `response_mode=form_post`.

`GET /demo-accounts` is gated by `DEMO_MODE`, which defaults **off** in
production. `specs/api/production.api.spec.ts` asserts it 404s there.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)**. `Dockerfile` and `fly.toml` target
Fly.io; in production Express serves the built `dist/` from a single
origin with HSTS, CSP, `nosniff` and `X-Frame-Options: DENY`.

`SESSION_SECRET` is mandatory — the server **refuses to start** without a
strong one rather than falling back to a guessable key, because that
would make every signed token forgeable.
`specs/api/production.api.spec.ts` asserts that, along with token
forgery, tampering, expiry, the security headers and login rate limiting.

Verify a production build locally before shipping:

```bash
npm run build && npm run prod:local
npm run test:api                 # includes the production security specs
```

---

## Troubleshooting

**`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in the server log.** A
TLS-inspecting corporate proxy. Browsers work because Windows trusts the
proxy's root CA and Node does not. Export that CA to a PEM and set
`NODE_EXTRA_CA_CERTS`. Never `NODE_TLS_REJECT_UNAUTHORIZED=0`. Only place
search is affected; it degrades to an empty result and the suite asserts
that it does.

**Tests fail with "port already in use".** A stale dev server. Stop it,
or let Playwright reuse it — `reuseExistingServer` is on outside CI.

**The app looks wrong / data is stale.** `npm run db:reset`.

**`FOREIGN KEY constraint failed` from `db:reset`.** Should not happen:
`spots.created_by` has no `ON DELETE CASCADE`, so `reset.js` deletes
non-seed spots *before* non-seed users. If you add a table referencing
`users`, keep that ordering.

**A locator times out after changing markup.** You probably moved a
`data-testid`. Check `shared/testids.ts` is still the only place the
string is written.

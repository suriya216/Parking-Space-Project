# ParkSpace test suite

Playwright + TypeScript, strict mode. Replaces the hand-rolled
`e2e/*.mjs` scripts, which each launched their own browser, counted their
own assertions and reported by `console.log`.

This document is the detail: layout, conventions, and the traps worth
knowing before you add a spec. For the project-wide picture — dev setup,
the per-project test counts, the quality gates and the change loop — see
the [root README](../README.md). Test counts are deliberately recorded
there only, so they can't drift between two files.

## Running

```bash
npm test              # everything: unit + api + mobile + desktop
npm run test:unit     # pure logic, no browser, no server
npm run test:api      # API/OAuth/production, no browser
npm run test:e2e      # UI at both viewports
npm run test:mobile   # UI, iPhone 13
npm run test:desktop  # UI, 1440x900
npm run test:headed   # watch it run
npm run test:report   # open the last HTML report
npm run typecheck     # tsc over both the app and the suite
```

No prior `npm run dev` is needed: `playwright.config.ts` has a
`webServer` block that resets the database, starts the Express API on
3001 and Vite on 5173, and reuses them if they are already running.

`npm test` runs `vite build` first, because the production specs assert
on the built bundle being served from a single origin.

## Layout

```
shared/
  testids.ts         data-testid contract, imported by the app AND the tests
  models.ts          domain types, shared by the client and the API specs
tests/
  fixtures/
    index.ts         the suite's `test` and `expect` — specs import this
    users.fixture.ts test accounts + negative-path credentials
    api.fixture.ts   typed API client over Playwright's request context
    auth.fixture.ts  session injection, role sign-in
    data.fixture.ts  unique-per-run spots, vehicles, cards, coordinates
  locators/          element NAMES only, one module per area
  pages/             behaviour; page objects consume locators
  support/
    env.ts            ports and base URLs
    oauth-harness.ts  fake OIDC provider (Google-shaped) + app server
    apple-harness.ts  fake Apple: form_post, RS256 id_token, JWKS
    prod-harness.ts   production-mode server for the security specs
  specs/
    unit/            no browser
    api/             no browser
    ui/              mobile + desktop projects
```

### Why locators are separate from page objects

A locator module only *names* elements. Page objects own the behaviour.
That split means a markup change is a one-file edit in `locators/`, and
the page objects stay readable as user intent rather than selector soup.

### Why test ids live in `shared/`

`shared/testids.ts` is imported by both `src/App.jsx` and the locator
modules, so a renamed id is a **TypeScript error in the tests** rather
than a locator that silently times out. Before this, the suite located
things by visible text and raw CSS — including, in the login case, by
matching the credentials printed on screen.

Repeated rows carry two attributes: a shared `data-testid` so a spec can
count them, plus a record-identity attribute (`data-spot-id`,
`data-booking-id`, …) so one specific row is addressable. An element can
only have one `data-testid`, which is why identity is not baked into it.

## Test accounts

Credentials live in `fixtures/users.fixture.ts` and nowhere else.

They used to be rendered into the sign-in screen — a "Test accounts"
panel that printed each seeded account's email **and plaintext
password**, with one-tap login buttons. Seven UI suites authenticated by
clicking those buttons, which meant none of them ever exercised the login
form, and the app shipped its own credentials to every visitor.

The panel is gone. `specs/ui/auth.spec.ts` drives the real form, and the
fixture now carries the cases a visible panel could not express: wrong
passwords, unknown accounts, whitespace and case variants, empty fields,
and unique-per-run registration payloads.

`GET /api/demo-accounts` still exists, still gated by `DEMO_MODE`, purely
so the production specs can keep asserting it 404s on a public
deployment. Nothing in the UI calls it.

## Gotchas worth knowing before you add a spec

- **The suite is `fullyParallel`.** Anything that counts rows must use
  its own throwaway account; the seeded driver/owner are shared. Several
  early failures here were exactly this.
- **Unique test data needs process entropy.** Each worker is a separate
  process, so a timestamp plus a module-level counter collides across
  workers. `newAccount()` and `stamp()` mix in `process.pid` and a random
  block for this reason.
- **Four actions go through `window.confirm`** (cancel booking, delete
  listing, delete user, delete spot). Playwright auto-dismisses dialogs,
  so page objects must arm `acceptNextConfirm()` first.
- **The duration control is a stepper, not a field**, and the max-price
  filter is `<input type="range">` driven by React state — neither can be
  `fill()`ed. See `SpotDetailPage.setHours` and
  `DriverHomePage.setMaxPrice`.
- **Distances switch unit by magnitude**, not just by preference: metric
  renders `850 m` below a kilometre, imperial renders `300 ft` below a
  tenth of a mile. Assert on both members of the pair.
- **The geocoder is often unreachable** behind a TLS-inspecting proxy
  (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). Place-search specs assert
  graceful degradation rather than requiring live results.
- **Navigations use `domcontentloaded`,** not `networkidle` — with a Vite
  HMR websocket and a map fetching tiles the network may never go idle.
  `BasePage.waitForApp()` waits for React to have mounted instead.

## Mapping from the suites this replaced

The `e2e/*.mjs` scripts have been deleted; this table is kept so you can
find where a given piece of old coverage went.

| Old | New |
| --- | --- |
| `e2e/backstack.test.mjs` | `specs/unit/backstack.spec.ts` |
| `e2e/api.test.mjs` | `specs/api/auth.api.spec.ts`, `spots.api.spec.ts` |
| `e2e/booking-time.mjs` | `specs/api/bookings.api.spec.ts` |
| `e2e/features.test.mjs` | `specs/api/spots.api.spec.ts` |
| `e2e/oauth.test.mjs` | `specs/api/oauth.api.spec.ts`, `specs/ui/oauth-return.spec.ts` |
| — (new) | `specs/api/apple.api.spec.ts` — Sign in with Apple against a fake Apple |
| — (new) | `specs/ui/navigation.spec.ts` — browser Back across every surface |
| — (new) | `specs/unit/tokens.spec.ts` — CSS/TS design-token drift guard |
| `e2e/production.test.mjs` | `specs/api/production.api.spec.ts` |
| `e2e/drive.mjs` | `specs/ui/booking.spec.ts`, `profile.spec.ts`, `owner.spec.ts`, `admin.spec.ts` |
| `e2e/ui-features.test.mjs` | `specs/ui/driver-home.spec.ts` |
| `e2e/recovery.test.mjs` | `specs/ui/recovery.spec.ts` |
| `e2e/location.test.mjs` | `specs/ui/driver-home.spec.ts` (`location` describe) |
| `e2e/mobile.test.mjs` | the `mobile` / `desktop` projects |
| `e2e/ux-audit.mjs` | not ported — a screenshot-gathering tool, not a test |
| `e2e/encoding-check.mjs` | kept as `scripts/encoding-check.mjs` — repo hygiene, not a test; now runs as part of `npm run lint` |
| `e2e/encoding-repair.mjs` | kept as `scripts/encoding-repair.mjs` |
| `scripts/run-ui.mjs` | superseded by `npm run test:headed` |

`e2e/shots/` holds ~73 MB of screenshots the old suites wrote. It was
always gitignored, so none of it is in the repository. Playwright writes
its own traces and failure screenshots to `test-results/` instead, also
gitignored. The directory can be deleted whenever you like.

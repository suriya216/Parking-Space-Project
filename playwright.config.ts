import { defineConfig, devices } from "@playwright/test";

import { API_PORT, API_URL, BASE_URL, IS_CI, WEB_PORT } from "./tests/support/env";

/**
 * Context shared by every UI project.
 *
 * The geolocation is Teynampet, central Chennai, which is where the
 * seeded listings are — without it the app falls back to a city centre
 * and every distance assertion becomes meaningless. `en-IN` matches the
 * date and currency formats the booking specs assert on.
 */
const MOBILE_CONTEXT = {
  /* Not `as const`: Playwright's `permissions` is a mutable string[]. */
  permissions: ["geolocation"],
  geolocation: { latitude: 13.0392, longitude: 80.2489 },
  locale: "en-IN",
};

/** Set DEVICE_MATRIX=1 to add the small-phone and tablet profiles. */
const WIDE_MATRIX = Boolean(process.env.DEVICE_MATRIX);

/**
 * ParkSpace end-to-end configuration.
 *
 * Replaces the hand-rolled e2e/*.mjs scripts: each of those launched its
 * own browser, counted its own assertions and reported by console.log.
 * Everything here — retries, parallelism, traces, HTML report, server
 * lifecycle — is what those scripts were reimplementing badly.
 *
 * `webServer` boots the Express API (with a fresh seeded DB) and Vite,
 * so `npx playwright test` needs no prior `npm run dev`.
 */
export default defineConfig({
  testDir: "./tests/specs",
  outputDir: "./test-results",

  /* A stray `test.only` left in a spec silently skips the suite in CI. */
  forbidOnly: IS_CI,
  fullyParallel: true,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 2 : undefined,

  /* The old scripts used a 60s timeout because a headed run competing for
     CPU, or slow OpenStreetMap tiles, could push a navigation past
     Playwright's 30s default. Same reasoning, same number. */
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: IS_CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: BASE_URL,
    navigationTimeout: 60_000,
    /* 30s, not the 20s this started at. The `api` project spawns three
       extra app servers of its own (the Google and Apple fake-IdP
       harnesses and the production-mode one), and those run alongside
       164 map-heavy UI tests across both viewports. On a developer
       machine that contention alone pushed a couple of clicks past 20s —
       tests that pass in isolation every time. Raising the budget is the
       honest fix; local retries would just hide it. */
    actionTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: IS_CI ? "retain-on-failure" : "off",
    testIdAttribute: "data-testid",
  },

  projects: [
    /* Pure logic — src/backstack.ts against a fake history. No browser,
       no server; it just needs a runner. */
    {
      name: "unit",
      testMatch: /specs\/unit\/.*\.spec\.ts$/,
    },

    /* API, OAuth and production suites need no browser UI. Separated so
       they run fast and can't be slowed by the map-heavy UI projects. */
    {
      name: "api",
      testMatch: /specs\/api\/.*\.spec\.ts$/,
      use: { baseURL: API_URL },
    },

    /* ── The device matrix ─────────────────────────────────
       Every UI project runs the SAME specs. What differs is the engine
       and the viewport, and both matter here:

         iOS      → WebKit, the engine behind Mobile Safari
         Android  → Chromium, the engine behind Chrome on Android
         desktop  → layout at width, not a different input device

       The viewports are not interchangeable either. src/styles/layout.css
       switches on height as well as width, and an iPhone 13 is 664px tall
       — inside `@media (max-height: 700px)` — while a Pixel 7 is 839px
       and outside it. So the two phones exercise different CSS branches
       rather than repeating each other.

       These are EMULATED profiles: a real engine with a device's
       viewport, user agent, scale factor and touch, which is what
       matters for a web app. They are not instrumented devices — true
       native coverage needs `playwright._android` against a device or
       emulator, or a device cloud. */
    {
      name: "ios",
      testMatch: /specs\/ui\/.*\.spec\.ts$/,
      use: { ...devices["iPhone 13"], ...MOBILE_CONTEXT },
    },
    {
      name: "android",
      testMatch: /specs\/ui\/.*\.spec\.ts$/,
      use: { ...devices["Pixel 7"], ...MOBILE_CONTEXT },
    },
    {
      name: "desktop",
      testMatch: /specs\/ui\/.*\.spec\.ts$/,
      use: {
        viewport: { width: 1440, height: 900 },
        /* hasTouch stays on at desktop width deliberately: plenty of
           desktops have touchscreens, and it lets the page objects' tap
           helpers work unchanged. What this project tests is the LAYOUT
           at width, not the input device. */
        hasTouch: true,
        isMobile: false,
        ...MOBILE_CONTEXT,
      },
    },

    /* ── Wider matrix, opt-in ──────────────────────────────
       Four more profiles, each chosen because it lands on a different
       side of a breakpoint in src/styles/layout.css rather than just
       being another phone:

         iPhone 13 Mini  375x629  the shortest viewport we support
         Galaxy S9+      320x658  the narrowest — 320px was a real bug
         iPad Mini       768x1024 crosses `min-width: 720px`, iOS
         Galaxy Tab S9   640x1024 just under that breakpoint, Android

       Off by default: they triple the UI run for diminishing returns.
       `npm run test:devices` switches them on. */
    ...(WIDE_MATRIX
      ? [
          {
            name: "ios-small",
            testMatch: /specs\/ui\/.*\.spec\.ts$/,
            use: { ...devices["iPhone 13 Mini"], ...MOBILE_CONTEXT },
          },
          {
            name: "android-narrow",
            testMatch: /specs\/ui\/.*\.spec\.ts$/,
            use: { ...devices["Galaxy S9+"], ...MOBILE_CONTEXT },
          },
          {
            name: "ios-tablet",
            testMatch: /specs\/ui\/.*\.spec\.ts$/,
            use: { ...devices["iPad Mini"], ...MOBILE_CONTEXT },
          },
          {
            name: "android-tablet",
            testMatch: /specs\/ui\/.*\.spec\.ts$/,
            use: { ...devices["Galaxy Tab S9"], ...MOBILE_CONTEXT },
          },
        ]
      : []),
  ],

  /* Reset the DB before the API comes up so every run starts from the
     known seed. reuseExistingServer keeps a local `npm run dev` usable. */
  webServer: [
    {
      command: "node server/reset.js && node --env-file-if-exists=.env server/index.js",
      port: API_PORT,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        /* Explicit rather than inherited: the demo-SSO and demo-accounts
           specs assert on behaviour that is gated by this flag. */
        DEMO_MODE: "true",
        NODE_ENV: "development",
        PORT: String(API_PORT),
      },
    },
    {
      command: "npx vite --port " + WEB_PORT + " --strictPort",
      port: WEB_PORT,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
    },
  ],
});

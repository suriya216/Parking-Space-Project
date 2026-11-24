/**
 * The parking pass has to open with no signal: the places people park are
 * often basements and covered garages. The QR is drawn in the browser, so
 * all it needs is the app itself and the booking, both kept by the service
 * worker (public/sw.js).
 *
 * The worker is registered by the production build only, so this spec boots
 * its own production-mode server (one per Playwright worker, on its own
 * port and data folder) and points the browser and the API client at it.
 * Every other UI spec runs against the Vite dev server with service workers
 * blocked (see playwright.config.ts), which keeps page.route() working.
 */

import { ApiClient } from "@fixtures/api.fixture";
import { BOOKING_HOURS } from "@fixtures/data.fixture";
import { expect, injectSession, newAccount, test as base } from "@fixtures/index";
import { TID } from "@shared/testids";
import { distIsBuilt, startProdServer, type ProdEnvironment } from "@support/prod-harness";

const FIRST_PORT = 4710;

const test = base.extend<{ baseURL: string }, { prodEnv: ProdEnvironment }>({
  prodEnv: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const port = FIRST_PORT + workerInfo.parallelIndex;
      const env = await startProdServer({
        port,
        dataDir: `server/test-data/offline-${port}`,
      });
      await use(env);
      env.stop();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ prodEnv }, use) => {
    await use(prodEnv.base);
  },
  /* The shared client is pinned to the dev API; its sessions would be
     rejected by this server, which signs with its own secret. */
  api: async ({ playwright, prodEnv }, use) => {
    const context = await playwright.request.newContext({ baseURL: prodEnv.base });
    await use(new ApiClient(context));
    await context.dispose();
  },
});

test.use({ serviceWorkers: "allow" });

/* Chromium only, and once: Playwright's offline emulation with service
   workers is reliable there, and the worker code is the same everywhere. */
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "android",
    "service worker behaviour is checked in Chromium only",
  );
  test.skip(!distIsBuilt(), "needs `npm run build` first");
});

test.describe("offline parking pass", () => {
  test("a booked pass still opens after the connection drops", async ({
    page,
    context,
    api,
    driverHome,
    bookings,
  }) => {
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    if (!spot) test.skip(true, "no seeded spots to book");

    const registered = await api.register(newAccount("driver"));
    const booked = await api.createBooking(registered.data.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.minimum,
    });
    const ref = booked.data.booking.ref;

    await injectSession(page, registered.data);

    /* Let the worker finish installing, then reload so this page is
       controlled by it and its bookings request is the one that gets saved. */
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload({ waitUntil: "domcontentloaded" });
    await driverHome.waitForLoaded();
    await bookings.openFromTab();
    await expect(bookings.el.cardByRef(ref)).toBeVisible();
    await expect(page.getByTestId(TID.bookingsOffline)).toHaveCount(0);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await driverHome.el.screen.waitFor({ state: "visible" });
    await bookings.openFromTab();

    await expect(page.getByTestId(TID.bookingsOffline)).toBeVisible();
    await bookings.showPassByRef(ref);
    await expect(bookings.pass.qr).toBeVisible();
  });

  test("signing out removes the saved bookings from the device", async ({
    page,
    api,
    driverHome,
    bookings,
    profile,
  }) => {
    const registered = await api.register(newAccount("driver"));
    await injectSession(page, registered.data);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload({ waitUntil: "domcontentloaded" });
    await driverHome.waitForLoaded();
    await bookings.openFromTab();
    await expect.poll(() => page.evaluate(() => caches.has("ps-api-v1"))).toBe(true);

    /* Another person may use this device next: their bookings must not be
       readable from what this one left behind. */
    await profile.openFromTab();
    await profile.signOut();
    await expect.poll(() => page.evaluate(() => caches.has("ps-api-v1"))).toBe(false);
  });
});

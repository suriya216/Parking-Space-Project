/**
 * Error and empty states — ports e2e/recovery.test.mjs.
 *
 * The rule these enforce: a failure is never a dead end, and never shows
 * the user raw browser or HTTP jargon. "Failed to fetch" and a bare 401
 * are both bugs as far as this suite is concerned.
 */

import { TID } from "@shared/testids";
import { SESSION_STORAGE_KEY } from "@fixtures/auth.fixture";
import { expect, injectSession, newAccount, test } from "@fixtures/index";

test.describe("when the spots request fails", () => {
  test("explains it in plain words and recovers on retry", async ({
    page,
    signIn,
    driverHome,
  }) => {
    await signIn("driver");
    await driverHome.waitForLoaded();

    /* Kill the network for /api/spots, then reload so the failure happens
       on mount the way a real outage would. */
    await page.route("**/api/spots**", (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(driverHome.el.errorState).toBeVisible({ timeout: 30_000 });

    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toMatch(/Failed to fetch/i);
    expect(body).toMatch(/Can't reach ParkSpace|appear to be offline/i);

    await expect(driverHome.el.retry).toBeVisible();

    /* Retry must actually work once the network is back — an error with a
       button that does nothing is still a dead end. */
    await page.unroute("**/api/spots**");
    await driverHome.el.retry.click();

    await expect(driverHome.el.spotCards.first()).toBeVisible({ timeout: 30_000 });
    await expect(driverHome.el.errorState).toHaveCount(0);
  });

  test("a 500 is explained without showing the status code", async ({
    page,
    signIn,
    bookings,
  }) => {
    await signIn("driver");

    await page.route("**/api/bookings**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );

    await bookings.openFromTab();
    /* Bookings load once on mount, so switching tabs alone won't refetch;
       Refresh forces the intercepted request. */
    await page.getByRole("button", { name: /^Refresh$/ }).click();

    const body = page.locator("body");
    await expect(body).toContainText(/went wrong on our side/i, { timeout: 20_000 });
    expect((await body.textContent()) ?? "").not.toMatch(/\b500\b/);

    await page.unroute("**/api/bookings**");
  });
});

test.describe("when the session has expired", () => {
  test("returns to sign-in, says why, and clears the stale token", async ({
    page,
    signIn,
    authPage,
  }) => {
    await signIn("driver");

    /* Forge the token so the server answers 401 on the next request. */
    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error("no session to tamper with");
      const session = JSON.parse(raw) as { token: string };
      session.token = "bogus.token";
      window.localStorage.setItem(key, JSON.stringify(session));
    }, SESSION_STORAGE_KEY);

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(authPage.el.screen).toBeVisible({ timeout: 30_000 });
    await expect(authPage.el.heading).toHaveText("Welcome back");
    await expect(authPage.el.notice).toContainText(/session has expired/i);

    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toMatch(/\b401\b/);

    /* And the dead session is gone, so a reload doesn't retry it. */
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SESSION_STORAGE_KEY,
    );
    expect(stored).toBeNull();
  });

  test("the expiry notice can be dismissed", async ({ page, signIn, authPage }) => {
    await signIn("driver");
    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      const session = JSON.parse(raw ?? "{}") as { token: string };
      session.token = "bogus.token";
      window.localStorage.setItem(key, JSON.stringify(session));
    }, SESSION_STORAGE_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(authPage.el.notice).toBeVisible({ timeout: 30_000 });
    await authPage.el.noticeDismiss.click();
    await expect(authPage.el.notice).toHaveCount(0);
  });
});

test.describe("empty states", () => {
  /* A brand-new account is the only honest way to reach these — the
     seeded driver has both bookings and favourites. */

  test("empty bookings explains itself and leads to the map", async ({
    page,
    api,
    bookings,
    driverHome,
  }) => {
    const registered = await api.register(newAccount("driver"));
    await injectSession(page, registered.data);

    await bookings.openFromTab();
    await expect(bookings.el.empty).toContainText(/No bookings yet/i);

    await bookings.el.empty.getByRole("button", { name: /Find parking/i }).click();
    await expect(driverHome.el.map).toBeVisible({ timeout: 30_000 });
  });

  test("empty saved explains itself and leads to the map", async ({
    page,
    api,
    bookings,
    driverHome,
  }) => {
    const registered = await api.register(newAccount("driver"));
    await injectSession(page, registered.data);

    await bookings.openSavedFromTab();
    await expect(bookings.saved.empty).toContainText(/Nothing saved yet/i);

    await bookings.saved.empty.getByRole("button", { name: /Browse spots/i }).click();
    await expect(driverHome.el.map).toBeVisible({ timeout: 30_000 });
  });

  test("a new account has no vehicles and says so", async ({ page, api, profile }) => {
    const registered = await api.register(newAccount("driver"));
    await injectSession(page, registered.data);

    await profile.openFromTab();
    await profile.openVehicles();

    await expect(page.getByTestId(TID.vehiclesEmpty)).toBeVisible();
    await expect(profile.vehicles.rows).toHaveCount(0);
  });
});

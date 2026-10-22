/**
 * Scanning a booking's QR code.
 *
 * The code encodes `/?pass=<token>`, and that one URL has to behave
 * differently for two people standing in the same driveway:
 *
 *   - the owner of the spot gets a button to confirm the car arrived and
 *     parked;
 *   - anyone else — the driver on a second phone, a passer-by, a signed
 *     out browser — gets the parking details and no more.
 *
 * These drive the real screen rather than the API, because the whole
 * point is what each person is shown.
 */

import {
  passScreenLocators,
  type PassScreenLocators,
} from "@locators/driver.locators";
import {
  USERS,
  expect,
  injectSession,
  newAccount,
  signOutCompletely,
  test,
} from "@fixtures/index";
import type { ApiClient } from "@fixtures/api.fixture";
import type { Page } from "@playwright/test";

/** A spot the seeded owner account actually owns. */
const OWNED_SPOT = "Lakshmi Residency";

/** Book the seeded owner's spot as the seeded driver. */
const arrangeBooking = async (api: ApiClient) => {
  const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
  const spot = (await api.spots()).data.spots.find((s) => s.name === OWNED_SPOT);
  expect(spot, `seeded spot "${OWNED_SPOT}" must exist`).toBeDefined();

  const created = await api.createBooking(driver.token, { spotId: spot!.id, hours: 2 });
  expect(created.status).toBe(201);

  const booking = created.data.booking;
  expect(booking.pass_token).toBeTruthy();
  return { driver, spot: spot!, booking, passToken: booking.pass_token! };
};

/** Follow the scanned link and wait for the screen to settle. */
const scan = async (page: Page, passToken: string): Promise<PassScreenLocators> => {
  const el = passScreenLocators(page);
  await page.goto(`/?pass=${passToken}`, { waitUntil: "domcontentloaded" });
  await el.screen.waitFor({ state: "visible", timeout: 20_000 });
  await el.reference.waitFor({ state: "visible", timeout: 20_000 });
  return el;
};

test.describe("a stranger scans the code", () => {
  test("a signed-out phone sees the parking details, not the driver", async ({
    page,
    api,
  }) => {
    const { booking, spot, driver } = await arrangeBooking(api);
    await signOutCompletely(page);

    const el = await scan(page, booking.pass_token!);

    /* It renders at all without a session — that is the point. No
       sign-in screen in the way. */
    await expect(el.reference).toContainText(booking.ref);
    await expect(el.screen).toContainText(spot.name);
    await expect(el.screen).toContainText(spot.address);

    /* And nothing personal, nor any way to check the car in. */
    await expect(el.driver).toHaveCount(0);
    await expect(el.confirmArrival).toHaveCount(0);
    await expect(el.viewerNote).toBeVisible();
    await expect(el.screen).not.toContainText(USERS.driver.name);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("the driver's own second phone still only sees parking info", async ({
    page,
    api,
  }) => {
    /* The case called out explicitly: scanning your own code from another
       handset must not let you certify your own arrival. */
    const { booking, driver } = await arrangeBooking(api);
    await injectSession(page, driver);

    const el = await scan(page, booking.pass_token!);

    await expect(el.reference).toContainText(booking.ref);
    /* Their own name is fine — it is their booking — but the owner's
       check-in button is not offered. */
    await expect(el.confirmArrival).toHaveCount(0);
    await expect(el.arrival).toContainText(/only the owner of this spot/i);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("an owner of a different spot gets the public view", async ({ page, api }) => {
    const { booking, driver } = await arrangeBooking(api);

    /* An owner account, but not THIS spot's owner. The check is
       per-spot, not per-role. */
    const other = await api.register(newAccount("owner"));
    expect(other.ok).toBe(true);
    await injectSession(page, other.data);

    const el = await scan(page, booking.pass_token!);

    await expect(el.confirmArrival).toHaveCount(0);
    await expect(el.viewerNote).toBeVisible();
    await expect(el.driver).toHaveCount(0);

    await api.cancelBooking(driver.token, booking.id);
  });

  test("a code that isn't a real pass says so and offers a way out", async ({
    page,
    driverHome,
  }) => {
    await signOutCompletely(page);
    await page.goto(`/?pass=${"f".repeat(32)}`, { waitUntil: "domcontentloaded" });

    const el = passScreenLocators(page);
    await expect(el.error).toBeVisible({ timeout: 20_000 });

    /* Not a dead end: the screen must lead somewhere. */
    await page.getByRole("button", { name: /open parkspace/i }).click();
    await expect(driverHome.el.screen.or(page.getByTestId("auth-screen"))).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("the owner scans the code", () => {
  test("the owner confirms the car arrived and parked", async ({ page, api }) => {
    const { booking, driver } = await arrangeBooking(api);

    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    await injectSession(page, owner);

    const el = await scan(page, booking.pass_token!);

    /* The owner sees who to expect, and can vouch for the car. */
    await expect(el.driver).toBeVisible();
    await expect(el.arrival).toContainText(/confirm once you've seen the car/i);

    await el.confirmArrival.click();

    /* Confirmed on screen... */
    await expect(el.arrival).toContainText(/arrival confirmed/i, { timeout: 20_000 });
    await expect(el.status).toContainText(/parked/i);
    await expect(el.confirmArrival).toHaveCount(0);

    /* ...and recorded server-side, not just locally. */
    const rows = await api.bookings(driver.token);
    expect(rows.data.bookings.find((b) => b.id === booking.id)?.arrived_at).toBeTruthy();

    await api.cancelBooking(driver.token, booking.id);
  });

  test("the driver then sees the check-in on their own pass", async ({
    page,
    api,
    bookings,
  }) => {
    const { booking, driver } = await arrangeBooking(api);
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);

    /* Arrange the confirmation through the API — this spec is about what
       the driver sees afterwards. */
    const confirmed = await api.confirmArrival(booking.pass_token!, owner.token);
    expect(confirmed.status).toBe(200);

    await injectSession(page, driver);
    await bookings.openFromTab();
    await bookings.showPassByRef(booking.ref);

    await expect(bookings.pass.arrival).toContainText(
      /owner has confirmed your car arrived/i,
    );

    await api.cancelBooking(driver.token, booking.id);
  });

  test("re-scanning an already confirmed pass is harmless", async ({ page, api }) => {
    const { booking, driver } = await arrangeBooking(api);
    const owner = await api.loginOrThrow(USERS.owner.email, USERS.owner.password);
    await api.confirmArrival(booking.pass_token!, owner.token);

    await injectSession(page, owner);
    const el = await scan(page, booking.pass_token!);

    /* Already checked in, so there is nothing left to press. */
    await expect(el.arrival).toContainText(/arrival confirmed/i);
    await expect(el.confirmArrival).toHaveCount(0);

    await api.cancelBooking(driver.token, booking.id);
  });
});

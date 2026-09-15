/**
 * The booking journey — ports the core of e2e/drive.mjs.
 *
 * Arrangement that isn't the thing under test goes through the API
 * fixture, so a failure here points at the booking flow rather than at
 * whatever it took to reach it.
 */

import { TID } from "@shared/testids";
import { BOOKING_HOURS } from "@fixtures/data.fixture";
import { USERS, expect, injectSession, newAccount, test } from "@fixtures/index";

test.describe("booking a spot", () => {
  test("a driver can book from the spot list and reach a confirmation", async ({
    asDriver,
    spotDetail,
  }) => {
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();

    const spotName = await spotDetail.name();
    expect(spotName.length).toBeGreaterThan(0);

    await spotDetail.setHours(BOOKING_HOURS.typical);
    expect(await spotDetail.currentHours()).toBe(BOOKING_HOURS.typical);

    await spotDetail.startBooking();
    await expect(spotDetail.confirmSheet.total).toContainText("₹");

    await spotDetail.confirmBooking();
    await expect(spotDetail.confirmed.reference).not.toBeEmpty();
    await expect(spotDetail.confirmed.qr).toBeVisible();
  });

  test("the confirmed booking appears on the Bookings tab with that reference", async ({
    asDriver,
    spotDetail,
    bookings,
  }) => {
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();
    const ref = await spotDetail.bookFor(BOOKING_HOURS.typical);
    await spotDetail.finishConfirmation();

    await bookings.openFromTab();
    await expect(bookings.el.cardByRef(ref)).toBeVisible();
    expect(await bookings.statusOf(ref)).toMatch(/active/i);
  });

  test("the quoted total is the hourly rate plus the 10% fee", async ({
    asDriver,
    spotDetail,
    api,
  }) => {
    /* Read the real price off the API rather than scraping the card, so
       the arithmetic is checked against the source of truth. */
    const spots = await api.spots();
    const first = spots.data.spots[0];
    if (!first) test.skip(true, "no seeded spots to price");

    await asDriver.el.spotCardById(first!.id).click();
    await spotDetail.waitForLoaded();

    const hours = 3;
    await spotDetail.setHours(hours);
    await spotDetail.startBooking();

    const expected = Math.round(first!.price * hours * 1.1);
    await expect(spotDetail.confirmSheet.total).toContainText(String(expected));
  });

  test("backing out of the confirm sheet books nothing", async ({
    page,
    api,
    driverHome,
    spotDetail,
  }) => {
    /* Deliberately a FRESH account rather than the seeded driver. This
       assertion counts rows, and the suite runs fullyParallel — other
       specs booking as the shared seeded driver would change the count
       underneath it. An account nobody else touches makes "nothing was
       booked" actually mean that. */
    const registered = await api.register(newAccount("driver"));
    expect(registered.ok).toBe(true);
    const token = registered.data.token;

    expect((await api.bookings(token)).data.bookings).toHaveLength(0);

    await injectSession(page, registered.data);
    await driverHome.waitForLoaded();
    await driverHome.openSpotAt(0);
    await spotDetail.waitForLoaded();

    await spotDetail.startBooking();
    await spotDetail.abandonBooking();

    /* Still on the detail screen, and still nothing persisted. */
    await expect(spotDetail.el.screen).toBeVisible();
    expect((await api.bookings(token)).data.bookings).toHaveLength(0);
  });

  test("the duration stepper is clamped to 1..12 hours", async ({
    asDriver,
    spotDetail,
  }) => {
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();

    /* Hammer the lower bound: it must not go below 1. */
    for (let i = 0; i < 6; i += 1) {
      await spotDetail.el.hoursDecrease.click();
    }
    expect(await spotDetail.currentHours()).toBe(1);

    /* And the upper: 12 is the cap. */
    for (let i = 0; i < 16; i += 1) {
      await spotDetail.el.hoursIncrease.click();
    }
    expect(await spotDetail.currentHours()).toBe(12);
  });
});

test.describe("managing a booking", () => {
  test("a driver can cancel and the row reflects it", async ({
    api,
    signIn,
    bookings,
  }) => {
    /* Arrange via the API: this spec is about cancelling, not booking. */
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    if (!spot) test.skip(true, "no seeded spots to book");

    const created = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.typical,
    });
    expect(created.ok).toBe(true);
    const ref = created.data.booking.ref;

    await signIn("driver");
    await bookings.openFromTab();
    await expect(bookings.el.cardByRef(ref)).toBeVisible();

    await bookings.cancelByRef(ref);
    await expect(
      bookings.el.cardByRef(ref).getByTestId(TID.bookingStatus),
    ).toContainText(/cancelled/i, { timeout: 15_000 });

    /* And it really changed server-side, not just on screen. */
    const after = await api.bookings(session.token);
    const row = after.data.bookings.find((b) => b.ref === ref);
    expect(row?.status).toBe("cancelled");
  });

  test("declining the confirmation leaves the booking active", async ({
    api,
    signIn,
    bookings,
  }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    if (!spot) test.skip(true, "no seeded spots to book");

    const created = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.minimum,
    });
    const ref = created.data.booking.ref;

    await signIn("driver");
    await bookings.openFromTab();

    const card = bookings.el.cardByRef(ref);
    await card.waitFor({ state: "visible" });
    await bookings.declineCancelAt(0);

    /* Nothing should have been sent. */
    const after = await api.bookings(session.token);
    expect(after.data.bookings.find((b) => b.ref === ref)?.status).toBe("active");
  });

  test("a brand-new account sees an empty state with a way out", async ({
    page,
    api,
    bookings,
    driverHome,
  }) => {
    /* The state the old recovery suite only screenshotted. A fresh
       account is the honest way to reach it — the seeded driver always
       has bookings. */
    const account = newAccount("driver");
    const registered = await api.register(account);
    expect(registered.ok).toBe(true);

    await injectSession(page, registered.data);
    await bookings.openFromTab();

    await expect(bookings.el.empty).toBeVisible();
    await expect(bookings.el.cards).toHaveCount(0);

    /* The empty state must offer a route back to finding parking, which
       is the specific dead end the old copy had. */
    await bookings.el.empty.getByRole("button", { name: /find parking/i }).click();
    await expect(driverHome.el.screen).toBeVisible();
  });
});

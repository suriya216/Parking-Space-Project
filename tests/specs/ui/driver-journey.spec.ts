/**
 * The driver experience, end to end, as a small number of long journeys
 * instead of one test per feature.
 *
 * This file replaces driver-home.spec.ts, booking.spec.ts,
 * navigation.spec.ts's driver block, profile.spec.ts and most of
 * recovery.spec.ts. Each journey below chains steps that used to each pay
 * for their own sign-in and navigation; the assertions themselves are
 * close to 1:1 with what they replace.
 *
 * The trade, accepted deliberately here: a failure partway through a long
 * journey takes more reading to localise than a single-assertion spec
 * would. What's gained is roughly a third of the setup/signin overhead
 * this suite used to pay three times over (iOS, Android, desktop all run
 * the same specs) for assertions that didn't need their own browser
 * session to prove.
 */

import { TID } from "@shared/testids";
import { CARDS, BOOKING_HOURS, vehicleDraft } from "@fixtures/data.fixture";
import { USERS, expect, injectSession, newAccount, test } from "@fixtures/index";

test.describe("search and location", () => {
  test("search suggests spots and places, and the location panel reflects the device fix and a manual pin", async ({
    asDriver,
    spotDetail,
    api,
    profile,
  }) => {
    const spots = await api.spots();
    const target = spots.data.spots[0];
    if (!target) test.skip(true, "no seeded spots to search for");
    const query = target!.name.split(" ")[0] ?? target!.name;

    await asDriver.searchAndAwaitSuggestions(query);
    await expect(asDriver.el.spotSuggestions.first()).toBeVisible();
    await asDriver.pickSpotSuggestion(0);
    await spotDetail.waitForLoaded();
    await expect(spotDetail.el.name).toContainText(query);
    await spotDetail.goBack();

    const spotCountBefore = await asDriver.spotCount();
    await asDriver.searchAndAwaitSuggestions("a");
    await asDriver.clearSearch();
    await expect(asDriver.el.searchDropdown).toHaveCount(0);
    await expect(asDriver.el.searchInput).toHaveValue("");
    expect(await asDriver.spotCount()).toBe(spotCountBefore);

    /* A query that matches nothing must degrade gracefully, not crash or
       leave an unexplained empty dropdown. */
    await asDriver.search("zzzqqqxyznotaplace");
    await expect(asDriver.el.searchDropdown).toBeVisible({ timeout: 20_000 });
    await expect(
      asDriver.el.placesEmpty.or(asDriver.el.placeSuggestions.first()),
    ).toBeVisible({ timeout: 25_000 });
    await asDriver.clearSearch();

    /* The geolocation in playwright.config.ts is Teynampet (13.0392, 80.2489). */
    await asDriver.waitForMap();
    await expect(asDriver.el.userDot).toHaveCount(1);
    await expect(asDriver.el.pinMarker).toHaveCount(0);
    await expect(asDriver.location.summary).toContainText(/distance from you/i);
    await expect(asDriver.location.coords).toContainText("13.03");
    await expect(asDriver.location.coords).toContainText("80.24");

    const initialCount = await asDriver.spotCount();
    await asDriver.toggleScope();
    await expect(asDriver.location.toggleScope).toContainText(/show nearby only/i);
    expect(await asDriver.spotCount()).toBeGreaterThanOrEqual(initialCount);
    await asDriver.toggleScope();

    /* Pinning a location keeps the device dot AND adds a pin — showing
       only one of the two was the bug this guards. */
    await profile.openFromTab();
    await profile.startPinningLocation();
    await expect(asDriver.location.pickingBanner).toBeVisible({ timeout: 20_000 });
    await asDriver.tapEmptyMapArea();
    await expect(asDriver.el.pinMarker).toHaveCount(1, { timeout: 20_000 });
    await expect(asDriver.el.userDot).toHaveCount(1);
    await expect(asDriver.location.summary).toContainText(/pinned|Showing parking near/i);

    await asDriver.clearPinnedLocation();
    await expect(asDriver.el.pinMarker).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("booking a spot", () => {
  test("a driver can book, see the right total and QR, and find it on the Bookings tab", async ({
    asDriver,
    spotDetail,
    bookings,
    api,
    page,
  }) => {
    const spots = await api.spots();
    const first = spots.data.spots[0];
    if (!first) test.skip(true, "no seeded spots to book");

    await asDriver.el.spotCardById(first!.id).click();
    await spotDetail.waitForLoaded();

    const hours = 3;
    await spotDetail.setHours(hours);
    expect(await spotDetail.currentHours()).toBe(hours);
    await spotDetail.startBooking();

    const expected = Math.round(first!.price * hours * 1.1);
    await expect(spotDetail.confirmSheet.total).toContainText(String(expected));

    await spotDetail.confirmBooking();
    await expect(spotDetail.confirmed.reference).not.toBeEmpty();
    await expect(spotDetail.confirmed.qr).toBeVisible();

    /* The QR is a real, scannable image carrying the booking details, not
       a decorative pixel pattern. */
    const qrImage = page.getByRole("img", { name: /QR code for booking PS-/i });
    await qrImage.waitFor({ state: "visible", timeout: 20_000 });
    const rendered = await qrImage.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { loaded: img.complete && img.naturalWidth > 0 };
    });
    expect(rendered.loaded).toBe(true);
    await page.getByRole("button", { name: /What's in this code\?/i }).click();
    const encoded = (await page.locator("pre").first().textContent()) ?? "";
    for (const field of ["ParkSpace booking PS-", "Spot:", "Date:", "Paid: INR"]) {
      expect(encoded, `QR payload should encode ${field}`).toContain(field);
    }

    const ref = (await spotDetail.confirmed.reference.textContent()) ?? "";
    await spotDetail.finishConfirmation();

    await bookings.openFromTab();
    await expect(bookings.el.cardByRef(ref)).toBeVisible();
    expect(await bookings.statusOf(ref)).toMatch(/active/i);
  });

  test("backing out books nothing, and the duration stepper is clamped to 1..12", async ({
    page,
    api,
    driverHome,
    spotDetail,
  }) => {
    /* A fresh account: this counts rows, and the suite runs fullyParallel. */
    const registered = await api.register(newAccount("driver"));
    const token = registered.data.token;
    expect((await api.bookings(token)).data.bookings).toHaveLength(0);

    await injectSession(page, registered.data);
    await driverHome.waitForLoaded();
    await driverHome.openSpotAt(0);
    await spotDetail.waitForLoaded();

    await spotDetail.startBooking();
    await spotDetail.abandonBooking();
    await expect(spotDetail.el.screen).toBeVisible();
    expect((await api.bookings(token)).data.bookings).toHaveLength(0);

    for (let i = 0; i < 6; i += 1) await spotDetail.el.hoursDecrease.click();
    expect(await spotDetail.currentHours()).toBe(1);
    for (let i = 0; i < 16; i += 1) await spotDetail.el.hoursIncrease.click();
    expect(await spotDetail.currentHours()).toBe(12);
  });
});

test.describe("managing a booking", () => {
  test("a driver can cancel one booking and decline cancelling another", async ({
    api,
    signIn,
    bookings,
  }) => {
    const session = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const spots = await api.spots();
    const spot = spots.data.spots[0];
    if (!spot) test.skip(true, "no seeded spots to book");

    const toCancel = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.typical,
    });
    const toKeep = await api.createBooking(session.token, {
      spotId: spot!.id,
      hours: BOOKING_HOURS.minimum,
    });
    const cancelRef = toCancel.data.booking.ref;
    const keepRef = toKeep.data.booking.ref;

    await signIn("driver");
    await bookings.openFromTab();

    await bookings.cancelByRef(cancelRef);
    await expect(
      bookings.el.cardByRef(cancelRef).getByTestId(TID.bookingStatus),
    ).toContainText(/cancelled/i, { timeout: 15_000 });

    await bookings.declineCancelAt(0);

    const after = await api.bookings(session.token);
    expect(after.data.bookings.find((b) => b.ref === cancelRef)?.status).toBe("cancelled");
    expect(after.data.bookings.find((b) => b.ref === keepRef)?.status).toBe("active");
  });
});

test.describe("favourites and empty states", () => {
  test("a fresh account sees honest empty states, and favouriting a spot puts it on Saved", async ({
    page,
    api,
    driverHome,
    bookings,
    profile,
  }) => {
    const registered = await api.register(newAccount("driver"));
    await injectSession(page, registered.data);
    await driverHome.waitForLoaded();

    await bookings.openFromTab();
    await expect(bookings.el.empty).toContainText(/No bookings yet/i);
    await bookings.el.empty.getByRole("button", { name: /find parking/i }).click();
    await expect(driverHome.el.screen).toBeVisible();

    await bookings.openSavedFromTab();
    await expect(bookings.saved.empty).toContainText(/Nothing saved yet/i);

    await profile.openFromTab();
    await profile.openVehicles();
    await expect(page.getByTestId(TID.vehiclesEmpty)).toBeVisible();
    await profile.closeSheet();

    await driverHome.goToHome();
    await expect(driverHome.el.spotCards.first()).toBeVisible();
    await driverHome.toggleFavouriteAt(0);

    await bookings.openSavedFromTab();
    await expect(bookings.saved.cards).toHaveCount(1, { timeout: 20_000 });
    await bookings.saved.cards.first().getByRole("button", { name: /Remove from saved/i }).click();
    await expect(bookings.saved.empty).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("profile, vehicles, cards and settings", () => {
  test("a driver can edit their profile, manage vehicles and cards, and change units", async ({
    page,
    api,
    profile,
    driverHome,
  }) => {
    const registered = await api.register(newAccount("driver"));
    const session = registered.data;
    await injectSession(page, session);

    await profile.openFromTab();
    await expect(profile.el.name).toHaveText(session.user.name);
    await expect(profile.el.email).toHaveText(session.user.email);

    await profile.openEditProfile();
    const phone = "+91 98400 11223";
    await profile.saveProfile({ phone });
    await expect(async () => {
      const me = await api.me(session.token);
      expect(me.data.user.phone).toBe(phone);
    }).toPass({ timeout: 15_000 });
    /* Saving leaves the sheet open (it shows "Profile saved." in place),
       so it has to be closed explicitly before reopening it below. */
    await profile.closeSheet();

    const other = await api.register(newAccount("driver"));
    await profile.openEditProfile();
    await profile.saveProfile({ email: other.data.user.email });
    await expect(profile.edit.error).toBeVisible();
    await expect(profile.edit.error).not.toContainText("409");
    await profile.closeSheet();

    await profile.openVehicles();
    const vehicle = vehicleDraft();
    const second = vehicleDraft();
    await profile.addVehicle(vehicle);
    await profile.addVehicle(second);
    await expect(profile.vehicles.rows).toHaveCount(2);
    await expect(profile.vehicles.rowByPlate(vehicle.plate)).toBeVisible();
    await profile.vehicles.deleteButtons.first().click();
    await expect(profile.vehicles.rows).toHaveCount(1);
    await profile.closeSheet();

    await profile.openPaymentMethods();
    await profile.addCard(CARDS.validVisa.number, CARDS.validVisa.expiry);
    await expect(profile.cards.rows).toHaveCount(1, { timeout: 15_000 });
    const rowText = (await profile.cards.rows.first().textContent()) ?? "";
    expect(rowText).toContain(CARDS.validVisa.last4);
    expect(rowText).not.toContain(CARDS.validVisa.number);

    await profile.addCard(CARDS.luhnFailure.number, CARDS.luhnFailure.expiry);
    await expect(profile.cards.error).toBeVisible();
    await expect(profile.cards.rows).toHaveCount(1);
    await profile.closeSheet();

    const METRIC = /\d+(\.\d+)?\s?(m|km)\b/i;
    const IMPERIAL = /\d+(\.\d+)?\s?(ft|mi)\b/i;
    await driverHome.goToHome();
    await driverHome.waitForLoaded();
    const card = driverHome.el.spotCards.first();
    await expect(card).toHaveText(METRIC);

    await profile.openFromTab();
    await profile.openSettings();
    await profile.setUnits("mi");
    await driverHome.goToHome();
    await expect(card).toHaveText(IMPERIAL, { timeout: 20_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await driverHome.waitForLoaded();
    await expect(driverHome.el.spotCards.first()).toHaveText(IMPERIAL, { timeout: 20_000 });

    await profile.openFromTab();
    await profile.openSafety();
    await expect(profile.safety.sheet).toContainText(/SQLite|stored/i);
  });
});

test.describe("navigation and recovering from errors", () => {
  test("Back closes views instead of leaving the app, across the tabs, a sheet, pin-picking and the booking confirmation", async ({
    asDriver,
    page,
    bookings,
    profile,
    spotDetail,
  }) => {
    const stillInApp = async () => {
      await expect(page.locator("#root")).toBeVisible();
      expect(page.url()).toContain("localhost");
    };

    await asDriver.goToBookings();
    await expect(page.getByTestId(TID.bookingsScreen)).toBeVisible();
    await page.goBack();
    await expect(asDriver.el.spotList).toBeVisible({ timeout: 20_000 });
    await stillInApp();

    await bookings.openSavedFromTab();
    await asDriver.goToHome();
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();
    await page.goBack();
    await expect(spotDetail.el.screen).toHaveCount(0, { timeout: 20_000 });
    await stillInApp();
    await expect(asDriver.el.spotList).toBeVisible({ timeout: 20_000 });

    await profile.openFromTab();
    await profile.openVehicles();
    await expect(profile.vehicles.sheet).toBeVisible();
    await page.goBack();
    await expect(profile.vehicles.sheet).toHaveCount(0, { timeout: 20_000 });
    await stillInApp();

    /* Closing that sheet left the Profile tab active — back to Home for
       the map-dependent steps below. */
    await asDriver.goToHome();
    await asDriver.waitForMap();
    await profile.openFromTab();
    await profile.startPinningLocation();
    await expect(asDriver.location.pickingBanner).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await expect(asDriver.location.pickingBanner).toHaveCount(0, { timeout: 20_000 });
    await stillInApp();
    await expect(asDriver.el.map).toBeVisible();

    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();
    await spotDetail.bookFor(1);
    await expect(spotDetail.confirmed.screen).toBeVisible();
    await page.goBack();
    await expect(spotDetail.confirmed.screen).toHaveCount(0, { timeout: 20_000 });
    await stillInApp();
  });

  test("a failed spots request explains itself and recovers on retry, without ever showing a raw status code", async ({
    page,
    signIn,
    driverHome,
    bookings,
  }) => {
    await signIn("driver");
    await driverHome.waitForLoaded();

    await page.route("**/api/spots**", (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(driverHome.el.errorState).toBeVisible({ timeout: 30_000 });

    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toMatch(/Failed to fetch/i);
    expect(body).toMatch(/Can't reach ParkSpace|appear to be offline/i);
    await expect(driverHome.el.retry).toBeVisible();

    await page.unroute("**/api/spots**");
    await driverHome.el.retry.click();
    await expect(driverHome.el.spotCards.first()).toBeVisible({ timeout: 30_000 });
    await expect(driverHome.el.errorState).toHaveCount(0);

    await page.route("**/api/bookings**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await bookings.openFromTab();
    await page.getByRole("button", { name: /^Refresh$/ }).click();
    const bookingsBody = page.locator("body");
    await expect(bookingsBody).toContainText(/went wrong on our side/i, { timeout: 20_000 });
    expect((await bookingsBody.textContent()) ?? "").not.toMatch(/\b500\b/);
    await page.unroute("**/api/bookings**");
  });
});

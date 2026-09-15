/**
 * Driver home — ports e2e/ui-features.test.mjs: the search dropdown, the
 * device-dot vs pinned-location distinction, and the QR contents.
 */

import { BOOKING_HOURS } from "@fixtures/data.fixture";
import { expect, injectSession, newAccount, test } from "@fixtures/index";

test.describe("search", () => {
  test("typing suggests matching spots, and picking one opens it", async ({
    asDriver,
    spotDetail,
    api,
  }) => {
    /* Derive the query from a real seeded listing rather than hard-coding
       "Selva" the way the old suite did — a reseed can't break this. */
    const spots = await api.spots();
    const target = spots.data.spots[0];
    if (!target) test.skip(true, "no seeded spots to search for");

    const query = target!.name.split(" ")[0] ?? target!.name;

    await asDriver.searchAndAwaitSuggestions(query);
    await expect(asDriver.el.spotSuggestions.first()).toBeVisible();

    await asDriver.pickSpotSuggestion(0);
    await spotDetail.waitForLoaded();
    await expect(spotDetail.el.name).toContainText(query);
  });

  test("clearing the search closes the dropdown", async ({ asDriver }) => {
    const spotCountBefore = await asDriver.spotCount();

    await asDriver.searchAndAwaitSuggestions("a");
    await asDriver.clearSearch();

    await expect(asDriver.el.searchDropdown).toHaveCount(0);
    await expect(asDriver.el.searchInput).toHaveValue("");
    expect(await asDriver.spotCount()).toBe(spotCountBefore);
  });

  test("a query with no matches degrades gracefully", async ({ asDriver }) => {
    /* Place lookup needs 3+ chars and is debounced; it may also be
       unreachable behind a proxy. Either a "no matches" line or real
       results is acceptable — what must NOT happen is a crash or an
       empty dropdown with no explanation. */
    await asDriver.search("zzzqqqxyznotaplace");
    await expect(asDriver.el.searchDropdown).toBeVisible({ timeout: 20_000 });

    await expect(
      asDriver.el.placesEmpty.or(asDriver.el.placeSuggestions.first()),
    ).toBeVisible({ timeout: 25_000 });
  });
});

test.describe("location", () => {
  test("the device dot is shown and no pin until one is set", async ({ asDriver }) => {
    await asDriver.waitForMap();

    await expect(asDriver.el.userDot).toHaveCount(1);
    await expect(asDriver.el.pinMarker).toHaveCount(0);
    await expect(asDriver.location.summary).toContainText(/distance from you/i);
  });

  test("the panel reports the coordinates it is using", async ({ asDriver }) => {
    /* The geolocation in playwright.config.ts is Teynampet, 13.0392 /
       80.2489, so the panel must show that rather than a fallback. */
    await expect(asDriver.location.coords).toContainText("13.03");
    await expect(asDriver.location.coords).toContainText("80.24");
  });

  test("pinning a location shows the pin alongside the device dot", async ({
    asDriver,
    profile,
  }) => {
    await asDriver.waitForMap();
    await expect(asDriver.el.userDot).toHaveCount(1);
    await expect(asDriver.el.pinMarker).toHaveCount(0);

    await profile.openFromTab();
    await profile.startPinningLocation();

    /* Back on the map, in picking mode. */
    await expect(asDriver.location.pickingBanner).toBeVisible({ timeout: 20_000 });

    /* A marker-free point, not a fixed fraction — a price marker under
       the tap opens its popup and swallows the pick. */
    await asDriver.tapEmptyMapArea();

    /* Both markers now: the device's own fix AND the pin. Showing only
       one is the bug this test exists for — a user who pinned a location
       must still be able to see where the device thinks they are. */
    await expect(asDriver.el.pinMarker).toHaveCount(1, { timeout: 20_000 });
    await expect(asDriver.el.userDot).toHaveCount(1);
    await expect(asDriver.location.summary).toContainText(/pinned|Showing parking near/i);

    /* And it can be handed back to the device. */
    await asDriver.clearPinnedLocation();
    await expect(asDriver.el.pinMarker).toHaveCount(0, { timeout: 20_000 });
  });

  test("scope can be toggled between nearby and all spots", async ({ asDriver }) => {
    await expect(asDriver.location.toggleScope).toBeVisible();
    const initial = await asDriver.spotCount();

    await asDriver.toggleScope();
    await expect(asDriver.location.toggleScope).toContainText(/show nearby only/i);

    /* Showing everything can only widen the list, never narrow it. */
    expect(await asDriver.spotCount()).toBeGreaterThanOrEqual(initial);
  });
});

test.describe("favourites", () => {
  test("hearting a spot puts it on the Saved tab", async ({
    page,
    api,
    driverHome,
    bookings,
  }) => {
    /* A fresh account: favourites persist in SQLite and the seed does not
       clear them, so using the shared driver would leak state into other
       specs running in parallel. */
    const registered = await api.register(newAccount("driver"));
    await injectSession(page, registered.data);
    await driverHome.waitForLoaded();

    await expect(driverHome.el.spotCards.first()).toBeVisible();
    await driverHome.toggleFavouriteAt(0);

    await bookings.openSavedFromTab();
    await expect(bookings.saved.cards).toHaveCount(1, { timeout: 20_000 });

    /* And un-hearting removes it again. */
    await bookings.saved.cards
      .first()
      .getByRole("button", { name: /Remove from saved/i })
      .click();
    await expect(bookings.saved.empty).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("booking QR", () => {
  test("encodes the details an attendant would need", async ({
    asDriver,
    spotDetail,
    page,
  }) => {
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();
    await spotDetail.bookFor(BOOKING_HOURS.minimum);

    /* A real, scannable image — the code this replaced was a hard-coded
       pixel pattern that decoded to nothing. */
    const qrImage = page.getByRole("img", { name: /QR code for booking PS-/i });
    await qrImage.waitFor({ state: "visible", timeout: 20_000 });

    const rendered = await qrImage.evaluate((element) => {
      const img = element as HTMLImageElement;
      return { loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth };
    });
    expect(rendered.loaded).toBe(true);
    expect(rendered.width).toBeGreaterThan(100);

    await page.getByRole("button", { name: /What's in this code\?/i }).click();

    const encoded = (await page.locator("pre").first().textContent()) ?? "";
    for (const field of [
      "ParkSpace booking PS-",
      "Spot:",
      "Address:",
      "Type:",
      "Date:",
      "Time:",
      "Paid: INR",
      "Driver:",
      "Location:",
      "Map: https://",
    ]) {
      expect(encoded, `QR payload should encode ${field}`).toContain(field);
    }
  });
});

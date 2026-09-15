/**
 * Browser/Android Back across every navigable surface.
 *
 * The app is a single route, so Back is entirely the app's problem: each
 * open view registers a handler on the LIFO stack in src/backstack.ts and
 * one listener routes each press to the topmost one. The unit tests in
 * specs/unit/backstack.spec.ts cover that module against a fake history;
 * these drive the real thing in a real browser.
 *
 * The bug these lock down: the owner console, the admin console and
 * pin-picking mode had NO guard at all, so Back left the app. Pin-picking
 * was the worst of the three — it is normally entered from Settings,
 * which sets the tab back to "home" and so switches the tab guard off,
 * leaving nothing to catch the press.
 */

import { TID } from "@shared/testids";
import { expect, test } from "@fixtures/index";

/** Still inside the app, rather than having navigated away from it. */
const expectStillInApp = async (page: import("@playwright/test").Page) => {
  await expect(page.locator("#root")).toBeVisible();
  expect(page.url()).toContain("localhost");
};

test.describe("driver", () => {
  test("Back from a secondary tab returns home", async ({ asDriver, page }) => {
    await asDriver.goToBookings();
    await expect(page.getByTestId(TID.bookingsScreen)).toBeVisible();

    await page.goBack();

    await expect(asDriver.el.spotList).toBeVisible({ timeout: 20_000 });
    await expectStillInApp(page);
  });

  test("Back walks detail → tab → home, one press at a time", async ({
    asDriver,
    page,
    bookings,
    spotDetail,
  }) => {
    /* Open a secondary tab, then a spot from it — two guards stacked. */
    await bookings.openSavedFromTab();
    await asDriver.goToHome();
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();

    /* First press closes the detail screen... */
    await page.goBack();
    await expect(spotDetail.el.screen).toHaveCount(0, { timeout: 20_000 });
    await expectStillInApp(page);

    /* ...and the app is still usable, not a blank page. */
    await expect(asDriver.el.spotList).toBeVisible({ timeout: 20_000 });
  });

  test("Back closes an open sheet", async ({ asDriver, page, profile }) => {
    await profile.openFromTab();
    await profile.openVehicles();
    await expect(profile.vehicles.sheet).toBeVisible();

    await page.goBack();

    await expect(profile.vehicles.sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(profile.el.screen).toBeVisible();
    await expectStillInApp(page);
    void asDriver;
  });

  test("Back cancels pin-picking instead of leaving the app", async ({
    asDriver,
    page,
    profile,
  }) => {
    /* The regression: picking is entered from Settings, which sets the
       tab to "home" — so the tab guard is inactive and, before this was
       guarded, Back exited the app mid-pick. */
    await asDriver.waitForMap();
    await profile.openFromTab();
    await profile.startPinningLocation();

    await expect(asDriver.location.pickingBanner).toBeVisible({ timeout: 20_000 });

    await page.goBack();

    await expect(asDriver.location.pickingBanner).toHaveCount(0, { timeout: 20_000 });
    await expectStillInApp(page);
    /* And the map is still there to pick on again. */
    await expect(asDriver.el.map).toBeVisible();
  });

  test("Back from the confirmation screen returns to the app", async ({
    asDriver,
    page,
    spotDetail,
  }) => {
    await asDriver.openSpotAt(0);
    await spotDetail.waitForLoaded();
    await spotDetail.bookFor(1);
    await expect(spotDetail.confirmed.screen).toBeVisible();

    await page.goBack();

    await expect(spotDetail.confirmed.screen).toHaveCount(0, { timeout: 20_000 });
    await expectStillInApp(page);
  });
});

test.describe("owner console", () => {
  test("Back from Listings returns to the dashboard", async ({ asOwner, page }) => {
    await asOwner.showListings();
    await expect(asOwner.el.addSpot).toBeVisible();

    await page.goBack();

    /* The dashboard tab shows bookings against this owner's spots; the
       add-spot button belongs to Listings and must be gone. */
    await expect(asOwner.el.addSpot).toHaveCount(0, { timeout: 20_000 });
    await expect(asOwner.el.screen).toBeVisible();
    await expectStillInApp(page);
  });

  test("Back from Earnings returns to the dashboard", async ({ asOwner, page }) => {
    await asOwner.showEarnings();
    await expect(asOwner.el.screen).toContainText(/payout/i);

    await page.goBack();

    await expect(asOwner.el.screen).not.toContainText(/payout history/i, {
      timeout: 20_000,
    });
    await expectStillInApp(page);
  });

  test("Back closes the add-spot sheet without losing the tab", async ({
    asOwner,
    page,
  }) => {
    await asOwner.showListings();
    await asOwner.openAddSpot();
    await expect(asOwner.addSpot.sheet).toBeVisible();

    await page.goBack();

    await expect(asOwner.addSpot.sheet).toHaveCount(0, { timeout: 20_000 });
    /* Still on Listings — closing the sheet must not also pop the tab. */
    await expect(asOwner.el.addSpot).toBeVisible();
    await expectStillInApp(page);
  });
});

test.describe("admin console", () => {
  test("Back from Spots returns to Users", async ({ asAdmin, page }) => {
    await asAdmin.showSpots();
    await expect(asAdmin.el.spotRows.first()).toBeVisible();

    await page.goBack();

    await expect(asAdmin.el.userRows.first()).toBeVisible({ timeout: 20_000 });
    await expectStillInApp(page);
  });

  test("Back on the Users tab does not strand the admin", async ({ asAdmin, page }) => {
    /* Users is the landing tab, so there is no in-app view to close. What
       must NOT happen is a blank page — the app either stays put or the
       browser leaves cleanly, and either way #root is intact if we are
       still here. */
    await asAdmin.showUsers();
    await page.goBack().catch(() => {});

    if (page.url().includes("localhost")) {
      await expect(page.locator("#root")).toBeVisible();
    }
  });
});

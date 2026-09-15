/**
 * Owner dashboard — ports the owner leg of e2e/drive.mjs, including the
 * duplicate-listing rejection that suite screenshotted.
 */

import { TID } from "@shared/testids";
import { spotDraft } from "@fixtures/data.fixture";
import { expect, injectSession, newAccount, test } from "@fixtures/index";

test.describe("owner dashboard", () => {
  test("lands on the dashboard with revenue, bookings and listing counts", async ({
    asOwner,
  }) => {
    await expect(asOwner.el.screen).toBeVisible();
    await expect(asOwner.el.stats).toHaveCount(3);
    await expect(asOwner.el.statByLabel("Revenue")).toBeVisible();
    await expect(asOwner.el.statByLabel("Bookings")).toBeVisible();
    await expect(asOwner.el.statByLabel("Listings")).toBeVisible();
  });

  test("an owner does not get the driver tab bar", async ({ asOwner, page }) => {
    /* Role separation: the owner console is its own surface, not the
       driver app with extra buttons. */
    await expect(asOwner.el.screen).toBeVisible();
    await expect(page.getByTestId(TID.tabBar)).toHaveCount(0);
  });

  test("the listings and earnings tabs both render", async ({ asOwner }) => {
    await asOwner.showListings();
    await expect(asOwner.el.addSpot).toBeVisible();

    await asOwner.showEarnings();
    await expect(asOwner.el.screen).toContainText(/payout/i);
  });

  test("signing out returns to the sign-in screen", async ({ asOwner, authPage }) => {
    await asOwner.el.signOut.click();
    await expect(authPage.el.screen).toBeVisible();
  });
});

test.describe("creating a listing", () => {
  test("a new listing appears in the owner's own list", async ({
    page,
    api,
    ownerDashboard,
  }) => {
    /* A fresh owner so the listing count is this spec's alone — the
       seeded owner is shared with the other specs running in parallel. */
    const registered = await api.register(newAccount("owner"));
    await injectSession(page, registered.data);
    await ownerDashboard.waitForLoaded();

    await ownerDashboard.showListings();
    await expect(ownerDashboard.el.listingRows).toHaveCount(0);

    const draft = spotDraft();
    await ownerDashboard.createSpot(draft);

    await expect(ownerDashboard.el.listingByName(draft.name)).toBeVisible({
      timeout: 20_000,
    });
    await expect(ownerDashboard.el.listingRows).toHaveCount(1);
  });

  test("a duplicate name and address is rejected with a readable message", async ({
    page,
    api,
    ownerDashboard,
  }) => {
    const registered = await api.register(newAccount("owner"));
    await injectSession(page, registered.data);
    await ownerDashboard.waitForLoaded();
    await ownerDashboard.showListings();

    const draft = spotDraft();
    await ownerDashboard.createSpot(draft);
    await expect(ownerDashboard.el.listingByName(draft.name)).toBeVisible({
      timeout: 20_000,
    });

    /* spots has UNIQUE (name, address); the second attempt must fail and
       say so, leaving the sheet open so the user can edit it. */
    await ownerDashboard.createSpotExpectingFailure(draft);

    await expect(ownerDashboard.addSpot.error).toBeVisible();
    await expect(ownerDashboard.addSpot.sheet).toBeVisible();
    await expect(ownerDashboard.addSpot.error).not.toContainText("409");
  });

  test("a listing can be deleted again", async ({ page, api, ownerDashboard }) => {
    const registered = await api.register(newAccount("owner"));
    await injectSession(page, registered.data);
    await ownerDashboard.waitForLoaded();
    await ownerDashboard.showListings();

    const draft = spotDraft();
    await ownerDashboard.createSpot(draft);
    await expect(ownerDashboard.el.listingByName(draft.name)).toBeVisible({
      timeout: 20_000,
    });

    await ownerDashboard.deleteListingByName(draft.name);
    await expect(ownerDashboard.el.listingRows).toHaveCount(0);
  });

  test("a new listing starts unverified", async ({ page, api, ownerDashboard }) => {
    const registered = await api.register(newAccount("owner"));
    await injectSession(page, registered.data);
    await ownerDashboard.waitForLoaded();
    await ownerDashboard.showListings();

    const draft = spotDraft();
    await ownerDashboard.createSpot(draft);

    /* Verification is an admin action — an owner cannot self-certify. */
    await expect(ownerDashboard.el.listingByName(draft.name)).toContainText(
      /pending/i,
      { timeout: 20_000 },
    );
  });

  test("the new listing is visible to drivers too", async ({
    page,
    api,
    ownerDashboard,
  }) => {
    const registered = await api.register(newAccount("owner"));
    await injectSession(page, registered.data);
    await ownerDashboard.waitForLoaded();
    await ownerDashboard.showListings();

    const draft = spotDraft();
    await ownerDashboard.createSpot(draft);
    await expect(ownerDashboard.el.listingByName(draft.name)).toBeVisible({
      timeout: 20_000,
    });

    /* Check through the API rather than signing in as a driver: the
       question is whether it reached the public list at all. */
    const spots = await api.spots();
    expect(spots.data.spots.map((s) => s.name)).toContain(draft.name);
  });
});

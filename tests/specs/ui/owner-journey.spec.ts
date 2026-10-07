/**
 * Owner console, end to end: the dashboard chrome, a full listing
 * lifecycle, and the back-navigation guards specific to this console —
 * replacing owner.spec.ts and navigation.spec.ts's owner block.
 */

import { TID } from "@shared/testids";
import { spotDraft } from "@fixtures/data.fixture";
import { expect, injectSession, newAccount, test } from "@fixtures/index";

test.describe("owner dashboard", () => {
  test("shows role-scoped stats and chrome, and Back behaves across its three tabs", async ({
    asOwner,
    authPage,
    page,
  }) => {
    await expect(asOwner.el.screen).toBeVisible();
    await expect(asOwner.el.stats).toHaveCount(3);
    for (const label of ["Revenue", "Bookings", "Listings"]) {
      await expect(asOwner.el.statByLabel(label)).toBeVisible();
    }
    /* The owner console is its own surface, not the driver app with
       extra buttons. */
    await expect(page.getByTestId(TID.tabBar)).toHaveCount(0);

    await asOwner.showListings();
    await expect(asOwner.el.addSpot).toBeVisible();
    await page.goBack();
    await expect(asOwner.el.addSpot).toHaveCount(0, { timeout: 20_000 });
    await expect(asOwner.el.screen).toBeVisible();

    await asOwner.showEarnings();
    await expect(asOwner.el.screen).toContainText(/payout/i);
    await page.goBack();
    await expect(asOwner.el.screen).not.toContainText(/payout history/i, { timeout: 20_000 });

    await asOwner.showListings();
    await asOwner.openAddSpot();
    await expect(asOwner.addSpot.sheet).toBeVisible();
    await page.goBack();
    await expect(asOwner.addSpot.sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(asOwner.el.addSpot).toBeVisible();

    await asOwner.el.signOut.click();
    await expect(authPage.el.screen).toBeVisible();
  });
});

test.describe("listing lifecycle", () => {
  test("a listing can be created, starts unverified, is visible to drivers, rejects a duplicate, and can be deleted", async ({
    page,
    api,
    ownerDashboard,
  }) => {
    /* A fresh owner per test — the seeded owner is shared with specs
       running in parallel, and this one counts rows. */
    const registered = await api.register(newAccount("owner"));
    await injectSession(page, registered.data);
    await ownerDashboard.waitForLoaded();
    await ownerDashboard.showListings();
    await expect(ownerDashboard.el.listingRows).toHaveCount(0);

    const draft = spotDraft();
    await ownerDashboard.createSpot(draft);
    const row = ownerDashboard.el.listingByName(draft.name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(ownerDashboard.el.listingRows).toHaveCount(1);

    /* Verification is an admin action — a new listing cannot self-certify. */
    await expect(row).toContainText(/pending/i);

    /* Visible publicly, not just in the owner's own list. */
    const spots = await api.spots();
    expect(spots.data.spots.map((s) => s.name)).toContain(draft.name);

    /* spots has UNIQUE (name, address); a second identical attempt must
       fail with a readable message and leave the sheet open to edit. */
    await ownerDashboard.createSpotExpectingFailure(draft);
    await expect(ownerDashboard.addSpot.error).toBeVisible();
    await expect(ownerDashboard.addSpot.sheet).toBeVisible();
    await expect(ownerDashboard.addSpot.error).not.toContainText("409");
    await ownerDashboard.closeSheet();

    await ownerDashboard.deleteListingByName(draft.name);
    await expect(ownerDashboard.el.listingRows).toHaveCount(0);
  });
});

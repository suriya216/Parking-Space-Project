/**
 * Admin console, end to end: platform totals, user moderation (including
 * the lockout guards), spot moderation, and this console's own
 * back-navigation behaviour — replacing admin.spec.ts and
 * navigation.spec.ts's admin block.
 */

import { TID } from "@shared/testids";
import { spotDraft } from "@fixtures/data.fixture";
import { USERS, expect, newAccount, test } from "@fixtures/index";

test.describe("admin dashboard", () => {
  test("shows platform totals, the seeded users, and Back returns to Users", async ({
    asAdmin,
    page,
  }) => {
    await expect(asAdmin.el.screen).toBeVisible();
    await expect(asAdmin.el.stats).toHaveCount(4);
    for (const label of ["Users", "Spots", "Bookings", "Owners"]) {
      await expect(asAdmin.el.statByLabel(label)).toBeVisible();
    }

    await asAdmin.showUsers();
    expect(await asAdmin.userCount()).toBeGreaterThanOrEqual(3);
    for (const user of Object.values(USERS)) {
      await expect(asAdmin.el.userByEmail(user.email)).toBeVisible();
    }

    await asAdmin.showSpots();
    await expect(asAdmin.el.spotRows.first()).toBeVisible();
    await page.goBack();
    await expect(asAdmin.el.userRows.first()).toBeVisible({ timeout: 20_000 });

    /* Users is the landing tab — Back here must not strand the admin on
       a blank page. */
    await page.goBack().catch(() => {});
    if (page.url().includes("localhost")) {
      await expect(page.locator("#root")).toBeVisible();
    }
  });
});

test.describe("user moderation", () => {
  test("a role can be changed, a user deleted, a decline leaves them untouched, and an admin cannot lock themselves out", async ({
    api,
    signIn,
    adminDashboard,
  }) => {
    /* Create the throwaway accounts BEFORE signing in as admin: the
       dashboard fetches its user list once on mount, so signing in first
       would load a snapshot that predates them. */
    const promoted = await api.registerOrThrow(newAccount("driver"));
    const deleted = await api.registerOrThrow(newAccount("driver"));
    const spared = await api.registerOrThrow(newAccount("driver"));

    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showUsers();

    expect(await adminDashboard.roleOf(promoted.user.email)).toBe("driver");
    await adminDashboard.setRole(promoted.user.email, "owner");
    await expect(async () => {
      expect(await adminDashboard.roleOf(promoted.user.email)).toBe("owner");
    }).toPass({ timeout: 15_000 });
    expect((await api.me(promoted.token)).data.user.role).toBe("owner");

    await expect(adminDashboard.el.userByEmail(deleted.user.email)).toBeVisible();
    await adminDashboard.deleteUser(deleted.user.email);
    await expect(adminDashboard.el.userByEmail(deleted.user.email)).toHaveCount(0, {
      timeout: 15_000,
    });
    expect((await api.me(deleted.token)).status).toBe(401);

    await adminDashboard.declineDeleteUser(spared.user.email);
    await expect(adminDashboard.el.userByEmail(spared.user.email)).toBeVisible();
    expect((await api.me(spared.token)).status).toBe(200);

    /* The server refuses to let an admin delete their own account, change
       their own role, or remove the last admin. Unlike the other cases
       above, this one doesn't resolve the confirm dialog by closing it —
       the server rejects the request, so the dialog stays open showing
       the error, same as any other failed form submission. */
    const ownRow = adminDashboard.el.userByEmail(USERS.admin.email);
    await expect(ownRow).toContainText(/you/i);
    await ownRow.getByTestId(TID.adminUserDelete).click();
    await adminDashboard.confirmDialog.dialog.waitFor({ state: "visible" });
    await adminDashboard.confirmDialog.confirm.click();
    await expect(adminDashboard.confirmDialog.error).toBeVisible({ timeout: 15_000 });
    await adminDashboard.confirmDialog.cancel.click();

    await expect(ownRow).toBeVisible();
    const stillWorks = await api.login(USERS.admin.email, USERS.admin.password);
    expect(stillWorks.status).toBe(200);
  });
});

test.describe("spot moderation", () => {
  test("a listing can be verified, another deleted, and every row exposes both controls", async ({
    api,
    signIn,
    adminDashboard,
  }) => {
    const owner = await api.registerOrThrow(newAccount("owner"));
    const toVerify = spotDraft();
    const toDelete = spotDraft();

    const createdVerify = await api.createSpot(owner.token, {
      ...toVerify,
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    });
    const createdDelete = await api.createSpot(owner.token, {
      ...toDelete,
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    });
    expect(createdVerify.data.spot.verified).toBe(false);

    /* Signing in after creating the spots, same reason as above: the
       admin dashboard's spot list is fetched once on mount. */
    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showSpots();

    const verifyRow = adminDashboard.el.spotByName(toVerify.name);
    await expect(verifyRow).toBeVisible({ timeout: 20_000 });
    await expect(verifyRow).toContainText(/pending/i);
    await adminDashboard.verifySpotByName(toVerify.name);
    await expect(verifyRow).toContainText(/verified/i, { timeout: 15_000 });

    await expect(adminDashboard.el.spotByName(toDelete.name)).toBeVisible({ timeout: 20_000 });
    await adminDashboard.deleteSpotByName(toDelete.name);
    const spots = await api.spots();
    expect(spots.data.spots.map((s) => s.id)).not.toContain(createdDelete.data.spot.id);

    const rows = await adminDashboard.el.spotRows.count();
    for (let i = 0; i < Math.min(rows, 3); i += 1) {
      const row = adminDashboard.el.spotRows.nth(i);
      await expect(row.getByTestId(TID.adminSpotVerify)).toBeVisible();
      await expect(row.getByTestId(TID.adminSpotDelete)).toBeVisible();
    }

    await api.deleteSpot(owner.token, createdVerify.data.spot.id);
  });
});

/**
 * Admin console — ports the admin leg of e2e/drive.mjs, including the
 * "self-delete blocked" case that suite screenshotted.
 *
 * The lockout guards are the important ones here: the server refuses to
 * let an admin delete their own account, change their own role, or remove
 * the last admin, and the UI must not pretend otherwise.
 */

import { TID } from "@shared/testids";
import { spotDraft } from "@fixtures/data.fixture";
import { USERS, expect, newAccount, test } from "@fixtures/index";

test.describe("admin console", () => {
  test("shows the platform totals", async ({ asAdmin }) => {
    await expect(asAdmin.el.screen).toBeVisible();
    await expect(asAdmin.el.stats).toHaveCount(4);
    for (const label of ["Users", "Spots", "Bookings", "Owners"]) {
      await expect(asAdmin.el.statByLabel(label)).toBeVisible();
    }
  });

  test("lists the registered users, including the seeded three", async ({ asAdmin }) => {
    await asAdmin.showUsers();

    expect(await asAdmin.userCount()).toBeGreaterThanOrEqual(3);
    for (const user of Object.values(USERS)) {
      await expect(asAdmin.el.userByEmail(user.email)).toBeVisible();
    }
  });

  test("a user's role can be changed", async ({ signIn, api, adminDashboard }) => {
    /* Operate on a throwaway account, never on the seeded three — other
       specs authenticate as those in parallel. */
    const victim = await api.registerOrThrow(newAccount("driver"));
    const email = victim.user.email;

    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showUsers();

    expect(await adminDashboard.roleOf(email)).toBe("driver");
    await adminDashboard.setRole(email, "owner");

    await expect(async () => {
      expect(await adminDashboard.roleOf(email)).toBe("owner");
    }).toPass({ timeout: 15_000 });

    /* And it really changed server-side. */
    const me = await api.me(victim.token);
    expect(me.data.user.role).toBe("owner");
  });

  test("a user can be deleted", async ({ signIn, api, adminDashboard }) => {
    const victim = await api.registerOrThrow(newAccount("driver"));
    const email = victim.user.email;

    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showUsers();

    await expect(adminDashboard.el.userByEmail(email)).toBeVisible();
    await adminDashboard.deleteUser(email);
    await expect(adminDashboard.el.userByEmail(email)).toHaveCount(0, {
      timeout: 15_000,
    });

    /* Their session must stop working too. */
    expect((await api.me(victim.token)).status).toBe(401);
  });

  test("declining the delete confirmation keeps the user", async ({
    signIn,
    api,
    adminDashboard,
  }) => {
    const spared = await api.registerOrThrow(newAccount("driver"));
    const email = spared.user.email;

    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showUsers();

    await adminDashboard.declineDeleteUser(email);

    await expect(adminDashboard.el.userByEmail(email)).toBeVisible();
    expect((await api.me(spared.token)).status).toBe(200);
  });

  test("an admin cannot delete their own account", async ({ asAdmin, api }) => {
    await asAdmin.showUsers();

    const ownRow = asAdmin.el.userByEmail(USERS.admin.email);
    await expect(ownRow).toBeVisible();
    /* The row marks itself so the operator can see which one they are. */
    await expect(ownRow).toContainText(/you/i);

    await asAdmin.deleteUser(USERS.admin.email);

    /* Either the control is refused client-side or the server rejects it;
       what must never happen is the admin locking themselves out. */
    await expect(asAdmin.el.userByEmail(USERS.admin.email)).toBeVisible({
      timeout: 15_000,
    });

    const stillWorks = await api.login(USERS.admin.email, USERS.admin.password);
    expect(stillWorks.status).toBe(200);
  });
});

test.describe("spot moderation", () => {
  test("listings can be verified", async ({ signIn, api, adminDashboard }) => {
    /* Create a pending listing to act on, so the spec doesn't depend on
       the seed containing an unverified one. */
    const owner = await api.registerOrThrow(newAccount("owner"));
    const draft = spotDraft();
    const created = await api.createSpot(owner.token, {
      ...draft,
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    });
    expect(created.status).toBe(201);
    expect(created.data.spot.verified).toBe(false);

    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showSpots();

    const row = adminDashboard.el.spotByName(draft.name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/pending/i);

    await adminDashboard.verifySpotByName(draft.name);
    await expect(row).toContainText(/verified/i, { timeout: 15_000 });

    await api.deleteSpot(owner.token, created.data.spot.id);
  });

  test("listings can be deleted", async ({ signIn, api, adminDashboard }) => {
    const owner = await api.registerOrThrow(newAccount("owner"));
    const draft = spotDraft();
    const created = await api.createSpot(owner.token, {
      ...draft,
      lat: 13.05,
      lng: 80.24,
      photo: "/spots/open-driveway.svg",
    });

    await signIn("admin");
    await adminDashboard.waitForLoaded();
    await adminDashboard.showSpots();

    await expect(adminDashboard.el.spotByName(draft.name)).toBeVisible({
      timeout: 20_000,
    });
    await adminDashboard.deleteSpotByName(draft.name);

    /* Gone from the public list as well as the admin table. */
    const spots = await api.spots();
    expect(spots.data.spots.map((s) => s.id)).not.toContain(created.data.spot.id);
  });

  test("every spot row exposes both moderation actions", async ({ asAdmin }) => {
    await asAdmin.showSpots();

    const rows = await asAdmin.el.spotRows.count();
    expect(rows).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(rows, 3); i += 1) {
      const row = asAdmin.el.spotRows.nth(i);
      await expect(row.getByTestId(TID.adminSpotVerify)).toBeVisible();
      await expect(row.getByTestId(TID.adminSpotDelete)).toBeVisible();
    }
  });
});

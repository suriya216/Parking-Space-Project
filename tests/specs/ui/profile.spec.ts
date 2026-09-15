/**
 * Profile and its sheets — ports the profile/vehicles/payments/settings
 * legs of e2e/drive.mjs.
 *
 * Each spec that mutates data uses its own fresh account: these run
 * fullyParallel, and vehicles/cards persist in SQLite, so sharing the
 * seeded driver would make the counts race.
 */

import { CARDS, vehicleDraft } from "@fixtures/data.fixture";
import { expect, injectSession, newAccount, test } from "@fixtures/index";
import type { ApiClient } from "@fixtures/api.fixture";
import type { Page } from "@playwright/test";

/** Register a throwaway driver and put the browser in their session. */
const freshDriver = async (page: Page, api: ApiClient) => {
  const registered = await api.register(newAccount("driver"));
  expect(registered.ok).toBe(true);
  await injectSession(page, registered.data);
  return registered.data;
};

test.describe("profile", () => {
  test("shows the signed-in user's name and email", async ({ page, api, profile }) => {
    const session = await freshDriver(page, api);
    await profile.openFromTab();

    await expect(profile.el.name).toHaveText(session.user.name);
    await expect(profile.el.email).toHaveText(session.user.email);
  });

  test("a phone number can be saved and persists", async ({ page, api, profile }) => {
    const session = await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openEditProfile();

    const phone = "+91 98400 11223";
    await profile.saveProfile({ phone });

    /* Confirm server-side rather than trusting the optimistic UI. */
    await expect(async () => {
      const me = await api.me(session.token);
      expect(me.data.user.phone).toBe(phone);
    }).toPass({ timeout: 15_000 });
  });

  test("taking another account's email is refused with a readable message", async ({
    page,
    api,
    profile,
  }) => {
    await freshDriver(page, api);
    const other = await api.register(newAccount("driver"));

    await profile.openFromTab();
    await profile.openEditProfile();
    await profile.saveProfile({ email: other.data.user.email });

    await expect(profile.edit.error).toBeVisible();
    /* Plain words, not a bare status code. */
    await expect(profile.edit.error).not.toContainText("409");
  });
});

test.describe("vehicles", () => {
  test("a vehicle can be added and then removed", async ({ page, api, profile }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openVehicles();

    await expect(profile.vehicles.rows).toHaveCount(0);

    const vehicle = vehicleDraft();
    await profile.addVehicle(vehicle);

    await expect(profile.vehicles.rows).toHaveCount(1);
    await expect(profile.vehicles.rowByPlate(vehicle.plate)).toBeVisible();

    await profile.vehicles.deleteButtons.first().click();
    await expect(profile.vehicles.rows).toHaveCount(0);
  });

  test("several vehicles can coexist", async ({ page, api, profile }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openVehicles();

    const first = vehicleDraft();
    const second = vehicleDraft();
    await profile.addVehicle(first);
    await profile.addVehicle(second);

    await expect(profile.vehicles.rows).toHaveCount(2);
    await expect(profile.vehicles.rowByPlate(first.plate)).toBeVisible();
    await expect(profile.vehicles.rowByPlate(second.plate)).toBeVisible();
  });
});

test.describe("payment methods", () => {
  test("a valid card is accepted and only the last four are shown", async ({
    page,
    api,
    profile,
  }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openPaymentMethods();

    await profile.addCard(CARDS.validVisa.number, CARDS.validVisa.expiry);

    await expect(profile.cards.rows).toHaveCount(1, { timeout: 15_000 });

    /* The full number must never come back — the server stores brand,
       last4 and expiry only. */
    const rowText = (await profile.cards.rows.first().textContent()) ?? "";
    expect(rowText).toContain(CARDS.validVisa.last4);
    expect(rowText).not.toContain(CARDS.validVisa.number);
  });

  test("a card failing the Luhn check is rejected", async ({ page, api, profile }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openPaymentMethods();

    await profile.addCard(CARDS.luhnFailure.number, CARDS.luhnFailure.expiry);

    await expect(profile.cards.error).toBeVisible();
    await expect(profile.cards.rows).toHaveCount(0);
  });

  test("a too-short number is rejected", async ({ page, api, profile }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openPaymentMethods();

    await profile.addCard(CARDS.tooShort.number, CARDS.tooShort.expiry);

    await expect(profile.cards.error).toBeVisible();
    await expect(profile.cards.rows).toHaveCount(0);
  });
});

test.describe("settings", () => {
  /* formatDistance (src/prefs.js) switches unit by magnitude, not just by
     preference: metric renders "850 m" below a kilometre and "1.2 km"
     above it; imperial renders "300 ft" below a tenth of a mile and
     "0.5 mi" above. So the assertion has to accept either member of each
     pair — matching only /km/ fails on a spot 800 m away. */
  const METRIC = /\d+(\.\d+)?\s?(m|km)\b/i;
  const IMPERIAL = /\d+(\.\d+)?\s?(ft|mi)\b/i;

  test("switching to miles changes how distances are rendered", async ({
    page,
    api,
    profile,
    driverHome,
  }) => {
    await freshDriver(page, api);
    await driverHome.waitForLoaded();

    /* Distances only appear once there's a location fix, which the
       project config provides (Teynampet). */
    const card = driverHome.el.spotCards.first();
    await expect(card).toHaveText(METRIC);

    await profile.openFromTab();
    await profile.openSettings();
    await profile.setUnits("mi");

    await driverHome.goToHome();
    await expect(card).toHaveText(IMPERIAL, { timeout: 20_000 });
  });

  test("settings survive a reload", async ({ page, api, profile, driverHome }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openSettings();
    await profile.setUnits("mi");

    await page.reload({ waitUntil: "domcontentloaded" });
    await driverHome.waitForLoaded();

    /* Preferences live in localStorage under parkspace.prefs, so a reload
       must come back in miles rather than snapping to the km default. */
    await expect(driverHome.el.spotCards.first()).toHaveText(IMPERIAL, {
      timeout: 20_000,
    });
  });

  test("safety and privacy explains what is stored", async ({ page, api, profile }) => {
    await freshDriver(page, api);
    await profile.openFromTab();
    await profile.openSafety();

    await expect(profile.safety.sheet).toContainText(/SQLite|stored/i);
  });
});

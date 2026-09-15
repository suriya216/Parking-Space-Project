import type { Locator, Page } from "@playwright/test";

import {
  cardsLocators,
  editProfileLocators,
  profileLocators,
  safetyLocators,
  settingsLocators,
  vehiclesLocators,
} from "@locators/profile.locators";

import { BasePage } from "./BasePage";

/** Profile tab and every sheet reachable from it. */
export class ProfilePage extends BasePage {
  readonly el: ReturnType<typeof profileLocators>;
  readonly edit: ReturnType<typeof editProfileLocators>;
  readonly vehicles: ReturnType<typeof vehiclesLocators>;
  readonly cards: ReturnType<typeof cardsLocators>;
  readonly settings: ReturnType<typeof settingsLocators>;
  readonly safety: ReturnType<typeof safetyLocators>;

  constructor(page: Page) {
    super(page);
    this.el = profileLocators(page);
    this.edit = editProfileLocators(page);
    this.vehicles = vehiclesLocators(page);
    this.cards = cardsLocators(page);
    this.settings = settingsLocators(page);
    this.safety = safetyLocators(page);
  }

  async openFromTab(): Promise<void> {
    await this.chrome.tabProfile.click();
    await this.el.screen.waitFor({ state: "visible" });
  }

  private async openRow(label: string): Promise<void> {
    await this.el.rowByLabel(label).first().click();
  }

  /**
   * Wait out a sheet's initial fetch.
   *
   * The vehicles and cards sheets render a "Loading…" line while their
   * GET is in flight. Acting before it settles is how a spec ends up
   * racing the response — and under parallel workers that GET is slow
   * enough to matter.
   */
  private async waitForSheetLoad(sheet: Locator): Promise<void> {
    await sheet
      .getByText("Loading…")
      .waitFor({ state: "detached", timeout: 30_000 })
      .catch(() => {
        /* Already loaded before we looked — nothing to wait for. */
      });
  }

  /* ─── edit profile ────────────────────────────────────── */

  async openEditProfile(): Promise<void> {
    await this.openRow("Edit profile");
    await this.edit.sheet.waitFor({ state: "visible" });
  }

  async saveProfile(fields: {
    name?: string;
    email?: string;
    phone?: string;
  }): Promise<void> {
    if (fields.name !== undefined) await this.edit.name.fill(fields.name);
    if (fields.email !== undefined) await this.edit.email.fill(fields.email);
    if (fields.phone !== undefined) await this.edit.phone.fill(fields.phone);
    await this.edit.save.click();
  }

  /* ─── vehicles ────────────────────────────────────────── */

  async openVehicles(): Promise<void> {
    await this.openRow("My vehicles");
    await this.vehicles.sheet.waitFor({ state: "visible" });
    await this.waitForSheetLoad(this.vehicles.sheet);
  }

  async addVehicle(v: { label: string; plate: string; type?: string }): Promise<void> {
    await this.vehicles.label.fill(v.label);
    await this.vehicles.plate.fill(v.plate);
    if (v.type) await this.vehicles.type.selectOption(v.type);
    await this.vehicles.add.click();
    await this.vehicles.rowByPlate(v.plate).waitFor({ state: "visible" });
  }

  async vehicleCount(): Promise<number> {
    return this.vehicles.rows.count();
  }

  /* ─── payment methods ─────────────────────────────────── */

  async openPaymentMethods(): Promise<void> {
    await this.openRow("Payment methods");
    await this.cards.sheet.waitFor({ state: "visible" });
    await this.waitForSheetLoad(this.cards.sheet);
  }

  async addCard(number: string, expiry: string): Promise<void> {
    await this.cards.number.fill(number);
    await this.cards.expiry.fill(expiry);
    await this.cards.add.click();
  }

  async cardCount(): Promise<number> {
    return this.cards.rows.count();
  }

  /* ─── settings ────────────────────────────────────────── */

  async openSettings(): Promise<void> {
    await this.openRow("Settings");
    await this.settings.sheet.waitFor({ state: "visible" });
  }

  async setUnits(units: "km" | "mi"): Promise<void> {
    await this.settings.units.selectOption(units);
    await this.settings.save.click();
  }

  /**
   * Enter pin-picking mode from Settings. This is the route the specs
   * use because the inline "Set my location" control on the map only
   * renders when the device fix is missing or coarser than ~5 km — with
   * a good geolocation it isn't there at all.
   *
   * Closes the sheet and hands control back to the map.
   */
  async startPinningLocation(): Promise<void> {
    await this.openSettings();
    await this.settings.pickLocation.click();
    await this.settings.sheet.waitFor({ state: "detached" });
  }

  async clearPinnedLocation(): Promise<void> {
    await this.openSettings();
    await this.settings.clearLocation.click();
    await this.settings.sheet.waitFor({ state: "detached" });
  }

  async openSafety(): Promise<void> {
    await this.openRow("Safety");
    await this.safety.sheet.waitFor({ state: "visible" });
  }
}

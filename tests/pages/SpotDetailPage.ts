import type { Page } from "@playwright/test";

import {
  bookingConfirmedLocators,
  confirmBookingLocators,
  spotDetailLocators,
} from "@locators/driver.locators";

import { BasePage } from "./BasePage";

/**
 * Spot detail plus the booking flow it leads into: detail → confirm sheet
 * → confirmation screen with QR.
 */
export class SpotDetailPage extends BasePage {
  readonly el: ReturnType<typeof spotDetailLocators>;
  readonly confirmSheet: ReturnType<typeof confirmBookingLocators>;
  readonly confirmed: ReturnType<typeof bookingConfirmedLocators>;

  constructor(page: Page) {
    super(page);
    this.el = spotDetailLocators(page);
    this.confirmSheet = confirmBookingLocators(page);
    this.confirmed = bookingConfirmedLocators(page);
  }

  async waitForLoaded(): Promise<void> {
    await this.el.screen.waitFor({ state: "visible" });
  }

  async name(): Promise<string> {
    return (await this.el.name.textContent()) ?? "";
  }

  async currentHours(): Promise<number> {
    return Number((await this.el.hours.textContent())?.trim());
  }

  /**
   * Duration is a +/- stepper clamped to 1..12, so this steps toward the
   * target rather than typing into a field. Clamps the request so a spec
   * asking for 20 hours doesn't spin forever.
   */
  async setHours(hours: number): Promise<void> {
    const target = Math.min(12, Math.max(1, hours));

    for (let guard = 0; guard < 24; guard += 1) {
      const current = await this.currentHours();
      if (current === target) return;
      await (current < target
        ? this.el.hoursIncrease.click()
        : this.el.hoursDecrease.click());
    }
    throw new Error(`could not reach ${target} hours on the duration stepper`);
  }

  async toggleFavourite(): Promise<void> {
    await this.el.favourite.click();
  }

  /** Open the confirm sheet without committing the booking. */
  async startBooking(): Promise<void> {
    await this.el.book.click();
    await this.confirmSheet.sheet.waitFor({ state: "visible" });
  }

  async confirmBooking(): Promise<void> {
    await this.confirmSheet.submit.click();
    await this.confirmed.screen.waitFor({ state: "visible" });
  }

  async abandonBooking(): Promise<void> {
    await this.confirmSheet.cancel.click();
    await this.confirmSheet.sheet.waitFor({ state: "detached" });
  }

  /** Detail → confirmed, returning the booking reference shown. */
  async bookFor(hours: number): Promise<string> {
    await this.setHours(hours);
    await this.startBooking();
    await this.confirmBooking();
    return (await this.confirmed.reference.textContent()) ?? "";
  }

  async quotedTotal(): Promise<string> {
    return (await this.confirmSheet.total.textContent()) ?? "";
  }

  async finishConfirmation(): Promise<void> {
    await this.confirmed.done.click();
    await this.confirmed.screen.waitFor({ state: "detached" });
  }
}

import type { Page } from "@playwright/test";

import { TID } from "@shared/testids";
import { bookingsLocators, savedLocators } from "@locators/driver.locators";

import { BasePage } from "./BasePage";

/** Bookings tab, and the Saved tab which shares the spot-card markup. */
export class BookingsPage extends BasePage {
  readonly el: ReturnType<typeof bookingsLocators>;
  readonly saved: ReturnType<typeof savedLocators>;

  constructor(page: Page) {
    super(page);
    this.el = bookingsLocators(page);
    this.saved = savedLocators(page);
  }

  async openFromTab(): Promise<void> {
    await this.chrome.tabBookings.click();
    await this.el.screen.waitFor({ state: "visible" });
  }

  async openSavedFromTab(): Promise<void> {
    await this.chrome.tabSaved.click();
    await this.saved.screen.waitFor({ state: "visible" });
  }

  async count(): Promise<number> {
    return this.el.cards.count();
  }

  async savedCount(): Promise<number> {
    return this.saved.cards.count();
  }

  async cancelByRef(ref: string): Promise<void> {
    const card = this.el.cardByRef(ref);
    await card.waitFor({ state: "visible" });
    this.acceptNextConfirm();
    await card.getByTestId(TID.bookingCancel).click();
  }

  async cancelAt(index = 0): Promise<void> {
    this.acceptNextConfirm();
    await this.el.cancel.nth(index).click();
  }

  /** Click Cancel but decline the confirmation — nothing should change. */
  async declineCancelAt(index = 0): Promise<void> {
    this.dismissNextConfirm();
    await this.el.cancel.nth(index).click();
  }

  async extendAt(index = 0): Promise<void> {
    await this.el.extend.nth(index).click();
  }

  async statusOf(ref: string): Promise<string> {
    const card = this.el.cardByRef(ref);
    return (await card.getByTestId(TID.bookingStatus).textContent()) ?? "";
  }
}

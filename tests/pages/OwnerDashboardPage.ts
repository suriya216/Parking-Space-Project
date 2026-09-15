import type { Page } from "@playwright/test";

import { addSpotLocators, ownerDashboardLocators } from "@locators/owner.locators";

import { BasePage } from "./BasePage";

export interface SpotDraft {
  readonly name: string;
  readonly address: string;
  readonly price: number;
  readonly type?: string;
  readonly vehicle?: string;
  readonly available?: string;
}

/** Owner dashboard: listings, earnings, add-spot. */
export class OwnerDashboardPage extends BasePage {
  readonly el: ReturnType<typeof ownerDashboardLocators>;
  readonly addSpot: ReturnType<typeof addSpotLocators>;

  constructor(page: Page) {
    super(page);
    this.el = ownerDashboardLocators(page);
    this.addSpot = addSpotLocators(page);
  }

  async waitForLoaded(): Promise<void> {
    await this.el.screen.waitFor({ state: "visible" });
  }

  async showListings(): Promise<void> {
    await this.el.tabListings.click();
  }

  async showEarnings(): Promise<void> {
    await this.el.tabEarnings.click();
  }

  async listingCount(): Promise<number> {
    return this.el.listingRows.count();
  }

  async openAddSpot(): Promise<void> {
    await this.el.addSpot.click();
    await this.addSpot.sheet.waitFor({ state: "visible" });
  }

  /**
   * Fill the add-spot form without submitting — for validation specs.
   *
   * Note `type` is the only <select> here; `vehicle` and `available` are
   * free-text fields ("Sedan/SUV", "Daily, 8 AM – 8 PM"), not dropdowns.
   */
  async fillSpot(draft: SpotDraft): Promise<void> {
    await this.addSpot.name.fill(draft.name);
    await this.addSpot.address.fill(draft.address);
    await this.addSpot.price.fill(String(draft.price));
    if (draft.type) await this.addSpot.type.selectOption(draft.type);
    if (draft.vehicle) await this.addSpot.vehicle.fill(draft.vehicle);
    if (draft.available) await this.addSpot.available.fill(draft.available);

    /* A listing needs a photo. The picker offers stock illustrations, so
       pick the first rather than uploading a file. */
    const stockPhoto = this.addSpot.photos.first();
    if (await stockPhoto.isVisible()) {
      await stockPhoto.click();
    }
  }

  async createSpot(draft: SpotDraft): Promise<void> {
    await this.openAddSpot();
    await this.fillSpot(draft);
    await this.addSpot.submit.click();
    await this.addSpot.sheet.waitFor({ state: "detached" });
  }

  /** Submit a draft expected to be rejected; leaves the sheet open. */
  async createSpotExpectingFailure(draft: SpotDraft): Promise<void> {
    await this.openAddSpot();
    await this.fillSpot(draft);
    await this.addSpot.submit.click();
  }

  /** Delete one of this owner's own listings (guarded by window.confirm). */
  async deleteListingByName(name: string): Promise<void> {
    const row = this.el.listingByName(name);
    await row.waitFor({ state: "visible" });
    this.acceptNextConfirm();
    await row.getByRole("button", { name: /delete/i }).click();
    await row.waitFor({ state: "detached" });
  }
}

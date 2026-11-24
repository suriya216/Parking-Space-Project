import type { Page } from "@playwright/test";

import { chromeLocators, confirmDialogLocators, sheetLocators } from "@locators/common.locators";

/**
 * Shared page-object behaviour.
 *
 * `waitForApp` is the one piece worth keeping from the old e2e scripts:
 * navigations use `domcontentloaded` rather than `networkidle`, because
 * with a Vite HMR websocket and a Leaflet map fetching tiles continuously
 * the network may never go idle. The trade is that the document is ready
 * before React has mounted, so anything touching the DOM straight after a
 * navigation has to wait for mount explicitly.
 */
export abstract class BasePage {
  readonly chrome: ReturnType<typeof chromeLocators>;
  readonly sheet: ReturnType<typeof sheetLocators>;
  readonly confirmDialog: ReturnType<typeof confirmDialogLocators>;

  constructor(protected readonly page: Page) {
    this.chrome = chromeLocators(page);
    this.sheet = sheetLocators(page);
    this.confirmDialog = confirmDialogLocators(page);
  }

  /** Navigate to a path and wait for React to have rendered. */
  async open(path = "/"): Promise<void> {
    await this.page.goto(path, { waitUntil: "domcontentloaded" });
    await this.waitForApp();
  }

  async waitForApp(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const root = document.getElementById("root");
        return Boolean(root && root.childElementCount > 0);
      },
      null,
      { timeout: 60_000 },
    );
  }

  /**
   * Drop any persisted session and reload, so a spec starts signed out
   * regardless of what ran before it.
   */
  async resetSession(): Promise<void> {
    await this.page.goto("/", { waitUntil: "domcontentloaded" });
    await this.page.evaluate(() => localStorage.clear());
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.waitForApp();
  }

  /** Close the topmost sheet via its close button. */
  async closeSheet(): Promise<void> {
    await this.sheet.close.first().click();
  }

  /** Browser/Android back, which the app maps onto closing the top view. */
  async goBack(): Promise<void> {
    await this.page.goBack({ waitUntil: "domcontentloaded" });
  }

  async signOut(): Promise<void> {
    await this.chrome.signOut.click();
  }

  /**
   * Confirm the open yes/no modal (cancel booking, delete listing, delete
   * user, delete spot all share it — see confirmDialogLocators). Waits for
   * it to appear, then for it to close, since a confirmed action runs for
   * real and the dialog only dismisses once that finishes.
   */
  protected async acceptConfirmDialog(): Promise<void> {
    await this.confirmDialog.dialog.waitFor({ state: "visible" });
    await this.confirmDialog.confirm.click();
    await this.confirmDialog.dialog.waitFor({ state: "detached" });
  }

  /** Decline the open confirm dialog — for "cancel the cancel" specs. */
  protected async declineConfirmDialog(): Promise<void> {
    await this.confirmDialog.dialog.waitFor({ state: "visible" });
    await this.confirmDialog.cancel.click();
    await this.confirmDialog.dialog.waitFor({ state: "detached" });
  }
}

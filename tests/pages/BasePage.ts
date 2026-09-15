import type { Page } from "@playwright/test";

import { chromeLocators, sheetLocators } from "@locators/common.locators";

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

  constructor(protected readonly page: Page) {
    this.chrome = chromeLocators(page);
    this.sheet = sheetLocators(page);
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
   * Accept the next `window.confirm`.
   *
   * The app guards its four destructive actions with `window.confirm`
   * (cancel booking, delete listing, delete user, delete spot). Playwright
   * auto-dismisses dialogs, which silently declines the confirmation and
   * makes the action look broken — so any page object driving one of
   * those must arm this first.
   */
  protected acceptNextConfirm(): void {
    this.page.once("dialog", (dialog) => {
      void dialog.accept();
    });
  }

  /** Decline the next `window.confirm` — for "cancel the cancel" specs. */
  protected dismissNextConfirm(): void {
    this.page.once("dialog", (dialog) => {
      void dialog.dismiss();
    });
  }
}

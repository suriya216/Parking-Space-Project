import type { Page } from "@playwright/test";

import type { Role } from "@shared/models";
import { TID } from "@shared/testids";
import { adminDashboardLocators } from "@locators/admin.locators";

import { BasePage } from "./BasePage";

/** Admin dashboard: user roles, deletions, spot moderation. */
export class AdminDashboardPage extends BasePage {
  readonly el: ReturnType<typeof adminDashboardLocators>;

  constructor(page: Page) {
    super(page);
    this.el = adminDashboardLocators(page);
  }

  async waitForLoaded(): Promise<void> {
    await this.el.screen.waitFor({ state: "visible" });
  }

  async showUsers(): Promise<void> {
    await this.el.tabUsers.click();
    await this.el.userRows.first().waitFor({ state: "visible" });
  }

  async showSpots(): Promise<void> {
    await this.el.tabSpots.click();
    await this.el.spotRows.first().waitFor({ state: "visible" });
  }

  async userCount(): Promise<number> {
    return this.el.userRows.count();
  }

  async setRole(email: string, role: Role): Promise<void> {
    const row = this.el.userByEmail(email);
    await row.waitFor({ state: "visible" });
    await row.getByTestId(TID.adminUserRole).selectOption(role);
  }

  async roleOf(email: string): Promise<string> {
    const row = this.el.userByEmail(email);
    return row.getByTestId(TID.adminUserRole).inputValue();
  }

  async deleteUser(email: string): Promise<void> {
    const row = this.el.userByEmail(email);
    await row.waitFor({ state: "visible" });
    this.acceptNextConfirm();
    await row.getByTestId(TID.adminUserDelete).click();
  }

  /** Attempt a delete but decline the confirmation. */
  async declineDeleteUser(email: string): Promise<void> {
    const row = this.el.userByEmail(email);
    await row.waitFor({ state: "visible" });
    this.dismissNextConfirm();
    await row.getByTestId(TID.adminUserDelete).click();
  }

  /**
   * Whether the delete control for an account is offered at all.
   * The server refuses to let an admin delete their own account, and the
   * UI is expected to reflect that rather than offering a doomed button.
   */
  async canDeleteUser(email: string): Promise<boolean> {
    const row = this.el.userByEmail(email);
    await row.waitFor({ state: "visible" });
    const del = row.getByTestId(TID.adminUserDelete);
    if ((await del.count()) === 0) return false;
    return del.first().isEnabled();
  }

  async verifySpotByName(name: string): Promise<void> {
    const row = this.el.spotByName(name);
    await row.waitFor({ state: "visible" });
    await row.getByTestId(TID.adminSpotVerify).click();
  }

  async deleteSpotByName(name: string): Promise<void> {
    const row = this.el.spotByName(name);
    await row.waitFor({ state: "visible" });
    this.acceptNextConfirm();
    await row.getByTestId(TID.adminSpotDelete).click();
    await row.waitFor({ state: "detached" });
  }
}

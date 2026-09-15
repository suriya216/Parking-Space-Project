/**
 * The suite's `test` and `expect`.
 *
 * Specs import from here, never from "@playwright/test" directly, so
 * every test gets the page objects and the API client already wired.
 *
 * Page-object fixtures are lazy: constructing one only builds locators,
 * it never navigates, so a spec that needs three of them pays nothing for
 * the two it doesn't touch.
 */

import { test as base, expect } from "@playwright/test";

import { API_URL } from "@support/env";
import { AdminDashboardPage } from "@pages/AdminDashboardPage";
import { AuthPage } from "@pages/AuthPage";
import { BookingsPage } from "@pages/BookingsPage";
import { DriverHomePage } from "@pages/DriverHomePage";
import { OwnerDashboardPage } from "@pages/OwnerDashboardPage";
import { ProfilePage } from "@pages/ProfilePage";
import { SpotDetailPage } from "@pages/SpotDetailPage";

import { ApiClient } from "./api.fixture";
import { signInAs } from "./auth.fixture";
import type { UserKey } from "./users.fixture";

export interface ParkSpaceFixtures {
  /** Typed API client bound to the Express server. */
  api: ApiClient;

  /** Sign the browser in as a seeded role, bypassing the login form. */
  signIn: (role: UserKey) => Promise<void>;

  authPage: AuthPage;
  driverHome: DriverHomePage;
  spotDetail: SpotDetailPage;
  bookings: BookingsPage;
  profile: ProfilePage;
  ownerDashboard: OwnerDashboardPage;
  adminDashboard: AdminDashboardPage;

  /** Signed in as the seeded driver, on a loaded home screen. */
  asDriver: DriverHomePage;
  /** Signed in as the seeded owner, on a loaded dashboard. */
  asOwner: OwnerDashboardPage;
  /** Signed in as the seeded admin, on a loaded dashboard. */
  asAdmin: AdminDashboardPage;
}

export const test = base.extend<ParkSpaceFixtures>({
  /* A request context pinned to the API origin, so API specs and UI
     arrange-steps share one client regardless of the project's baseURL. */
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({ baseURL: API_URL });
    await use(new ApiClient(context));
    await context.dispose();
  },

  signIn: async ({ page, api }, use) => {
    await use(async (role: UserKey) => {
      await signInAs(page, api, role);
    });
  },

  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
  driverHome: async ({ page }, use) => {
    await use(new DriverHomePage(page));
  },
  spotDetail: async ({ page }, use) => {
    await use(new SpotDetailPage(page));
  },
  bookings: async ({ page }, use) => {
    await use(new BookingsPage(page));
  },
  profile: async ({ page }, use) => {
    await use(new ProfilePage(page));
  },
  ownerDashboard: async ({ page }, use) => {
    await use(new OwnerDashboardPage(page));
  },
  adminDashboard: async ({ page }, use) => {
    await use(new AdminDashboardPage(page));
  },

  /* ─── role shortcuts ──────────────────────────────────── */

  asDriver: async ({ page, api, driverHome }, use) => {
    await signInAs(page, api, "driver");
    await driverHome.waitForLoaded();
    await use(driverHome);
  },

  asOwner: async ({ page, api, ownerDashboard }, use) => {
    await signInAs(page, api, "owner");
    await ownerDashboard.waitForLoaded();
    await use(ownerDashboard);
  },

  asAdmin: async ({ page, api, adminDashboard }, use) => {
    await signInAs(page, api, "admin");
    await adminDashboard.waitForLoaded();
    await use(adminDashboard);
  },
});

export { expect };
export { USERS, BAD_CREDENTIALS, newAccount } from "./users.fixture";
export type { TestUser, UserKey } from "./users.fixture";
/* Re-exported so a spec can sign in as an account it just created, which
   the role-keyed `signIn` fixture can't express. */
export { injectSession } from "./auth.fixture";

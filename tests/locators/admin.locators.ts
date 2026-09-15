/** Admin dashboard: user management and spot moderation. */

import type { Page } from "@playwright/test";

import { RECORD_ATTR, TID } from "@shared/testids";

import { recordLocator } from "./common.locators";

export const adminDashboardLocators = (page: Page) => ({
  screen: page.getByTestId(TID.adminDashboard),
  tabUsers: page.getByTestId(TID.adminTabUsers),
  tabSpots: page.getByTestId(TID.adminTabSpots),
  stats: page.getByTestId(TID.adminStat),
  statByLabel: (label: string) =>
    page.getByTestId(TID.adminStat).filter({ hasText: label }),
  signOut: page.getByTestId(TID.signOut),

  userRows: page.getByTestId(TID.adminUserRow),
  userById: (userId: number) =>
    recordLocator(page, TID.adminUserRow, RECORD_ATTR.user, userId),
  userByEmail: (email: string) =>
    page.getByTestId(TID.adminUserRow).filter({ hasText: email }),
  roleSelects: page.getByTestId(TID.adminUserRole),
  userDeletes: page.getByTestId(TID.adminUserDelete),

  spotRows: page.getByTestId(TID.adminSpotRow),
  spotById: (spotId: number) =>
    recordLocator(page, TID.adminSpotRow, RECORD_ATTR.spot, spotId),
  spotByName: (name: string) =>
    page.getByTestId(TID.adminSpotRow).filter({ hasText: name }),
  spotVerifies: page.getByTestId(TID.adminSpotVerify),
  spotDeletes: page.getByTestId(TID.adminSpotDelete),
});

export type AdminDashboardLocators = ReturnType<typeof adminDashboardLocators>;

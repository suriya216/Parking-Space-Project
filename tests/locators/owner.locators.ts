/** Owner dashboard: listings, earnings, and the add-spot sheet. */

import type { Page } from "@playwright/test";

import { RECORD_ATTR, TID } from "@shared/testids";

import { recordLocator } from "./common.locators";

export const ownerDashboardLocators = (page: Page) => ({
  screen: page.getByTestId(TID.ownerDashboard),
  tabListings: page.getByTestId(TID.ownerTabListings),
  tabEarnings: page.getByTestId(TID.ownerTabEarnings),
  stats: page.getByTestId(TID.ownerStat),
  statByLabel: (label: string) =>
    page.getByTestId(TID.ownerStat).filter({ hasText: label }),
  listingRows: page.getByTestId(TID.ownerListingRow),
  listingById: (spotId: number) =>
    recordLocator(page, TID.ownerListingRow, RECORD_ATTR.spot, spotId),
  listingByName: (name: string) =>
    page.getByTestId(TID.ownerListingRow).filter({ hasText: name }),
  addSpot: page.getByTestId(TID.addSpotOpen),
  signOut: page.getByTestId(TID.signOut),
});

export const addSpotLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.addSpotSheet),
  name: page.getByTestId(TID.addSpotName),
  address: page.getByTestId(TID.addSpotAddress),
  price: page.getByTestId(TID.addSpotPrice),
  type: page.getByTestId(TID.addSpotType),
  vehicle: page.getByTestId(TID.addSpotVehicle),
  available: page.getByTestId(TID.addSpotAvailable),
  photos: page.getByTestId(TID.addSpotPhoto),
  submit: page.getByTestId(TID.addSpotSubmit),
  error: page.getByTestId(TID.addSpotError),
});

export type OwnerDashboardLocators = ReturnType<typeof ownerDashboardLocators>;
export type AddSpotLocators = ReturnType<typeof addSpotLocators>;

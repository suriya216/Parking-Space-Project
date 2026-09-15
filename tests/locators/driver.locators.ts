/**
 * Driver-side locators: home/map, search, filters, location panel, spot
 * detail, booking flow, bookings list, saved list.
 */

import type { Page } from "@playwright/test";

import { RECORD_ATTR, TID } from "@shared/testids";

import { recordLocator } from "./common.locators";

export const driverHomeLocators = (page: Page) => ({
  screen: page.getByTestId(TID.driverHome),

  /* Leaflet renders its own DOM, so these are class hooks rather than
     test ids. Defined in src/styles/leaflet.css and written by
     src/map/markers.ts — deliberately global, since a hashed CSS Module
     class could never reach markup Leaflet injects as an HTML string. */
  map: page.locator(".leaflet-container"),
  priceMarkers: page.locator(".ps-price-tag"),
  userDot: page.locator(".ps-user-dot"),
  pinMarker: page.locator(".ps-pin-marker"),

  searchInput: page.getByTestId(TID.searchInput),
  searchClear: page.getByTestId(TID.searchClear),
  searchDropdown: page.getByTestId(TID.searchDropdown),
  spotSuggestions: page.getByTestId(TID.searchSpotOption),
  placeSuggestions: page.getByTestId(TID.searchPlaceOption),
  placesEmpty: page.getByTestId(TID.searchPlacesEmpty),

  filterButton: page.getByTestId(TID.filterButton),

  spotList: page.getByTestId(TID.spotList),
  spotCards: page.getByTestId(TID.spotCard),
  spotCardById: (spotId: number) =>
    recordLocator(page, TID.spotCard, RECORD_ATTR.spot, spotId),
  spotCardByName: (name: string) =>
    page.getByTestId(TID.spotCard).filter({ hasText: name }),
  favouriteToggle: page.getByTestId(TID.spotCardFavourite),

  emptyState: page.getByTestId(TID.spotsEmpty),
  errorState: page.getByTestId(TID.spotsError),
  retry: page.getByTestId(TID.spotsRetry),
});

export const filterLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.filterSheet),
  maxPrice: page.getByTestId(TID.filterMaxPrice),
  sort: page.getByTestId(TID.filterSort),
  type: page.getByTestId(TID.filterType),
  verifiedOnly: page.getByTestId(TID.filterVerifiedOnly),
  apply: page.getByTestId(TID.filterApply),
  reset: page.getByTestId(TID.filterReset),
});

export const locationPanelLocators = (page: Page) => ({
  panel: page.getByTestId(TID.locationPanel),
  summary: page.getByTestId(TID.locationSummary),
  coords: page.getByTestId(TID.locationCoords),
  coarseWarning: page.getByTestId(TID.locationCoarseWarning),
  toggleScope: page.getByTestId(TID.locationToggleScope),
  setPin: page.getByTestId(TID.locationSetPin),
  clearPin: page.getByTestId(TID.locationClearPin),
  retryGps: page.getByTestId(TID.locationRetryGps),
  pickingBanner: page.getByTestId(TID.locationPickingBanner),
  cancelPicking: page.getByTestId(TID.locationCancelPicking),
});

export const spotDetailLocators = (page: Page) => ({
  screen: page.getByTestId(TID.spotDetail),
  name: page.getByTestId(TID.detailName),
  price: page.getByTestId(TID.detailPrice),
  favourite: page.getByTestId(TID.detailFavourite),
  hours: page.getByTestId(TID.detailHours),
  hoursIncrease: page.getByTestId(TID.detailHoursIncrease),
  hoursDecrease: page.getByTestId(TID.detailHoursDecrease),
  total: page.getByTestId(TID.detailTotal),
  book: page.getByTestId(TID.detailBook),
});

export const confirmBookingLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.confirmSheet),
  total: page.getByTestId(TID.confirmTotal),
  submit: page.getByTestId(TID.confirmSubmit),
  cancel: page.getByTestId(TID.confirmCancel),
  error: page.getByTestId(TID.confirmError),
});

export const bookingConfirmedLocators = (page: Page) => ({
  screen: page.getByTestId(TID.confirmScreen),
  reference: page.getByTestId(TID.confirmRef),
  qr: page.getByTestId(TID.confirmQr),
  done: page.getByTestId(TID.confirmDone),
});

export const bookingsLocators = (page: Page) => ({
  screen: page.getByTestId(TID.bookingsScreen),
  cards: page.getByTestId(TID.bookingCard),
  cardById: (bookingId: number) =>
    recordLocator(page, TID.bookingCard, RECORD_ATTR.booking, bookingId),
  cardByRef: (ref: string) =>
    page.getByTestId(TID.bookingCard).filter({ hasText: ref }),
  status: page.getByTestId(TID.bookingStatus),
  cancel: page.getByTestId(TID.bookingCancel),
  extend: page.getByTestId(TID.bookingExtend),
  empty: page.getByTestId(TID.bookingsEmpty),
});

export const savedLocators = (page: Page) => ({
  screen: page.getByTestId(TID.savedScreen),
  cards: page.getByTestId(TID.spotCard),
  empty: page.getByTestId(TID.savedEmpty),
});

export type DriverHomeLocators = ReturnType<typeof driverHomeLocators>;
export type FilterLocators = ReturnType<typeof filterLocators>;
export type LocationPanelLocators = ReturnType<typeof locationPanelLocators>;
export type SpotDetailLocators = ReturnType<typeof spotDetailLocators>;
export type ConfirmBookingLocators = ReturnType<typeof confirmBookingLocators>;
export type BookingConfirmedLocators = ReturnType<typeof bookingConfirmedLocators>;
export type BookingsLocators = ReturnType<typeof bookingsLocators>;
export type SavedLocators = ReturnType<typeof savedLocators>;

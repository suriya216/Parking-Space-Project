/**
 * Single source of truth for `data-testid` values.
 *
 * Imported by BOTH the React app (to render the attributes) and the
 * Playwright locator layer (to find them). That is the whole point: a
 * renamed test id becomes a TypeScript error in the tests instead of a
 * silent locator timeout, which is the failure mode the old text-based
 * selectors had.
 *
 * Rules of thumb used here:
 *   - Only add an id where text/role would be ambiguous or unstable.
 *     Prefer getByRole for buttons that have stable, unique labels.
 *   - Ids describe WHAT the element is, never how it looks.
 *   - List rows get a parameterised id so a specific row is addressable.
 */

export const TID = {
  // ─── auth ─────────────────────────────────────────────
  authScreen: "auth-screen",
  authHeading: "auth-heading",
  authEmail: "auth-email",
  authPassword: "auth-password",
  authName: "auth-name",
  authSubmit: "auth-submit",
  authError: "auth-error",
  authRegistered: "auth-registered",
  authNotice: "auth-notice",
  authNoticeDismiss: "auth-notice-dismiss",
  authForgot: "auth-forgot",
  authSwitchToRegister: "auth-switch-register",
  authSwitchToLogin: "auth-switch-login",
  authRoleDriver: "auth-role-driver",
  authRoleOwner: "auth-role-owner",
  authSsoDivider: "auth-sso-divider",
  /* One button per provider the server holds real credentials for. There
     is no demo variant: the old `auth-sso-demo` buttons signed the seeded
     driver in for anyone who tapped them, and have been removed along
     with the endpoint behind them. */
  authSsoProvider: "auth-sso-provider",

  // forgot password
  forgotSheet: "forgot-sheet",
  forgotEmail: "forgot-email",
  forgotSubmit: "forgot-submit",
  forgotResult: "forgot-result",
  forgotError: "forgot-error",

  // ─── app chrome ───────────────────────────────────────
  tabBar: "tab-bar",
  tabHome: "tab-home",
  tabSearch: "tab-search",
  tabBookings: "tab-bookings",
  tabSaved: "tab-saved",
  tabProfile: "tab-profile",
  screenTitle: "screen-title",
  screenBack: "screen-back",
  signOut: "sign-out",

  // sheets (generic shell)
  sheet: "sheet",
  sheetTitle: "sheet-title",
  sheetClose: "sheet-close",

  // ─── driver home ──────────────────────────────────────
  driverHome: "driver-home",
  searchInput: "search-input",
  searchClear: "search-clear",
  searchDropdown: "search-dropdown",
  searchSpotOption: "search-spot-option",
  searchPlaceOption: "search-place-option",
  searchPlacesEmpty: "search-places-empty",
  filterButton: "filter-button",
  filterSheet: "filter-sheet",
  /* A range slider, not a number field — see setMaxPrice in
     DriverHomePage for why it can't just be filled. */
  filterMaxPrice: "filter-max-price",
  filterSort: "filter-sort",
  filterType: "filter-type",
  filterVerifiedOnly: "filter-verified-only",
  filterApply: "filter-apply",
  filterReset: "filter-reset",

  // location panel
  locationPanel: "location-panel",
  locationSummary: "location-summary",
  locationCoords: "location-coords",
  locationCoarseWarning: "location-coarse-warning",
  locationToggleScope: "location-toggle-scope",
  locationSetPin: "location-set-pin",
  locationClearPin: "location-clear-pin",
  locationRetryGps: "location-retry-gps",
  locationPickingBanner: "location-picking-banner",
  locationCancelPicking: "location-cancel-picking",

  // spot list
  spotList: "spot-list",
  spotCard: "spot-card",
  spotCardFavourite: "spot-card-favourite",
  spotsEmpty: "spots-empty",
  spotsError: "spots-error",
  spotsRetry: "spots-retry",

  // ─── spot detail ──────────────────────────────────────
  spotDetail: "spot-detail",
  detailName: "detail-name",
  detailPrice: "detail-price",
  detailFavourite: "detail-favourite",
  /* Duration is a stepper, not a text field: a value display plus two
     buttons. Modelled as three ids so the page object can drive it the
     way a user does. */
  detailHours: "detail-hours",
  detailHoursIncrease: "detail-hours-increase",
  detailHoursDecrease: "detail-hours-decrease",
  detailTotal: "detail-total",
  detailBook: "detail-book",

  // confirm booking
  confirmSheet: "confirm-sheet",
  confirmTotal: "confirm-total",
  confirmSubmit: "confirm-submit",
  confirmCancel: "confirm-cancel",
  confirmError: "confirm-error",

  // booking confirmed
  confirmScreen: "confirm-screen",
  confirmRef: "confirm-ref",
  confirmQr: "confirm-qr",
  confirmDone: "confirm-done",

  // ─── bookings ─────────────────────────────────────────
  bookingsScreen: "bookings-screen",
  bookingCard: "booking-card",
  bookingStatus: "booking-status",
  bookingCancel: "booking-cancel",
  bookingExtend: "booking-extend",
  bookingsEmpty: "bookings-empty",

  // ─── saved ────────────────────────────────────────────
  savedScreen: "saved-screen",
  savedEmpty: "saved-empty",

  // ─── profile + sheets ─────────────────────────────────
  profileScreen: "profile-screen",
  profileName: "profile-name",
  profileEmail: "profile-email",
  profileRow: "profile-row",

  editProfileSheet: "edit-profile-sheet",
  editProfileName: "edit-profile-name",
  editProfileEmail: "edit-profile-email",
  editProfilePhone: "edit-profile-phone",
  editProfileSave: "edit-profile-save",
  editProfileError: "edit-profile-error",

  vehiclesSheet: "vehicles-sheet",
  vehicleRow: "vehicle-row",
  vehicleLabel: "vehicle-label",
  vehiclePlate: "vehicle-plate",
  vehicleType: "vehicle-type",
  vehicleAdd: "vehicle-add",
  vehicleDelete: "vehicle-delete",
  vehiclesEmpty: "vehicles-empty",

  cardsSheet: "cards-sheet",
  cardRow: "card-row",
  cardNumber: "card-number",
  cardExpiry: "card-expiry",
  cardAdd: "card-add",
  cardDelete: "card-delete",
  cardError: "card-error",

  settingsSheet: "settings-sheet",
  settingsUnits: "settings-units",
  settingsRadius: "settings-radius",
  settingsDefaultHours: "settings-default-hours",
  settingsSave: "settings-save",
  /* The always-available route into pin-picking. The inline control on
     the map only appears when the device fix is missing or coarse, so
     this is the only reliable way in when geolocation is working. */
  settingsPickLocation: "settings-pick-location",
  settingsClearLocation: "settings-clear-location",

  safetySheet: "safety-sheet",

  // ─── owner ────────────────────────────────────────────
  ownerDashboard: "owner-dashboard",
  ownerTabDashboard: "owner-tab-dashboard",
  ownerTabListings: "owner-tab-listings",
  ownerTabEarnings: "owner-tab-earnings",
  ownerStat: "owner-stat",
  ownerListingRow: "owner-listing-row",
  addSpotOpen: "add-spot-open",
  addSpotSheet: "add-spot-sheet",
  addSpotName: "add-spot-name",
  addSpotAddress: "add-spot-address",
  addSpotPrice: "add-spot-price",
  addSpotType: "add-spot-type",
  addSpotVehicle: "add-spot-vehicle",
  addSpotAvailable: "add-spot-available",
  addSpotPhoto: "add-spot-photo",
  addSpotSubmit: "add-spot-submit",
  addSpotError: "add-spot-error",

  // ─── admin ────────────────────────────────────────────
  adminDashboard: "admin-dashboard",
  adminTabUsers: "admin-tab-users",
  adminTabSpots: "admin-tab-spots",
  adminStat: "admin-stat",
  adminUserRow: "admin-user-row",
  adminUserRole: "admin-user-role",
  adminUserDelete: "admin-user-delete",
  adminSpotRow: "admin-spot-row",
  adminSpotVerify: "admin-spot-verify",
  adminSpotDelete: "admin-spot-delete",
} as const;

export type TestId = (typeof TID)[keyof typeof TID];

/** `data-testid` prop spread helper, so the app never hand-writes the string. */
export const tid = (id: TestId) => ({ "data-testid": id });

/**
 * Repeated rows need two things at once: a stable id shared by every row
 * of that kind (so a spec can count them) and the identity of the record
 * in that row. An element can only carry one `data-testid`, so the record
 * identity goes in a sibling attribute instead of being baked into the id.
 *
 *   <div data-testid="spot-card" data-spot-id="7">
 *
 * The test side then filters on the attribute — see `recordLocator` in
 * tests/locators/common.locators.ts.
 */
export const RECORD_ATTR = {
  spot: "data-spot-id",
  booking: "data-booking-id",
  user: "data-user-id",
  vehicle: "data-vehicle-id",
  card: "data-card-id",
} as const;

export type RecordAttr = (typeof RECORD_ATTR)[keyof typeof RECORD_ATTR];

/** Props spread helper: `{...record(RECORD_ATTR.spot, spot.id)}`. */
export const record = (attr: RecordAttr, id: number | string) => ({
  [attr]: String(id),
});

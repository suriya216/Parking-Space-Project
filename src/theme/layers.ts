/**
 * One place for every z-index in the app, so a local bump can't bury app
 * chrome again.
 *
 * Leaflet uses 200–800 internally for its own panes and controls; the map
 * wrapper gets `isolation: isolate` so those values stay contained and
 * never compete with anything in this scale.
 */
export const Z = {
  /** Search/filter bar, inside the isolated map context. */
  mapChrome: 900,
  /** The draggable spot-list sheet over the map. */
  sheet: 10,
  /** Bottom navigation — must sit above the sheet. */
  tabBar: 100,
  /** Full-screen action bars (the booking footer). */
  screenBar: 200,
  /** Sheet overlays, above everything. */
  modal: 4000,
} as const;

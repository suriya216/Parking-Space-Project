import L from "leaflet";

import type { Spot } from "@shared/models";

/**
 * Marker icons.
 *
 * All built with `divIcon` so they can be styled in CSS (see
 * src/styles/leaflet.css) instead of shipping a PNG sprite per price.
 *
 * Those class names are a three-way contract: this file writes them,
 * src/styles/leaflet.css styles them, and tests/locators/driver.locators.ts
 * locates the map by them. They have to stay global — the markup here is
 * an HTML string Leaflet injects, so a hashed CSS Module class could
 * never reach it. Rename in all three places or not at all.
 */

/** Price tag for a spot, highlighted when it is the selected one. */
export const priceIcon = (spot: Spot, selected: boolean): L.DivIcon =>
  L.divIcon({
    className: "ps-price-marker",
    html: `<div class="ps-price-tag${selected ? " is-selected" : ""}">₹${spot.price}</div>`,
    iconSize: [52, 30],
    iconAnchor: [26, 30],
    popupAnchor: [0, -30],
  });

/** The device's own reported position. */
export const userIcon: L.DivIcon = L.divIcon({
  className: "ps-user-marker",
  html: '<div class="ps-user-dot"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * A pinned search position, deliberately distinct from the blue device
 * dot so it's obvious which one the radius is drawn around.
 */
export const pinIcon: L.DivIcon = L.divIcon({
  className: "ps-user-marker",
  html: '<div class="ps-pin-marker">📍</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 24],
});

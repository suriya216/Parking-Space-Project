// User preferences, persisted locally. These are real settings that change
// how the app behaves, not decorative toggles.

import type { LatLng, Units } from "@shared/models";

export interface Prefs {
  /** "nearby" search radius, in metres. */
  radiusM: number;
  /** Pre-filled duration on the booking screen. */
  defaultHours: number;
  units: Units;
  /** Include spots that aren't verified yet. */
  showUnverified: boolean;
  /**
   * Manual position override. Browser geolocation on desktop is IP/Wi-Fi
   * based and often lands in the wrong city (a corporate egress point,
   * say), so the user can pin themselves instead.
   */
  manualLocation: (LatLng & { label?: string }) | null;
}

const KEY = "parkspace.prefs";

export const DEFAULTS: Prefs = {
  radiusM: 3000,
  defaultHours: 2,
  units: "km",
  showUnverified: true,
  manualLocation: null,
};

export const load = (): Prefs => {
  try {
    const raw = localStorage.getItem(KEY);
    // Merge over defaults so a pref added in a later version still resolves.
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
};

export const save = (prefs: Prefs): Prefs => {
  localStorage.setItem(KEY, JSON.stringify(prefs));
  return prefs;
};

/** Distance formatting respects the chosen unit. */
export const formatDistance = (
  metres: number | null | undefined,
  units: Units = "km",
): string => {
  if (metres == null) return "—";
  if (units === "mi") {
    const mi = metres / 1609.344;
    return mi < 0.1 ? `${Math.round(metres * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
  }
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
};

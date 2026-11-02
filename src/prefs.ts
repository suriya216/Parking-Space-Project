// User preferences, persisted locally. These are real settings that change
// how the app behaves, not decorative toggles.

import type { LatLng, Place, Units } from "@shared/models";

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

// ─── RECENT PLACE SEARCHES ──────────────────────────────
// The places a driver picked from the search box, newest first, so a
// repeat search is one tap. Storage can be unavailable (private window,
// blocked site data), in which case this quietly remembers nothing.
const RECENT_KEY = "parkspace.recentPlaces";
const RECENT_MAX = 5;

export const loadRecentPlaces = (): Place[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as Place[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

export const addRecentPlace = (place: Place): Place[] => {
  const next = [place, ...loadRecentPlaces().filter((p) => p.id !== place.id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* not persisted; still shown for this session */
  }
  return next;
};

export const clearRecentPlaces = (): void => {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* nothing to clear */
  }
};

// ─── CASH BOOKINGS AWAITING THE OWNER ───────────────────
// Ids of this driver's cash bookings that were still unpaid the last time
// they looked, so the app can tell when one flips to paid. Kept per user,
// and kept across reloads, so a driver who closes the app and comes back
// still hears about it.
const pendingCashKey = (userId: number | string) => `parkspace.cashPending.${userId}`;

export const loadPendingCash = (userId: number | string): number[] => {
  try {
    const raw = localStorage.getItem(pendingCashKey(userId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
};

export const savePendingCash = (userId: number | string, ids: number[]): void => {
  try {
    localStorage.setItem(pendingCashKey(userId), JSON.stringify(ids));
  } catch {
    /* not persisted; still tracked for this session */
  }
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

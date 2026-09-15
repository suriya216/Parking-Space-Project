import type { LatLng } from "@shared/models";

/**
 * Map centre when the browser won't share a location.
 *
 * Spots, bookings, favourites and vehicles all live in SQLite and arrive
 * via /api/*. Only this fallback stays client-side; the search radius is
 * a user preference (see ./prefs.ts).
 */
export const FALLBACK_CENTER: LatLng = { lat: 13.0435, lng: 80.2425 }; // central Chennai

/** Vehicle types offered when saving a vehicle. */
export const VEHICLE_TYPES = ["Bike", "Hatchback", "Sedan", "SUV"] as const;

/** Anything coarser than this is an IP/Wi-Fi guess, not a real GPS fix. */
export const COARSE_ACCURACY_M = 5000;

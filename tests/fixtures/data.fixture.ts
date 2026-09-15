/**
 * Test data builders.
 *
 * Everything here is unique per run. The old scripts hit this the hard
 * way: `spots` has a UNIQUE (name, address) constraint, so a re-run with
 * a fixed listing name collided with the leftover row from the previous
 * run — which is why drive.mjs built names out of `Date.now()`.
 */

import type { SpotDraft } from "@pages/OwnerDashboardPage";

let seq = 0;

/**
 * A unique-across-workers token.
 *
 * The pid and random block are load-bearing: each Playwright worker is a
 * separate process, so `seq` restarts at 1 in every one of them and a
 * timestamp+counter alone collides whenever two workers land in the same
 * millisecond. `spots` has UNIQUE (name, address), so a collision is a
 * spurious failure rather than a warning.
 */
const stamp = (): string => {
  seq += 1;
  return [
    Date.now().toString(36),
    process.pid.toString(36),
    Math.random().toString(36).slice(2, 8),
    seq,
  ].join("-");
};

/** A listing guaranteed not to collide with UNIQUE (name, address). */
export const spotDraft = (overrides: Partial<SpotDraft> = {}): SpotDraft => {
  const id = stamp();
  return {
    name: `E2E Bay ${id}`,
    address: `${id} Test Street, Chennai`,
    price: 40,
    type: "Covered",
    vehicle: "Sedan",
    available: "24/7",
    ...overrides,
  };
};

/**
 * A vehicle with a genuinely unique plate.
 *
 * Getting this wrong is subtle: an earlier version built the plate from
 * the timestamp and then `.slice(0, 6)`, which chopped off the very
 * counter that made it unique — two drafts created in the same
 * millisecond came out identical, and a `hasText` row locator then
 * matched both. The counter goes at the END and is never truncated.
 */
export const vehicleDraft = (
  overrides: Partial<{ label: string; plate: string; type: string }> = {},
) => {
  const unique = stamp().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return {
    label: `E2E Car ${unique}`,
    plate: `TN${unique}`,
    type: "Sedan",
    ...overrides,
  };
};

/**
 * Card numbers. The app validates with Luhn and stores only brand/last4,
 * so these are standard published test numbers, not real cards.
 */
export const CARDS = {
  validVisa: { number: "4111111111111111", expiry: "12/34", last4: "1111" },
  validMastercard: { number: "5555555555554444", expiry: "11/33", last4: "4444" },
  /* Fails the Luhn check — the UI must reject it before it reaches the API. */
  luhnFailure: { number: "4111111111111112", expiry: "12/34" },
  tooShort: { number: "411111", expiry: "12/34" },
  expired: { number: "4111111111111111", expiry: "01/20" },
} as const;

/** Coordinates used across the location specs. */
export const PLACES = {
  teynampet: { latitude: 13.0392, longitude: 80.2489 },
  centralChennai: { latitude: 13.0435, longitude: 80.2425 },
  /* Far enough that the seeded Chennai listings fall outside any sane
     radius — the "nothing in range" empty state. */
  delhi: { latitude: 28.6139, longitude: 77.209 },
} as const;

export const BOOKING_HOURS = {
  minimum: 1,
  typical: 2,
  long: 8,
} as const;

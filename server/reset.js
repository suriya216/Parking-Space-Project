// Restores the demo dataset after test runs.
//
//   npm run db:reset
//
// Test runs add users and bookings, create and delete spots, toggle
// `verified`, and save vehicles. Deleting the extras is not
// enough: a run can also DELETE a seeded spot (and cascade its bookings),
// so this clears the deltas and then re-runs the seed, which is
// idempotent and re-inserts anything missing.

import { DB_PATH, close, one, query, seed } from "./db.js";

// This script deletes every account except the three seeded ones. Against
// the real database that would wipe every registered user, so it only ever
// runs against the local PGlite database.
if ((process.env.DATABASE_URL ?? "").trim()) {
  console.error(
    "reset refused: DATABASE_URL is set, so this would delete real users.\n" +
      "Unset DATABASE_URL to reset the local database.",
  );
  process.exit(1);
}

console.log(`[reset] ${DB_PATH}`);

const SEED_ACCOUNTS = ["admin@parkspace.test|admin", "owner@parkspace.test|owner", "driver@parkspace.test|driver"];
const SEED_SPOTS = [
  "Lakshmi Residency", "Kumar's driveway", "Selva Complex parking",
  "Priya's compound", "Rajan Towers", "Green Park residence",
];
const VERIFIED = ["Lakshmi Residency", "Selva Complex parking", "Rajan Towers"];

const count = async (t) => (await one(`SELECT COUNT(*)::int AS n FROM ${t}`)).n;
const snapshot = async () => ({
  users: await count("users"), spots: await count("spots"), bookings: await count("bookings"),
  vehicles: await count("vehicles"), favourites: await count("favourites"),
});

const before = await snapshot();

// ── clear the deltas ──
// Order matters. `spots.created_by` is "INTEGER REFERENCES users(id)"
// with no ON DELETE CASCADE, so deleting a user who still owns a listing
// fails with a foreign key violation. Drop the non-seed spots first and
// the references are gone before the users are.
//
// This only bites once a test registers a throwaway owner AND creates a
// listing as them — which the Playwright owner/admin specs do.
await query("DELETE FROM spots WHERE NOT (name = ANY($1::text[]))", [SEED_SPOTS]);
// Accounts are keyed on (email, role), so a test can add a second-role
// account on a seeded email; match the pair, not the email alone.
await query("DELETE FROM users WHERE NOT (lower(email) || '|' || role = ANY($1::text[]))", [SEED_ACCOUNTS]);
// All of them: seed() only recreates the canonical three when the table is
// empty, and any survivor may have been extended or cancelled by a test.
await query("DELETE FROM bookings");
await query("DELETE FROM vehicles");
await query("DELETE FROM favourites");

// ── re-seed anything missing (spots, bookings, favourite, vehicle) ──
const added = await seed();

// ── restore verification flags, which tests toggle ──
await query("UPDATE spots SET verified = 1 WHERE name = ANY($1::text[])", [VERIFIED]);
await query("UPDATE spots SET verified = 0 WHERE NOT (name = ANY($1::text[]))", [VERIFIED]);

const after = await snapshot();

console.log("before:", before);
console.log("seeded:", added);
console.log("after :", after);

const problems = [];
if (after.users !== 3) problems.push(`expected 3 users, got ${after.users}`);
if (after.spots !== 6) problems.push(`expected 6 spots, got ${after.spots}`);
if (after.bookings !== 3) problems.push(`expected 3 bookings, got ${after.bookings}`);

if (problems.length) {
  console.error("\nreset did not reach the expected state:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log("\ndemo data restored: 3 users, 6 spots, 3 bookings.");
}

await close();

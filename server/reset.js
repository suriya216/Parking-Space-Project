// Restores the demo dataset after test runs.
//
//   npm run db:reset
//
// Test runs add users and bookings, create and delete spots, toggle
// `verified`, and save vehicles and cards. Deleting the extras is not
// enough: a run can also DELETE a seeded spot (and cascade its bookings),
// so this clears the deltas and then re-runs the seed, which is
// idempotent and re-inserts anything missing.

import { DatabaseSync } from "node:sqlite";
import { DB_PATH, seed } from "./db.js";

const db = new DatabaseSync(DB_PATH);

const SEED_EMAILS = ["admin@parkspace.test", "owner@parkspace.test", "driver@parkspace.test"];
const SEED_SPOTS = [
  "Lakshmi Residency", "Kumar's driveway", "Selva Complex parking",
  "Priya's compound", "Rajan Towers", "Green Park residence",
];
const VERIFIED = ["Lakshmi Residency", "Selva Complex parking", "Rajan Towers"];

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const snapshot = () => ({
  users: count("users"), spots: count("spots"), bookings: count("bookings"),
  vehicles: count("vehicles"), cards: count("payment_methods"), favourites: count("favourites"),
});

const before = snapshot();
const list = (arr) => arr.map(() => "?").join(",");

// ── clear the deltas ──
// Order matters. `spots.created_by` is "INTEGER REFERENCES users(id)"
// with no ON DELETE CASCADE, so deleting a user who still owns a listing
// fails with "FOREIGN KEY constraint failed". Drop the non-seed spots
// first and the references are gone before the users are.
//
// This only bites once a test registers a throwaway owner AND creates a
// listing as them — which the Playwright owner/admin specs do, and the
// older e2e scripts never did.
db.prepare(`DELETE FROM spots WHERE name NOT IN (${list(SEED_SPOTS)})`).run(...SEED_SPOTS);
db.prepare(`DELETE FROM users WHERE email NOT IN (${list(SEED_EMAILS)})`).run(...SEED_EMAILS);
// All of them: seed() only recreates the canonical three when the table is
// empty, and any survivor may have been extended or cancelled by a test.
db.prepare("DELETE FROM bookings").run();
db.prepare("DELETE FROM vehicles").run();
db.prepare("DELETE FROM payment_methods").run();
db.prepare("DELETE FROM favourites").run();

// ── re-seed anything missing (spots, bookings, favourite, vehicle) ──
const added = seed();

// ── restore verification flags, which tests toggle ──
db.prepare(`UPDATE spots SET verified = 1 WHERE name IN (${list(VERIFIED)})`).run(...VERIFIED);
db.prepare(`UPDATE spots SET verified = 0 WHERE name NOT IN (${list(VERIFIED)})`).run(...VERIFIED);

const after = snapshot();

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

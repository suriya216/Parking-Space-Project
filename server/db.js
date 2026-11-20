import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// ─── BACKEND ────────────────────────────────────────────
// Two backends, one SQL dialect (Postgres):
//
//   DATABASE_URL set  → a real Postgres server (Neon, Supabase, ...). This
//                       is what a deployment uses, because a host with an
//                       ephemeral disk (Render's free tier) loses any local
//                       file on every restart.
//   DATABASE_URL unset → PGlite, Postgres compiled to WASM, persisted in a
//                       local directory. This is what `npm run dev` and the
//                       Playwright suite use, so nothing needs installing.
//
// DATA_DIR is where local mutable state lives (the PGlite directory and
// uploaded photos). Defaults to this directory for local development.
export const DATA_DIR = process.env.DATA_DIR ?? here;

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();
const LOCAL_PATH = process.env.PARKSPACE_DB ?? join(DATA_DIR, "pgdata");

// A label for logs and /api/health. Never the connection string, which
// carries the password.
export const DB_PATH = DATABASE_URL ? "postgres (DATABASE_URL)" : `pglite:${LOCAL_PATH}`;

let pool = null;
let lite = null;

if (DATABASE_URL) {
  // COUNT(*) is a bigint, which node-postgres returns as a string by
  // default. Every count here is far below 2^53, so a number is safe.
  pg.types.setTypeParser(20, (v) => Number(v));
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 5,
    // Neon suspends an idle compute and drops its connections; do not hold
    // them open, and allow time for a cold start to wake the database.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000,
  });
  // An idle client being dropped by the server must not crash the process.
  pool.on("error", (e) => console.error("[db] idle client error:", e.message));
} else {
  mkdirSync(LOCAL_PATH, { recursive: true });
  lite = new PGlite(LOCAL_PATH, { parsers: { 20: (v) => Number(v) } });
  await lite.waitReady;
}

const shape = (r) => ({ rows: r.rows, count: r.rowCount ?? r.affectedRows ?? 0 });

/** Run one parameterised statement. Returns `{ rows, count }`. */
const query = async (text, params = []) =>
  shape(pool ? await pool.query(text, params) : await lite.query(text, params));

/** Run several statements with no parameters (schema setup). */
const execScript = async (text) => {
  if (pool) await pool.query(text);
  else await lite.exec(text);
};

/** Run `fn(q)` inside a transaction; `q` is `query` bound to that transaction. */
const transaction = async (fn) => {
  if (lite) {
    return lite.transaction(async (tx) => fn(async (text, params = []) => shape(await tx.query(text, params))));
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(async (text, params = []) => shape(await client.query(text, params)));
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

export const close = async () => {
  if (pool) await pool.end();
  else await lite.close();
};

const one = async (text, params) => (await query(text, params)).rows[0];
const all = async (text, params) => (await query(text, params)).rows;

// Timestamps are stored as "YYYY-MM-DD HH24:MI:SS" UTC text, the same shape
// the client already receives, rather than as native timestamps.
const NOW_TEXT = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

// ─── SCHEMA ─────────────────────────────────────────────
// An account is identified by email AND role, not by email alone. One
// person who both parks and rents out a space holds two accounts on the
// same address, each with its own password. They are genuinely separate:
// separate passwords, separate bookings, separate listings, separate profile.
//
// Email is compared case-insensitively through the lower(email) index and
// `lower(email) = lower($1)` in every lookup.
await execScript(`
  CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    pass_hash   TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('driver', 'owner', 'admin')),
    created_at  TEXT NOT NULL DEFAULT (${NOW_TEXT}),
    upi_id      TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL DEFAULT '',
    -- OAuth identity. 'local' means a password account; otherwise the issuing
    -- provider plus that provider's immutable subject id for this user.
    provider    TEXT NOT NULL DEFAULT 'local',
    provider_id TEXT,
    avatar      TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_idx ON users (lower(email), role);
  CREATE UNIQUE INDEX IF NOT EXISTS users_provider_idx
    ON users (provider, provider_id) WHERE provider_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS spots (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    address    TEXT NOT NULL,
    type       TEXT NOT NULL,
    vehicle    TEXT NOT NULL,
    price      DOUBLE PRECISION NOT NULL,
    rating     DOUBLE PRECISION NOT NULL DEFAULT 0,
    reviews    INTEGER NOT NULL DEFAULT 0,
    verified   INTEGER NOT NULL DEFAULT 0,
    lat        DOUBLE PRECISION NOT NULL,
    lng        DOUBLE PRECISION NOT NULL,
    photo      TEXT NOT NULL,
    owner      TEXT NOT NULL,
    available  TEXT NOT NULL,
    since      INTEGER NOT NULL,
    -- JSON array of accepted payment methods: ["online", "cash"]
    accepted_payment_methods TEXT NOT NULL DEFAULT '["online","cash"]',
    created_by INTEGER REFERENCES users(id),
    UNIQUE (name, address)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id    INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    ref        TEXT NOT NULL UNIQUE,
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    hours      INTEGER NOT NULL CHECK (hours > 0),
    total      DOUBLE PRECISION NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed', 'cancelled')),
    -- confirmed (online payment), pending (cash), or failed
    payment_status TEXT NOT NULL DEFAULT 'confirmed'
               CHECK (payment_status IN ('confirmed', 'pending', 'failed')),
    created_at TEXT NOT NULL DEFAULT (${NOW_TEXT}),
    -- ISO timestamp of when the slot starts, so extending a booking can
    -- recompute the end of the window.
    start_at   TEXT,
    -- How it was paid for, as a display label only ("Visa ···· 4242").
    paid_via   TEXT NOT NULL DEFAULT '',
    -- Unguessable handle for the booking's pass. The QR encodes THIS, never
    -- the ref: refs are five digits, so a ref-keyed public lookup could be
    -- enumerated in a few thousand requests.
    pass_token TEXT,
    -- Set when the spot's owner confirms the driver turned up and parked.
    arrived_at TEXT,
    arrived_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS favourites (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id    INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (${NOW_TEXT}),
    PRIMARY KEY (user_id, spot_id)
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    plate      TEXT NOT NULL,
    type       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
  );

  -- Photos an owner has uploaded, so they can be reused on later
  -- listings instead of re-capturing the same driveway.
  CREATE TABLE IF NOT EXISTS spot_photos (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path       TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (${NOW_TEXT})
  );

  -- Only a SHA-256 of the token is stored, so a copy of the database cannot
  -- be turned into working reset links.
  CREATE TABLE IF NOT EXISTS password_resets (
    id         SERIAL PRIMARY KEY,
    email      TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

// ─── PASSWORD HASHING (scrypt, from node:crypto) ────────
// Stored as "salt:hash", both hex. scrypt is a deliberately slow KDF,
// so a leaked table can't be reversed with a cheap dictionary sweep.
const hashPassword = (password) => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
};

// Marks an account that can only sign in through an identity provider.
// It is not a hash, so verifyPassword can never match it.
export const OAUTH_ONLY = "!oauth";

const verifyPassword = (password, stored) => {
  if (stored === OAUTH_ONLY) return false;
  const [saltHex, hashHex] = String(stored).split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  // Constant-time compare: a plain === leaks how much of the hash matched.
  return timingSafeEqual(expected, actual);
};

// ─── SEED TEST ACCOUNTS ─────────────────────────────────
// One per role, inserted only when that email is absent, so restarts
// and later registrations are preserved.
const SEED_USERS = [
  { name: "Admin User", email: "admin@parkspace.test", password: "Admin@123", role: "admin" },
  { name: "Lakshmi S.", email: "owner@parkspace.test", password: "Owner@123", role: "owner" },
  { name: "Rajesh Kumar", email: "driver@parkspace.test", password: "Driver@123", role: "driver" },
];

// Real Chennai coordinates, so distances and map placement are genuine
// rather than the percentage-based fake positions used before.
const SEED_SPOTS = [
  { name: "Lakshmi Residency", address: "14 Gandhi St, T. Nagar", type: "Covered", vehicle: "Sedan/SUV", price: 40, rating: 4.9, reviews: 247, verified: 1, lat: 13.0418, lng: 80.2341, photo: "/spots/covered-garage.svg", owner: "Lakshmi S.", available: "Mon–Sat, 8 AM – 8 PM", since: 2025, acceptedPaymentMethods: '["online","cash"]' },
  { name: "Kumar's driveway", address: "8 Lake View Rd, Nungambakkam", type: "Open", vehicle: "Sedan", price: 25, rating: 4.6, reviews: 89, verified: 0, lat: 13.0569, lng: 80.2425, photo: "/spots/open-driveway.svg", owner: "Arun K.", available: "Daily, 9 AM – 9 PM", since: 2026, acceptedPaymentMethods: '["online","cash"]' },
  { name: "Selva Complex parking", address: "22 Anna Salai, Teynampet", type: "Covered", vehicle: "All", price: 55, rating: 4.8, reviews: 412, verified: 1, lat: 13.0392, lng: 80.2489, photo: "/spots/basement-lot.svg", owner: "Selvaraj M.", available: "24/7", since: 2024, acceptedPaymentMethods: '["online"]' },
  { name: "Priya's compound", address: "5 Cenotaph Rd, Alwarpet", type: "Open", vehicle: "Bike/Sedan", price: 20, rating: 4.3, reviews: 34, verified: 0, lat: 13.0339, lng: 80.2532, photo: "/spots/gated-compound.svg", owner: "Priya R.", available: "Mon–Fri, 7 AM – 7 PM", since: 2026, acceptedPaymentMethods: '["cash"]' },
  { name: "Rajan Towers", address: "18 TTK Rd, Mylapore", type: "Covered", vehicle: "SUV", price: 60, rating: 4.7, reviews: 178, verified: 1, lat: 13.0338, lng: 80.2619, photo: "/spots/basement-lot.svg", owner: "Rajan V.", available: "Daily, 6 AM – 11 PM", since: 2025, acceptedPaymentMethods: '["online"]' },
  { name: "Green Park residence", address: "3 Bharathi St, Kodambakkam", type: "Open", vehicle: "Sedan/Bike", price: 15, rating: 4.1, reviews: 22, verified: 0, lat: 13.0510, lng: 80.2260, photo: "/spots/open-driveway.svg", owner: "Meera G.", available: "Weekdays only", since: 2026, acceptedPaymentMethods: '["online","cash"]' },
];

// Fallback map centre when the browser won't share a location: central
// Chennai, roughly the middle of the seeded spots.
export const DEFAULT_CENTER = { lat: 13.0435, lng: 80.2425 };

export const seed = async () => {
  let users = 0;
  for (const u of SEED_USERS) {
    // DO NOTHING rather than an update: an existing seed account keeps
    // whatever password it has now, so restarts don't undo a change. Check
    // first so a restart doesn't pay for a scrypt it will throw away.
    if (await findAccount(u.email, u.role)) continue;
    users += (
      await query(
        `INSERT INTO users (name, email, pass_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lower(email), role) DO NOTHING`,
        [u.name, u.email, hashPassword(u.password), u.role],
      )
    ).count;
  }

  // ON CONFLICT against the (name, address) unique key keeps seeding
  // idempotent across restarts.
  let spots = 0;
  for (const s of SEED_SPOTS) {
    spots += (
      await query(
        `INSERT INTO spots (name, address, type, vehicle, price, rating, reviews,
                            verified, lat, lng, photo, owner, available, since, accepted_payment_methods)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (name, address) DO NOTHING`,
        [s.name, s.address, s.type, s.vehicle, s.price, s.rating, s.reviews, s.verified,
          s.lat, s.lng, s.photo, s.owner, s.available, s.since, s.acceptedPaymentMethods],
      )
    ).count;
  }

  // Link seeded spots to the seeded owner account by matching display name,
  // so the owner dashboard shows a real listing it can manage.
  await query(`
    UPDATE spots SET created_by = (
      SELECT id FROM users WHERE role = 'owner' AND users.name = spots.owner LIMIT 1
    )
    WHERE created_by IS NULL
      AND EXISTS (SELECT 1 FROM users WHERE role = 'owner' AND users.name = spots.owner)
  `);

  // Give the demo driver some booking history, but only on a fresh
  // database — otherwise cancelling a seeded booking would undo itself.
  let bookings = 0;
  const driver = await one("SELECT id FROM users WHERE lower(email) = $1", ["driver@parkspace.test"]);
  const existing = (await one("SELECT COUNT(*)::int AS n FROM bookings")).n;

  if (driver && existing === 0) {
    const byName = (n) => one("SELECT * FROM spots WHERE name = $1", [n]);
    const seedBookings = [
      { spot: "Lakshmi Residency", ref: "PS-78421", date: "7 Sep 2026", time: "10:00 AM – 2:00 PM", hours: 4, status: "active", paidVia: "Visa ···· 4242" },
      { spot: "Selva Complex parking", ref: "PS-78390", date: "6 Sep 2026", time: "1:00 PM – 5:00 PM", hours: 4, status: "completed", paidVia: "UPI rajesh@okaxis" },
      { spot: "Lakshmi Residency", ref: "PS-78355", date: "5 Sep 2026", time: "9:00 AM – 12:00 PM", hours: 3, status: "completed", paidVia: "Visa ···· 4242" },
    ];
    for (const b of seedBookings) {
      const spot = await byName(b.spot);
      if (!spot) continue;
      bookings += (
        await query(
          `INSERT INTO bookings (user_id, spot_id, ref, date, time, hours, total, status, paid_via)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [driver.id, spot.id, b.ref, b.date, b.time, b.hours,
            Math.round(spot.price * b.hours * 1.1), b.status, b.paidVia],
        )
      ).count;
    }

    // One favourite so the Saved tab isn't empty on first run.
    const fav = await byName("Rajan Towers");
    if (fav) {
      await query(
        "INSERT INTO favourites (user_id, spot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [driver.id, fav.id],
      );
    }
    await query("INSERT INTO vehicles (user_id, label, plate, type) VALUES ($1, $2, $3, $4)",
      [driver.id, "Hyundai i20", "TN 09 BX 4412", "Sedan"]);
  }

  // Seeded rows are inserted without a pass token; give every booking one so
  // its QR resolves.
  const passTokens = await backfillPassTokens();

  return { users, spots, bookings, passTokens };
};

// ─── SPOTS ──────────────────────────────────────────────
const R_EARTH_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

// Haversine great-circle distance in metres.
export const distanceMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R_EARTH_M * Math.asin(Math.sqrt(h)));
};

const rowToSpot = (r) => ({ ...r, verified: Boolean(r.verified) });

export const listSpots = async ({ lat, lng, radius } = {}) => {
  const rows = (await all("SELECT * FROM spots ORDER BY id")).map(rowToSpot);

  // No origin given: return every spot with no distance attached, so the
  // client can't mistake a missing distance for "0 m away".
  if (lat == null || lng == null) return rows.map((s) => ({ ...s, distance: null }));

  const origin = { lat, lng };
  return rows
    .map((s) => ({ ...s, distance: distanceMeters(origin, s) }))
    .filter((s) => radius == null || s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
};

export const countSpots = async () =>
  (await one("SELECT COUNT(*)::int AS n FROM spots")).n;

export const findSpot = async (id) => {
  const row = await one("SELECT * FROM spots WHERE id = $1", [id]);
  return row ? rowToSpot(row) : null;
};

export const createSpot = async (s) => {
  const row = await one(
    `INSERT INTO spots (name, address, type, vehicle, price, rating, reviews,
                        verified, lat, lng, photo, owner, available, since, created_by)
     VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [s.name, s.address, s.type, s.vehicle, s.price, s.lat, s.lng, s.photo,
      s.owner, s.available, new Date().getFullYear(), s.createdBy],
  );
  return findSpot(row.id);
};

export const setSpotVerified = async (id, verified) => {
  await query("UPDATE spots SET verified = $1 WHERE id = $2", [verified ? 1 : 0, id]);
  return findSpot(id);
};

export const deleteSpot = async (id) =>
  (await query("DELETE FROM spots WHERE id = $1", [id])).count;

// ─── BOOKINGS ───────────────────────────────────────────
// Every booking row is returned with its spot nested, so the client never
// has to join the two lists itself.
const BOOKING_SELECT = `
  SELECT b.id, b.ref, b.date, b.time, b.hours, b.total, b.status, b.created_at,
         b.user_id, b.spot_id, b.paid_via, b.payment_status, b.pass_token, b.arrived_at,
         b.arrived_by, u.name AS user_name, u.email AS user_email
  FROM bookings b
  JOIN users u ON u.id = b.user_id
`;

const hydrateBooking = async (row) => {
  if (!row) return null;
  const { user_name, user_email, ...b } = row;
  return { ...b, user: { id: row.user_id, name: user_name, email: user_email }, spot: await findSpot(row.spot_id) };
};

export const findBooking = async (id) =>
  hydrateBooking(await one(`${BOOKING_SELECT} WHERE b.id = $1`, [id]));

// Drivers see their own bookings; owners see bookings made against the
// spots they own; admins see everything.
export const listBookingsForUser = async (user) => {
  let rows;
  if (user.role === "admin") {
    rows = await all(`${BOOKING_SELECT} ORDER BY b.id DESC`);
  } else if (user.role === "owner") {
    rows = await all(
      `${BOOKING_SELECT} WHERE b.spot_id IN (SELECT id FROM spots WHERE created_by = $1)
       ORDER BY b.id DESC`,
      [user.id],
    );
  } else {
    rows = await all(`${BOOKING_SELECT} WHERE b.user_id = $1 ORDER BY b.id DESC`, [user.id]);
  }
  return Promise.all(rows.map(hydrateBooking));
};

const newRef = () => `PS-${Math.floor(10000 + Math.random() * 90000)}`;

// 128 bits of randomness, hex. The pass endpoint is reachable without a
// session — holding the token IS the proof you were shown the code — so it
// has to be unguessable in a way the five-digit ref is not.
const newPassToken = () => randomBytes(16).toString("hex");

// Bookings created before pass_token existed (and the seeded rows) need one
// too, otherwise their QR has nothing to point at.
export const backfillPassTokens = async () => {
  const rows = await all("SELECT id FROM bookings WHERE pass_token IS NULL");
  for (const r of rows) {
    await query("UPDATE bookings SET pass_token = $1 WHERE id = $2", [newPassToken(), r.id]);
  }
  return rows.length;
};

// Display helpers. Times are rendered in India Standard Time because the
// listings are all Chennai and the server may run in any zone.
const IST = "Asia/Kolkata";

// Uppercase the meridiem so new rows match the "9:00 AM" style already
// used by the seeded bookings.
const fmtClock = (d) =>
  d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());

const fmtDay = (d) =>
  d.toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });

/** "10:00 AM – 2:00 PM" for a start instant plus a duration. */
const windowLabel = (startISO, hours) => {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + hours * 3600_000);
  return `${fmtClock(start)} – ${fmtClock(end)}`;
};

export const createBooking = async ({ userId, spotId, hours, startAt, paidVia = "", paymentStatus = "confirmed" }) => {
  const spot = await findSpot(spotId);
  if (!spot) return null;
  // Price is recomputed from the stored spot price rather than trusted
  // from the client, so the total can't be tampered with.
  const total = Math.round(spot.price * hours * 1.1);

  const start = startAt ? new Date(startAt) : new Date();
  const startISO = start.toISOString();

  let ref = newRef();
  // Guard against the tiny chance of colliding with an existing ref.
  while (await one("SELECT 1 FROM bookings WHERE ref = $1", [ref])) ref = newRef();

  const row = await one(
    `INSERT INTO bookings
       (user_id, spot_id, ref, date, time, hours, total, start_at, paid_via, pass_token, payment_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [userId, spotId, ref, fmtDay(start), windowLabel(startISO, hours), hours, total,
      startISO, paidVia, newPassToken(), paymentStatus],
  );
  return findBooking(row.id);
};

/** Lookup behind the QR code. Keyed on the pass token, never the ref. */
export const findBookingByPassToken = async (token) =>
  hydrateBooking(await one(`${BOOKING_SELECT} WHERE b.pass_token = $1`, [token]));

/**
 * Records that the owner saw the car in the space. Idempotent: a second
 * scan keeps the first timestamp rather than quietly moving arrival later.
 */
export const markBookingArrived = async (id, byUserId) => {
  await query(
    `UPDATE bookings SET arrived_at = ${NOW_TEXT}, arrived_by = $1 WHERE id = $2 AND arrived_at IS NULL`,
    [byUserId, id],
  );
  return findBooking(id);
};

/**
 * Records that the owner has been handed the cash for a booking. Only a
 * cash booking is ever 'pending', so this can't touch an online payment.
 */
export const confirmCashPayment = async (id) => {
  await query(
    "UPDATE bookings SET payment_status = 'confirmed' WHERE id = $1 AND payment_status = 'pending'",
    [id],
  );
  return findBooking(id);
};

export const setBookingStatus = async (id, status) => {
  await query("UPDATE bookings SET status = $1 WHERE id = $2", [status, id]);
  return findBooking(id);
};

export const extendBooking = async (id, extraHours) => {
  const b = await one("SELECT * FROM bookings WHERE id = $1", [id]);
  if (!b) return null;
  const spot = await findSpot(b.spot_id);
  const hours = b.hours + extraHours;
  const total = Math.round(spot.price * hours * 1.1);

  // Push out the end of the window too. Seeded rows predate start_at, so
  // their existing label is left alone rather than invented.
  const time = b.start_at ? windowLabel(b.start_at, hours) : b.time;

  await query("UPDATE bookings SET hours = $1, total = $2, time = $3 WHERE id = $4",
    [hours, total, time, id]);
  return findBooking(id);
};

export const countBookings = async () =>
  (await one("SELECT COUNT(*)::int AS n FROM bookings")).n;

// Owner earnings: only active/completed bookings count toward revenue.
export const ownerEarnings = async (ownerId) =>
  one(
    `SELECT COALESCE(SUM(b.total), 0)::float AS revenue, COUNT(*)::int AS bookings
     FROM bookings b
     WHERE b.status != 'cancelled'
       AND b.spot_id IN (SELECT id FROM spots WHERE created_by = $1)`,
    [ownerId],
  );

// ─── FAVOURITES ─────────────────────────────────────────
export const listFavourites = async (userId) =>
  (await all("SELECT spot_id FROM favourites WHERE user_id = $1 ORDER BY created_at DESC, spot_id DESC", [userId]))
    .map((r) => r.spot_id);

export const addFavourite = async (userId, spotId) =>
  (await query(
    "INSERT INTO favourites (user_id, spot_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, spotId],
  )).count;

export const removeFavourite = async (userId, spotId) =>
  (await query("DELETE FROM favourites WHERE user_id = $1 AND spot_id = $2", [userId, spotId])).count;

// ─── VEHICLES ───────────────────────────────────────────
export const listVehicles = (userId) =>
  all("SELECT * FROM vehicles WHERE user_id = $1 ORDER BY id", [userId]);

export const addVehicle = (userId, { label, plate, type }) =>
  one(
    "INSERT INTO vehicles (user_id, label, plate, type) VALUES ($1, $2, $3, $4) RETURNING *",
    [userId, label, plate, type],
  );

export const deleteVehicle = async (userId, id) =>
  (await query("DELETE FROM vehicles WHERE id = $1 AND user_id = $2", [id, userId])).count;

// ─── SPOT PHOTOS ────────────────────────────────────────
export const listSpotPhotos = (userId) =>
  all("SELECT * FROM spot_photos WHERE user_id = $1 ORDER BY id DESC", [userId]);

export const addSpotPhoto = (userId, path, label = "") =>
  one(
    "INSERT INTO spot_photos (user_id, path, label) VALUES ($1, $2, $3) RETURNING *",
    [userId, path, label],
  );

export const findSpotPhoto = (userId, path) =>
  one("SELECT * FROM spot_photos WHERE user_id = $1 AND path = $2", [userId, path]);

export const deleteSpotPhoto = async (userId, id) => {
  const row = await one("SELECT * FROM spot_photos WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!row) return null;
  await query("DELETE FROM spot_photos WHERE id = $1", [id]);
  return row;
};

// ─── USERS ──────────────────────────────────────────────
// `pass_hash` is never selected into anything the API can return.
const PUBLIC_COLS = "id, name, email, phone, role, provider, avatar, upi_id, created_at";

// ─── ROLES ──────────────────────────────────────────────
// An account holds exactly one role, fixed when it is created. Somebody
// who both parks and rents out a space keeps two accounts on the same
// email — see the note on the users table.
//
// `roles` still travels to the client as a one-element list rather than
// being dropped: the admin screen and the Session type read a list, and a
// single shape is easier to reason about than two.
const withRoles = (user) => (user ? { ...user, roles: [user.role] } : user);

// ─── OAUTH IDENTITIES ───────────────────────────────────
export const findByProvider = (provider, providerId) =>
  one(`SELECT ${PUBLIC_COLS} FROM users WHERE provider = $1 AND provider_id = $2`, [provider, providerId]);

/**
 * Resolve an identity-provider profile to a local user.
 *
 * Matching is by provider subject first, then by verified email so an
 * existing password account can be linked rather than duplicated. An
 * unverified provider email is never used to claim an account — that
 * would let anyone who can set an email address at the provider take
 * over a local login.
 */
export const upsertOAuthUser = async ({ provider, providerId, email, name, avatar, emailVerified }) => {
  const existing = await findByProvider(provider, providerId);
  if (existing) {
    await query("UPDATE users SET name = $1, avatar = $2 WHERE id = $3",
      [name || existing.name, avatar ?? existing.avatar, existing.id]);
    return { user: await findUser(existing.id), created: false, linked: false };
  }

  // Provider sign-in lands on the DRIVER account for the address: that is
  // the role an account created here gets. An owner account on the same
  // email is a different account, and is left alone rather than claimed.
  const onAddress = email ? await findAccountsByEmail(email) : [];

  // An unverified address must not touch ANY account on it, in any role:
  // anyone can set an unverified email at the provider, and creating a
  // driver account there would squat an address that belongs to someone else.
  if (onAddress.length > 0 && !emailVerified) {
    return { conflict: "unverified-email" };
  }

  const clash = email ? await findAccount(email, "driver") : null;

  if (clash) {
    await query("UPDATE users SET provider = $1, provider_id = $2, avatar = $3 WHERE id = $4",
      [provider, providerId, avatar ?? "", clash.id]);
    return { user: await findUser(clash.id), created: false, linked: true };
  }

  // `email` is NOT NULL, but a provider may withhold it (a private GitHub
  // address, say). Mint a stable non-routable placeholder, the same
  // approach GitHub itself uses for noreply addresses.
  const storedEmail = email || `${provider}-${providerId}@users.noreply.parkspace.local`;

  // A provider may not give us a name at all — Apple sends one only on
  // the very first authorization ever, so an account created after a
  // re-authorization arrives nameless. Fall back to the email's local
  // part before the generic label, which at least reads as a person.
  const storedName = name || (email ? email.split("@")[0] : "") || "New user";

  const row = await one(
    `INSERT INTO users (name, email, pass_hash, role, provider, provider_id, avatar)
     VALUES ($1, $2, $3, 'driver', $4, $5, $6)
     RETURNING id`,
    [storedName, storedEmail, OAUTH_ONLY, provider, providerId, avatar ?? ""],
  );

  return {
    user: await findUser(row.id),
    created: true,
    linked: false,
    placeholderEmail: !email,
  };
};

/**
 * The one account on this address acting in this role, or undefined.
 * Includes pass_hash, so this is for the auth layer only.
 */
export const findAccount = (email, role) =>
  one("SELECT * FROM users WHERE lower(email) = lower($1) AND role = $2", [email, role]);

/** Every account registered on an address — at most one per role. */
export const findAccountsByEmail = async (email) =>
  (await all(`SELECT ${PUBLIC_COLS} FROM users WHERE lower(email) = lower($1) ORDER BY role`, [email]))
    .map(withRoles);

export const findUser = async (id) =>
  withRoles(await one(`SELECT ${PUBLIC_COLS} FROM users WHERE id = $1`, [id]));

// Includes pass_hash, for the auth layer only. Callers must strip it
// before anything reaches a response body.
export const findUserWithHash = (id) =>
  one("SELECT * FROM users WHERE id = $1", [id]);

export const updateUserProfile = async (id, { name, email, phone, upiId }) => {
  await query("UPDATE users SET name = $1, email = $2, phone = $3, upi_id = $4 WHERE id = $5",
    [name, email, phone, upiId ?? "", id]);
  // Spot rows carry a denormalised owner display name; keep it in step so
  // an owner renaming themselves doesn't orphan their listings.
  await query("UPDATE spots SET owner = $1 WHERE created_by = $2", [name, id]);
  return findUser(id);
};

/**
 * Admin action: move an account to a different role.
 *
 * Returns null when this address already has an account in the target
 * role, because (email, role) is unique — the two would have to be merged,
 * and folding one account's bookings into another's is not something a
 * role dropdown should decide to do.
 */
export const setUserRole = async (id, role) => {
  const target = await one("SELECT email FROM users WHERE id = $1", [id]);
  if (!target) return null;
  const taken = await findAccount(target.email, role);
  if (taken && taken.id !== id) return null;
  await query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
  return findUser(id);
};

export const deleteUser = async (id) =>
  (await query("DELETE FROM users WHERE id = $1", [id])).count;

export const countAdmins = async () =>
  (await one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'")).n;

export const changePassword = async (id, password) => {
  await query("UPDATE users SET pass_hash = $1 WHERE id = $2", [hashPassword(password), id]);
  return findUser(id);
};

// ─── PASSWORD RESET TOKENS ──────────────────────────────
// Tokens are 256 random bits, which is why a fast hash is fine here
// (unlike passwords).
export const RESET_TTL_MINUTES = 30;
// One email per address per minute, so the form cannot be used to flood
// someone's inbox or burn through the mail quota.
const RESET_COOLDOWN_SECONDS = 60;
const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

/**
 * Start a reset for an address. Returns `{ token, name }`, or null when no
 * password-based account exists there (accounts that sign in through an
 * identity provider have no password to reset). Any earlier unused link for
 * the address is revoked, so only the newest email works.
 */
export const createPasswordReset = async (email) => {
  const account = await one(
    "SELECT name FROM users WHERE lower(email) = lower($1) AND provider = 'local' AND pass_hash <> $2 ORDER BY id LIMIT 1",
    [email, OAUTH_ONLY],
  );
  if (!account) return null;

  const recent = await one(
    "SELECT 1 FROM password_resets WHERE lower(email) = lower($1) AND used_at IS NULL AND created_at > now() - make_interval(secs => $2::int)",
    [email, RESET_COOLDOWN_SECONDS],
  );
  if (recent) return null;

  await query("DELETE FROM password_resets WHERE expires_at < now() OR used_at IS NOT NULL");
  await query("UPDATE password_resets SET used_at = now() WHERE lower(email) = lower($1) AND used_at IS NULL", [email]);

  const token = randomBytes(32).toString("base64url");
  await query(
    "INSERT INTO password_resets (email, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3::int))",
    [email, hashToken(token), RESET_TTL_MINUTES],
  );
  return { token, name: account.name };
};

const findLiveReset = (token) =>
  one(
    "SELECT id, email FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()",
    [hashToken(token)],
  );

export const isPasswordResetValid = async (token) => Boolean(await findLiveReset(token));

/**
 * Spend a reset token and set the new password on every password-based
 * account at that address (an address can hold one account per role).
 * Returns false when the token is unknown, expired or already used.
 */
export const consumePasswordReset = async (token, password) => {
  const reset = await findLiveReset(token);
  if (!reset) return false;
  const hash = hashPassword(password);
  await transaction(async (q) => {
    await q(
      "UPDATE users SET pass_hash = $1 WHERE lower(email) = lower($2) AND provider = 'local' AND pass_hash <> $3",
      [hash, reset.email, OAUTH_ONLY],
    );
    await q("UPDATE password_resets SET used_at = now() WHERE id = $1", [reset.id]);
  });
  return true;
};

export const listUsers = async () =>
  (await all(`SELECT ${PUBLIC_COLS} FROM users ORDER BY id`)).map(withRoles);

export const countUsers = () =>
  all("SELECT role, COUNT(*)::int AS n FROM users GROUP BY role");

export const createUser = async ({ name, email, password, role }) => {
  const row = await one(
    "INSERT INTO users (name, email, pass_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, email, hashPassword(password), role],
  );
  return findUser(row.id);
};

const stripHash = (row) => {
  const { pass_hash: _omit, ...safe } = row;
  return withRoles(safe);
};

/**
 * Check a password against the account for this address AND role.
 *
 * The role is part of the identity, so a driver password will not open the
 * owner account on the same address even though the email is identical.
 */
export const authenticate = async (email, password, role) => {
  const row = await findAccount(email, role);
  if (!row || !verifyPassword(password, row.pass_hash)) return null;
  return stripHash(row);
};

/**
 * Every account on this address whose password is `password`.
 *
 * Sign-in does not make people pick a role up front. Usually only one of
 * the accounts on an address has the password being offered, so the role
 * is implied and there is nothing to ask. It returns a list because that
 * need not hold — somebody who chose the same password for their driver
 * and owner accounts matches both, and only then must the caller ask which
 * one was meant.
 */
export const authenticateAny = async (email, password) =>
  (await all("SELECT * FROM users WHERE lower(email) = lower($1) ORDER BY role", [email]))
    .filter((row) => verifyPassword(password, row.pass_hash))
    .map(stripHash);

/** Re-check the signed-in account's own password, by id. */
export const authenticateById = async (id, password) => {
  const row = await findUserWithHash(id);
  if (!row || !verifyPassword(password, row.pass_hash)) return null;
  return stripHash(row);
};

// Exposed for the maintenance scripts (reset.js, db-query.mjs) only.
export { SEED_USERS, query, all, one };

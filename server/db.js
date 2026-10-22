import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// DATA_DIR is where all mutable state lives, so a deployment can point it
// at a mounted volume (Fly, Docker) and survive redeploys. Defaults to
// this directory for local development.
export const DATA_DIR = process.env.DATA_DIR ?? here;
export const DB_PATH = process.env.PARKSPACE_DB ?? join(DATA_DIR, "parkspace.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  -- An account is identified by email AND role, not by email alone. One
  -- person who both parks and rents out a space holds two accounts on the
  -- same address, each with its own password — the same one or a different
  -- one, whichever they choose. They are genuinely separate: separate
  -- passwords, separate bookings, separate listings, separate profile.
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL COLLATE NOCASE,
    pass_hash  TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('driver', 'owner', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    upi_id     TEXT NOT NULL DEFAULT '',
    UNIQUE (email, role)
  );

  CREATE TABLE IF NOT EXISTS spots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    address    TEXT NOT NULL,
    type       TEXT NOT NULL,
    vehicle    TEXT NOT NULL,
    price      REAL NOT NULL,
    rating     REAL NOT NULL DEFAULT 0,
    reviews    INTEGER NOT NULL DEFAULT 0,
    verified   INTEGER NOT NULL DEFAULT 0,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    photo      TEXT NOT NULL,
    owner      TEXT NOT NULL,
    available  TEXT NOT NULL,
    since      INTEGER NOT NULL,
    accepted_payment_methods TEXT NOT NULL DEFAULT '["online","cash"]',
    UNIQUE (name, address)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id    INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    ref        TEXT NOT NULL UNIQUE,
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    hours      INTEGER NOT NULL CHECK (hours > 0),
    total      REAL NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'completed', 'cancelled')),
    payment_status TEXT NOT NULL DEFAULT 'confirmed'
               CHECK (payment_status IN ('confirmed', 'pending', 'failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS favourites (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id    INTEGER NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, spot_id)
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    plate      TEXT NOT NULL,
    type       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Photos an owner has uploaded, so they can be reused on later
  -- listings instead of re-capturing the same driveway.
  CREATE TABLE IF NOT EXISTS spot_photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path       TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── MIGRATIONS ─────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS won't add columns to a table that already
// exists, so add them explicitly for databases created by an earlier run.
const addColumnIfMissing = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

addColumnIfMissing("users", "phone", "TEXT NOT NULL DEFAULT ''");
// OAuth identity. 'local' means a password account; otherwise the issuing
// provider plus that provider's immutable subject id for this user.
addColumnIfMissing("users", "provider", "TEXT NOT NULL DEFAULT 'local'");
addColumnIfMissing("users", "provider_id", "TEXT");
addColumnIfMissing("users", "avatar", "TEXT NOT NULL DEFAULT ''");
// Owner's UPI id (VPA), where booking payouts are directed. Optional — an
// owner who only takes cash, or hasn't set it up yet, leaves it blank.
addColumnIfMissing("users", "upi_id", "TEXT NOT NULL DEFAULT ''");

// Accounts used to be keyed on email alone, with several roles hanging off
// the one row via a user_roles table. They are now keyed on (email, role),
// so the UNIQUE constraint on email has to go — and in SQLite a column
// constraint can only be removed by rebuilding the table.
//
// Detected by the implicit index SQLite creates for `email TEXT UNIQUE`,
// which the (email, role) schema does not have, so this runs exactly once.
const emailIsUniqueAlone = () =>
  db
    .prepare("PRAGMA index_list(users)")
    .all()
    .filter((i) => i.unique)
    .some((i) => {
      const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(i.name)})`).all();
      return cols.length === 1 && cols[0].name === "email";
    });

if (emailIsUniqueAlone()) {
  // Foreign keys are still off at this point (they go on below), so the
  // drop-and-rename does not cascade bookings, spots or favourites away.
  // Ids carry over verbatim, so every child row still resolves.
  db.exec(`
    CREATE TABLE users_rebuild (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL COLLATE NOCASE,
      pass_hash  TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('driver', 'owner', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      phone      TEXT NOT NULL DEFAULT '',
      provider   TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      avatar     TEXT NOT NULL DEFAULT '',
      UNIQUE (email, role)
    );
    INSERT INTO users_rebuild
      (id, name, email, pass_hash, role, created_at, phone, provider, provider_id, avatar)
    SELECT id, name, email, pass_hash, role, created_at, phone, provider, provider_id, avatar
    FROM users;
    DROP TABLE users;
    ALTER TABLE users_rebuild RENAME TO users;
  `);
}

db.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS users_provider_idx
   ON users(provider, provider_id) WHERE provider_id IS NOT NULL`
);

addColumnIfMissing("spots", "created_by", "INTEGER REFERENCES users(id)");
// JSON array of accepted payment methods: ["online", "cash"]
addColumnIfMissing("spots", "accepted_payment_methods", "TEXT NOT NULL DEFAULT '[\"online\",\"cash\"]'");
// ISO timestamp of when the slot starts. Needed so extending a booking can
// recompute the end of the window rather than showing a vague "Nh from now".
addColumnIfMissing("bookings", "start_at", "TEXT");
// Payment status: confirmed (online payment), pending (cash), or failed
addColumnIfMissing("bookings", "payment_status", "TEXT NOT NULL DEFAULT 'confirmed' CHECK (payment_status IN ('confirmed', 'pending', 'failed'))");
// How the booking was paid for, as a display label only ("Visa ···· 4242",
// "UPI asha@okhdfc"). Payment is taken at booking time and nothing
// reusable is kept, so there is no saved-card table any more.
addColumnIfMissing("bookings", "paid_via", "TEXT NOT NULL DEFAULT ''");
// Unguessable handle for the booking's pass. The QR encodes THIS, never
// the ref: refs are five digits, so a ref-keyed public lookup could be
// enumerated in a few thousand requests.
addColumnIfMissing("bookings", "pass_token", "TEXT");
// Set when the spot's owner confirms the driver turned up and parked.
addColumnIfMissing("bookings", "arrived_at", "TEXT");
addColumnIfMissing("bookings", "arrived_by", "INTEGER REFERENCES users(id)");

// The old multi-role table, from when one row could hold several roles.
// Each extra role becomes its own account on the same email, carrying the
// name and password hash it was granted under — otherwise somebody who had
// signed up as both a driver and an owner would silently lose one of the
// two. Bookings and listings stay with the original row, which keeps
// whichever role it was last acting as.
//
// Runs before foreign keys go on, and before seeding, so the split rows are
// in place by the time anything reads them.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_roles'").get()) {
  const extras = db
    .prepare(
      `SELECT u.name, u.email, u.pass_hash, u.phone, r.role
       FROM user_roles r
       JOIN users u ON u.id = r.user_id
       WHERE r.role != u.role`
    )
    .all();

  const insertSplit = db.prepare(
    `INSERT OR IGNORE INTO users (name, email, pass_hash, role, phone)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const e of extras) {
    insertSplit.run(e.name, e.email, e.pass_hash, e.role, e.phone ?? "");
  }

  db.exec("DROP TABLE user_roles;");
}

db.exec("PRAGMA foreign_keys = ON;");

// Saved cards are gone: payment is collected during booking and only a
// display label survives on the booking row. Dropping the table keeps a
// database created by an earlier version from holding card fragments
// nothing can manage or delete any more.
db.exec("DROP TABLE IF EXISTS payment_methods;");

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

export const seed = () => {
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, pass_hash, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (email, role) DO NOTHING`
  );
  let users = 0;
  for (const u of SEED_USERS) {
    // DO NOTHING rather than an update: an existing seed account keeps
    // whatever password it has now, so restarts don't undo a change.
    users += insertUser.run(u.name, u.email, hashPassword(u.password), u.role).changes;
  }

  // ON CONFLICT against the (name, address) unique key keeps seeding
  // idempotent across restarts.
  const insertSpot = db.prepare(
    `INSERT INTO spots (name, address, type, vehicle, price, rating, reviews,
                        verified, lat, lng, photo, owner, available, since, accepted_payment_methods)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (name, address) DO NOTHING`
  );
  let spots = 0;
  for (const s of SEED_SPOTS) {
    spots += insertSpot.run(s.name, s.address, s.type, s.vehicle, s.price, s.rating,
      s.reviews, s.verified, s.lat, s.lng, s.photo, s.owner, s.available, s.since, s.acceptedPaymentMethods).changes;
  }

  // Link seeded spots to the seeded owner account by matching display name,
  // so the owner dashboard shows a real listing it can manage.
  db.exec(`
    UPDATE spots SET created_by = (
      SELECT id FROM users WHERE role = 'owner' AND users.name = spots.owner LIMIT 1
    )
    WHERE created_by IS NULL
      AND EXISTS (SELECT 1 FROM users WHERE role = 'owner' AND users.name = spots.owner)
  `);

  // Give the demo driver some booking history, but only on a fresh
  // database — otherwise cancelling a seeded booking would undo itself.
  let bookings = 0;
  const driver = db.prepare("SELECT id FROM users WHERE email = ?").get("driver@parkspace.test");
  const existing = db.prepare("SELECT COUNT(*) AS n FROM bookings").get().n;

  if (driver && existing === 0) {
    const insertBooking = db.prepare(
      `INSERT INTO bookings (user_id, spot_id, ref, date, time, hours, total, status, paid_via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const byName = (n) => db.prepare("SELECT * FROM spots WHERE name = ?").get(n);
    const seedBookings = [
      { spot: "Lakshmi Residency", ref: "PS-78421", date: "7 Sep 2026", time: "10:00 AM – 2:00 PM", hours: 4, status: "active", paidVia: "Visa ···· 4242" },
      { spot: "Selva Complex parking", ref: "PS-78390", date: "6 Sep 2026", time: "1:00 PM – 5:00 PM", hours: 4, status: "completed", paidVia: "UPI rajesh@okaxis" },
      { spot: "Lakshmi Residency", ref: "PS-78355", date: "5 Sep 2026", time: "9:00 AM – 12:00 PM", hours: 3, status: "completed", paidVia: "Visa ···· 4242" },
    ];
    for (const b of seedBookings) {
      const spot = byName(b.spot);
      if (!spot) continue;
      bookings += insertBooking.run(driver.id, spot.id, b.ref, b.date, b.time, b.hours,
        Math.round(spot.price * b.hours * 1.1), b.status, b.paidVia).changes;
    }

    // One favourite so the Saved tab isn't empty on first run.
    const fav = byName("Rajan Towers");
    if (fav) {
      db.prepare("INSERT OR IGNORE INTO favourites (user_id, spot_id) VALUES (?, ?)")
        .run(driver.id, fav.id);
    }
    db.prepare("INSERT INTO vehicles (user_id, label, plate, type) VALUES (?, ?, ?, ?)")
      .run(driver.id, "Hyundai i20", "TN 09 BX 4412", "Sedan");
  }

  // Seeded rows are inserted without a pass token, and a database from an
  // earlier version has none at all; give every booking one so its QR
  // resolves. Defined further down the module, which is fine: seed() only
  // ever runs after the module has finished evaluating.
  const passTokens = backfillPassTokens();

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

export const listSpots = ({ lat, lng, radius } = {}) => {
  const rows = db.prepare("SELECT * FROM spots ORDER BY id").all().map(rowToSpot);

  // No origin given: return every spot with no distance attached, so the
  // client can't mistake a missing distance for "0 m away".
  if (lat == null || lng == null) return rows.map((s) => ({ ...s, distance: null }));

  const origin = { lat, lng };
  return rows
    .map((s) => ({ ...s, distance: distanceMeters(origin, s) }))
    .filter((s) => radius == null || s.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
};

export const countSpots = () =>
  db.prepare("SELECT COUNT(*) AS n FROM spots").get().n;

export const findSpot = (id) => {
  const row = db.prepare("SELECT * FROM spots WHERE id = ?").get(id);
  return row ? rowToSpot(row) : null;
};

export const createSpot = (s) => {
  const info = db.prepare(
    `INSERT INTO spots (name, address, type, vehicle, price, rating, reviews,
                        verified, lat, lng, photo, owner, available, since, created_by)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(s.name, s.address, s.type, s.vehicle, s.price, s.lat, s.lng, s.photo,
        s.owner, s.available, new Date().getFullYear(), s.createdBy);
  return findSpot(info.lastInsertRowid);
};

export const setSpotVerified = (id, verified) => {
  db.prepare("UPDATE spots SET verified = ? WHERE id = ?").run(verified ? 1 : 0, id);
  return findSpot(id);
};

export const deleteSpot = (id) =>
  db.prepare("DELETE FROM spots WHERE id = ?").run(id).changes;

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

const hydrateBooking = (row) => {
  if (!row) return null;
  const { user_name, user_email, ...b } = row;
  return { ...b, user: { id: row.user_id, name: user_name, email: user_email }, spot: findSpot(row.spot_id) };
};

export const findBooking = (id) =>
  hydrateBooking(db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id));

// Drivers see their own bookings; owners see bookings made against the
// spots they own; admins see everything.
export const listBookingsForUser = (user) => {
  let rows;
  if (user.role === "admin") {
    rows = db.prepare(`${BOOKING_SELECT} ORDER BY b.id DESC`).all();
  } else if (user.role === "owner") {
    rows = db.prepare(
      `${BOOKING_SELECT} WHERE b.spot_id IN (SELECT id FROM spots WHERE created_by = ?)
       ORDER BY b.id DESC`
    ).all(user.id);
  } else {
    rows = db.prepare(`${BOOKING_SELECT} WHERE b.user_id = ? ORDER BY b.id DESC`).all(user.id);
  }
  return rows.map(hydrateBooking);
};

const newRef = () => `PS-${Math.floor(10000 + Math.random() * 90000)}`;

// 128 bits of randomness, hex. The pass endpoint is reachable without a
// session — holding the token IS the proof you were shown the code — so it
// has to be unguessable in a way the five-digit ref is not.
const newPassToken = () => randomBytes(16).toString("hex");

// Bookings created before pass_token existed (and the seeded rows) need one
// too, otherwise their QR has nothing to point at.
export const backfillPassTokens = () => {
  const rows = db.prepare("SELECT id FROM bookings WHERE pass_token IS NULL").all();
  const set = db.prepare("UPDATE bookings SET pass_token = ? WHERE id = ?");
  for (const r of rows) set.run(newPassToken(), r.id);
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

export const createBooking = ({ userId, spotId, hours, startAt, paidVia = "", paymentStatus = "confirmed" }) => {
  const spot = findSpot(spotId);
  if (!spot) return null;
  // Price is recomputed from the stored spot price rather than trusted
  // from the client, so the total can't be tampered with.
  const total = Math.round(spot.price * hours * 1.1);

  const start = startAt ? new Date(startAt) : new Date();
  const startISO = start.toISOString();

  let ref = newRef();
  // Guard against the tiny chance of colliding with an existing ref.
  while (db.prepare("SELECT 1 FROM bookings WHERE ref = ?").get(ref)) ref = newRef();

  const info = db.prepare(
    `INSERT INTO bookings
       (user_id, spot_id, ref, date, time, hours, total, start_at, paid_via, pass_token, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, spotId, ref, fmtDay(start), windowLabel(startISO, hours), hours, total,
        startISO, paidVia, newPassToken(), paymentStatus);
  return findBooking(info.lastInsertRowid);
};

/** Lookup behind the QR code. Keyed on the pass token, never the ref. */
export const findBookingByPassToken = (token) =>
  hydrateBooking(db.prepare(`${BOOKING_SELECT} WHERE b.pass_token = ?`).get(token));

/**
 * Records that the owner saw the car in the space. Idempotent: a second
 * scan keeps the first timestamp rather than quietly moving arrival later.
 */
export const markBookingArrived = (id, byUserId) => {
  db.prepare(
    "UPDATE bookings SET arrived_at = datetime('now'), arrived_by = ? WHERE id = ? AND arrived_at IS NULL"
  ).run(byUserId, id);
  return findBooking(id);
};

export const setBookingStatus = (id, status) => {
  db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, id);
  return findBooking(id);
};

export const extendBooking = (id, extraHours) => {
  const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
  if (!b) return null;
  const spot = findSpot(b.spot_id);
  const hours = b.hours + extraHours;
  const total = Math.round(spot.price * hours * 1.1);

  // Push out the end of the window too. Seeded rows predate start_at, so
  // their existing label is left alone rather than invented.
  const time = b.start_at ? windowLabel(b.start_at, hours) : b.time;

  db.prepare("UPDATE bookings SET hours = ?, total = ?, time = ? WHERE id = ?")
    .run(hours, total, time, id);
  return findBooking(id);
};

export const countBookings = () =>
  db.prepare("SELECT COUNT(*) AS n FROM bookings").get().n;

// Owner earnings: only active/completed bookings count toward revenue.
export const ownerEarnings = (ownerId) =>
  db.prepare(
    `SELECT COALESCE(SUM(b.total), 0) AS revenue, COUNT(*) AS bookings
     FROM bookings b
     WHERE b.status != 'cancelled'
       AND b.spot_id IN (SELECT id FROM spots WHERE created_by = ?)`
  ).get(ownerId);

// ─── FAVOURITES ─────────────────────────────────────────
export const listFavourites = (userId) =>
  db.prepare(
    `SELECT spot_id FROM favourites WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId).map((r) => r.spot_id);

export const addFavourite = (userId, spotId) =>
  db.prepare("INSERT OR IGNORE INTO favourites (user_id, spot_id) VALUES (?, ?)")
    .run(userId, spotId).changes;

export const removeFavourite = (userId, spotId) =>
  db.prepare("DELETE FROM favourites WHERE user_id = ? AND spot_id = ?")
    .run(userId, spotId).changes;

// ─── VEHICLES ───────────────────────────────────────────
export const listVehicles = (userId) =>
  db.prepare("SELECT * FROM vehicles WHERE user_id = ? ORDER BY id").all(userId);

export const addVehicle = (userId, { label, plate, type }) => {
  const info = db.prepare(
    "INSERT INTO vehicles (user_id, label, plate, type) VALUES (?, ?, ?, ?)"
  ).run(userId, label, plate, type);
  return db.prepare("SELECT * FROM vehicles WHERE id = ?").get(info.lastInsertRowid);
};

export const deleteVehicle = (userId, id) =>
  db.prepare("DELETE FROM vehicles WHERE id = ? AND user_id = ?").run(id, userId).changes;

// ─── SPOT PHOTOS ────────────────────────────────────────
export const listSpotPhotos = (userId) =>
  db.prepare("SELECT * FROM spot_photos WHERE user_id = ? ORDER BY id DESC").all(userId);

export const addSpotPhoto = (userId, path, label = "") => {
  const info = db.prepare(
    "INSERT INTO spot_photos (user_id, path, label) VALUES (?, ?, ?)"
  ).run(userId, path, label);
  return db.prepare("SELECT * FROM spot_photos WHERE id = ?").get(info.lastInsertRowid);
};

export const findSpotPhoto = (userId, path) =>
  db.prepare("SELECT * FROM spot_photos WHERE user_id = ? AND path = ?").get(userId, path);

export const deleteSpotPhoto = (userId, id) => {
  const row = db.prepare("SELECT * FROM spot_photos WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) return null;
  db.prepare("DELETE FROM spot_photos WHERE id = ?").run(id);
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
  db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE provider = ? AND provider_id = ?`)
    .get(provider, providerId);

/**
 * Resolve an identity-provider profile to a local user.
 *
 * Matching is by provider subject first, then by verified email so an
 * existing password account can be linked rather than duplicated. An
 * unverified provider email is never used to claim an account — that
 * would let anyone who can set an email address at the provider take
 * over a local login.
 */
export const upsertOAuthUser = ({ provider, providerId, email, name, avatar, emailVerified }) => {
  const existing = findByProvider(provider, providerId);
  if (existing) {
    db.prepare("UPDATE users SET name = ?, avatar = ? WHERE id = ?")
      .run(name || existing.name, avatar ?? existing.avatar, existing.id);
    return { user: findUser(existing.id), created: false, linked: false };
  }

  // Provider sign-in lands on the DRIVER account for the address: that is
  // the role an account created here gets. An owner account on the same
  // email is a different account, and is left alone rather than claimed.
  const onAddress = email ? findAccountsByEmail(email) : [];

  // An unverified address must not touch ANY account on it, in any role:
  // anyone can set an unverified email at the provider, and creating a
  // driver account there would squat an address that belongs to someone else.
  if (onAddress.length > 0 && !emailVerified) {
    return { conflict: "unverified-email" };
  }

  const clash = email ? findAccount(email, "driver") : null;

  if (clash) {
    db.prepare("UPDATE users SET provider = ?, provider_id = ?, avatar = ? WHERE id = ?")
      .run(provider, providerId, avatar ?? "", clash.id);
    return { user: findUser(clash.id), created: false, linked: true };
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

  const info = db.prepare(
    `INSERT INTO users (name, email, pass_hash, role, provider, provider_id, avatar)
     VALUES (?, ?, ?, 'driver', ?, ?, ?)`
  ).run(storedName, storedEmail, OAUTH_ONLY, provider, providerId, avatar ?? "");

  return {
    user: findUser(info.lastInsertRowid),
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
  db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE AND role = ?")
    .get(email, role);

/** Every account registered on an address — at most one per role. */
export const findAccountsByEmail = (email) =>
  db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE email = ? COLLATE NOCASE ORDER BY role`)
    .all(email)
    .map(withRoles);

export const findUser = (id) =>
  withRoles(db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id));

// Includes pass_hash, for the auth layer only. Callers must strip it
// before anything reaches a response body.
export const findUserWithHash = (id) =>
  db.prepare("SELECT * FROM users WHERE id = ?").get(id);

export const updateUserProfile = (id, { name, email, phone, upiId }) => {
  db.prepare("UPDATE users SET name = ?, email = ?, phone = ?, upi_id = ? WHERE id = ?")
    .run(name, email, phone, upiId ?? "", id);
  // Spot rows carry a denormalised owner display name; keep it in step so
  // an owner renaming themselves doesn't orphan their listings.
  db.prepare("UPDATE spots SET owner = ? WHERE created_by = ?").run(name, id);
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
export const setUserRole = (id, role) => {
  const target = db.prepare("SELECT email FROM users WHERE id = ?").get(id);
  if (!target) return null;
  const taken = findAccount(target.email, role);
  if (taken && taken.id !== id) return null;
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  return findUser(id);
};

export const deleteUser = (id) =>
  db.prepare("DELETE FROM users WHERE id = ?").run(id).changes;

export const countAdmins = () =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;

export const changePassword = (id, password) => {
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hashPassword(password), id);
  return findUser(id);
};

export const listUsers = () =>
  db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY id`).all().map(withRoles);

export const countUsers = () =>
  db.prepare("SELECT role, COUNT(*) AS n FROM users GROUP BY role").all();

export const createUser = ({ name, email, password, role }) => {
  const info = db
    .prepare("INSERT INTO users (name, email, pass_hash, role) VALUES (?, ?, ?, ?)")
    .run(name, email, hashPassword(password), role);
  return findUser(info.lastInsertRowid);
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
export const authenticate = (email, password, role) => {
  const row = findAccount(email, role);
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
export const authenticateAny = (email, password) =>
  db
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE ORDER BY role")
    .all(email)
    .filter((row) => verifyPassword(password, row.pass_hash))
    .map(stripHash);

/** Re-check the signed-in account's own password, by id. */
export const authenticateById = (id, password) => {
  const row = findUserWithHash(id);
  if (!row || !verifyPassword(password, row.pass_hash)) return null;
  return stripHash(row);
};

export { SEED_USERS };
export default db;

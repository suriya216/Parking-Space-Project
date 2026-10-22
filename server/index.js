import express from "express";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as apple from "./apple.js";
import * as db from "./db.js";
import * as oauth from "./oauth.js";
import * as payments from "./payments.js";
import * as session from "./session.js";

const app = express();
const PORT = process.env.PORT ?? 3001;
const IS_PROD = process.env.NODE_ENV === "production";

// Demo conveniences (published test passwords, one-tap fake SSO) are
// useful locally and a giveaway of the whole app in public. Off by
// default in production; DEMO_MODE=true re-enables them deliberately.
const DEMO_MODE = (process.env.DEMO_MODE ?? String(!IS_PROD)) === "true";

// Behind Fly's proxy (and most others) the app sees an internal
// connection. This makes req.protocol/req.ip reflect the real client,
// which matters for building absolute URLs and for rate limiting.
app.set("trust proxy", true);
// Don't advertise the framework.
app.disable("x-powered-by");

const requireDemoMode = (_req, res, next) => {
  if (!DEMO_MODE) {
    return res.status(404).json({ error: "Not available." });
  }
  next();
};

// 8mb: photos arrive as base64 data URLs, which inflate the raw bytes by
// about a third, and express.json defaults to a 100kb limit.
app.use(express.json({ limit: "8mb" }));

// Apple's sign-in callback is an HTML form POST, not a redirect — asking
// for `name email` scope obliges `response_mode=form_post`. Nothing else
// in the API is form-encoded, so this is scoped to that one path.
app.use("/api/auth/apple/callback", express.urlencoded({ extended: false }));

// ─── SECURITY HEADERS ───────────────────────────────────
// Written by hand rather than pulling in helmet: it's a handful of
// headers and the CSP has to be specific about the map tiles and
// geocoder this app talks to.
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Geolocation is the app's core feature; nothing else is needed.
    "Permissions-Policy": "geolocation=(self), camera=(self), microphone=(), payment=()",
  });
  if (IS_PROD) {
    res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    res.set("Content-Security-Policy", [
      "default-src 'self'",
      // React inlines styles, and Leaflet builds marker markup as HTML.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // OSM raster tiles, and QR codes rendered to data: URLs.
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
      // The geocoder, called directly when the server proxy can't reach it.
      "connect-src 'self' https://nominatim.openstreetmap.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "));
  }
  next();
});

// ─── RATE LIMITING ──────────────────────────────────────
// Only FAILED credential attempts are counted. Counting every request
// would lock out an office or campus sharing one NAT address, where many
// people legitimately sign in from the same IP; password guessing, by
// definition, produces failures.
//
// A fixed window per IP is crude but enough to make online guessing
// impractical. A deployment behind a CDN should also limit at the edge,
// and this state is per-process so it resets on redeploy.
const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX_FAILURES = Number(process.env.AUTH_RATE_LIMIT ?? 20);
const failures = new Map();

const clientKey = (req) => req.ip ?? "unknown";

const rateLimitAuth = (req, res, next) => {
  const now = Date.now();
  const entry = failures.get(clientKey(req));

  if (entry && now - entry.start <= RATE_WINDOW_MS && entry.count >= RATE_MAX_FAILURES) {
    const retryAfter = Math.ceil((entry.start + RATE_WINDOW_MS - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too many failed attempts. Please wait and try again." });
  }
  next();
};

const noteAuthFailure = (req) => {
  const now = Date.now();
  const key = clientKey(req);
  const entry = failures.get(key);

  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    failures.set(key, { start: now, count: 1 });
  } else {
    entry.count += 1;
  }

  // Opportunistic sweep so the map can't grow without bound.
  if (failures.size > 5000) {
    for (const [k, v] of failures) if (now - v.start > RATE_WINDOW_MS) failures.delete(k);
  }
};

// A successful sign-in clears the counter for that address.
const clearAuthFailures = (req) => failures.delete(clientKey(req));

// ─── CACHING ────────────────────────────────────────────
// Express adds an ETag to JSON responses, so a repeat GET whose body is
// byte-identical comes back as 304 Not Modified with an empty body and the
// browser reuses its cached copy. That is technically correct and the data
// is never stale — the ETag changes as soon as the DB does — but for a
// per-user, mutable API it makes traffic hard to read and leaves a
// conditional-request cache in the path for no benefit. Turning it off
// means every API call answers 200 with a real body.
app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const added = db.seed();
console.log(`[db] ${db.DB_PATH}`);
console.log(`[db] seeded ${added.users} user(s), ${added.spots} spot(s), ${added.bookings} booking(s)`);
console.log(`[db] totals: ${db.listUsers().length} users, ${db.countSpots()} spots, ${db.countBookings()} bookings`);

const oauthReady = oauth.configuredProviders();
if (oauthReady.length) {
  console.log(`[oauth] enabled: ${oauthReady.map((p) => p.id).join(", ")}`);
  for (const p of oauthReady) {
    console.log(`[oauth]   ${p.id} redirect URI: ${oauth.redirectUriFor(oauth.PROVIDERS[p.id])}`);
  }
} else {
  console.log("[oauth] no providers configured — sign-in screen will offer the demo account.");
  console.log("[oauth] see .env.example to enable Google or GitHub sign-in.");
}

// ─── AUTH PLUMBING ──────────────────────────────────────
// Tokens are HMAC-signed and expiring (see ./session.js). The payload
// cannot be forged without SESSION_SECRET, and the user is always
// re-read from the database by id so a deleted or demoted account loses
// access immediately rather than at token expiry.
const tokenFor = (user) => session.issue(user);

const userFromToken = (token) => {
  const payload = session.verify(token);
  if (!payload) return null;

  const row = db.findUserWithHash(payload.uid);
  if (!row) return null;

  const { pass_hash: _omit, ...safe } = row;
  return safe;
};

const currentUser = (req) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  return token ? userFromToken(token) : null;
};

const requireUser = (req, res, next) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  req.user = user;
  next();
};

const requireRole = (...roles) => (req, res, next) =>
  requireUser(req, res, () => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}.` });
    }
    next();
  });

const requireAdmin = requireRole("admin");

// Wraps a handler so a thrown error becomes a 500 JSON body instead of
// Express's default HTML error page.
const handler = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (e) {
    console.error("[api]", e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
};

const asId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ─── AUTH ───────────────────────────────────────────────
const publicUser = ({ id, name, email, phone, role, roles, provider, avatar, upi_id, created_at }) =>
  ({
    id, name, email, phone: phone ?? "", role,
    // An account holds exactly one role, so this is always that one role.
    // Kept as a list because the client and the Session type read a list.
    roles: roles ?? [role],
    provider: provider ?? "local", avatar: avatar ?? "", upi_id: upi_id ?? "", created_at,
  });

app.post("/api/login", rateLimitAuth, handler((req, res) => {
  const { email, password, role } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (role != null && !["driver", "owner", "admin"].includes(role)) {
    return res.status(400).json({ error: "Role must be driver, owner or admin." });
  }

  // An address may carry one account per role. The password normally picks
  // out which of them is being signed in to, so the form does not have to
  // ask for a role up front — `role` arrives only on the second attempt,
  // after an ambiguous first one.
  const matches = role
    ? [db.authenticate(email, password, role)].filter(Boolean)
    : db.authenticateAny(email, password);

  // Deliberately vague: saying "no such account" would let anyone
  // enumerate which emails are registered.
  if (matches.length === 0) {
    noteAuthFailure(req);
    return res.status(401).json({ error: "Invalid email or password." });
  }
  clearAuthFailures(req);

  // The same password opens more than one of this address's accounts. It
  // has already checked out, so naming the roles reveals nothing the
  // caller could not already discover — but which account to open is
  // theirs to say rather than ours to guess.
  //
  // A 200 with no token, not an error status: the request was answered,
  // and "here are your accounts, pick one" is a step in signing in rather
  // than a failure. The client re-posts with `role` set.
  if (matches.length > 1) {
    return res.json({ chooseRole: matches.map((u) => u.role) });
  }

  const [user] = matches;
  res.json({ user: publicUser(user), token: tokenFor(user) });
}));

app.post("/api/register", rateLimitAuth, handler((req, res) => {
  const { name, email, password, role } = req.body ?? {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (!["driver", "owner"].includes(role)) {
    // Admin accounts are seeded only — self-registering one would be a
    // privilege-escalation hole.
    return res.status(400).json({ error: "Role must be driver or owner." });
  }
  // An address already in use for the OTHER role is not a dead end: this
  // creates a second, independent account on the same email, so one person
  // can both park and rent out a space. It is a new account rather than a
  // role bolted onto an existing one, so it sets its own password and the
  // other account's password is neither required nor touched.
  //
  // The trade-off, accepted deliberately: because no existing password has
  // to be proved, anyone can occupy the unused role on someone else's
  // address. They gain no access to the other account or its data, but
  // they do take the slot.
  if (db.findAccount(email, role)) {
    return res.status(409).json({
      error: `That email already has a ${role} account. Sign in instead.`,
    });
  }
  const user = db.createUser({ name, email, password, role });
  res.status(201).json({ user: publicUser(user), token: tokenFor(user) });
}));

// Simulated password reset. There is no mail server wired up, so this
// deliberately does NOT send anything and does NOT change the password;
// it only confirms the address exists in a non-enumerable way.
app.post("/api/password-reset", rateLimitAuth, handler((req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "Email is required." });
  res.json({
    simulated: true,
    message: `If ${email} matches an account, a reset link would be sent there.`,
    note: "Demo only — no email is sent and no password is changed.",
  });
}));

// POST /api/demo-sso used to live here: a stand-in that signed in the
// seeded driver whenever the Google or Apple button was tapped. It made
// those buttons log anyone in without credentials, which is
// indistinguishable from a broken auth system. Both providers now run the
// real Authorization Code + PKCE flow below — Google via OIDC userinfo,
// Apple via a verified id_token (server/apple.js) — so there is nothing
// left to stand in for.

// ─── OAUTH (Authorization Code + PKCE) ──────────────────
// Which providers actually have credentials. The sign-in screen uses this
// to show real buttons instead of ones that would fail.
app.get("/api/auth/providers", handler((_req, res) => {
  res.json({
    providers: oauth.configuredProviders(),
    // Still reported because DEMO_MODE gates /api/demo-accounts, which the
    // production suite asserts is absent on a public deployment.
    demoMode: DEMO_MODE,
  });
}));

app.get("/api/auth/:provider/start", (req, res) => {
  const provider = oauth.PROVIDERS[req.params.provider];
  if (!provider) return res.status(404).json({ error: "Unknown provider." });
  if (!oauth.isConfigured(provider)) {
    return res.status(503).json({
      error: `${provider.label} sign-in isn't configured.`,
      hint: `Set ${provider.id.toUpperCase()}_CLIENT_ID and ${provider.id.toUpperCase()}_CLIENT_SECRET, and register ${oauth.redirectUriFor(provider)} as an authorized redirect URI.`,
    });
  }
  res.redirect(oauth.authorizeUrl(provider));
});

// Errors here are shown to a human in the browser, so they redirect back
// to the app with a message rather than returning bare JSON.
const oauthFail = (res, message) =>
  res.redirect(`${oauth.APP_PUBLIC_URL}/?oauth_error=${encodeURIComponent(message)}`);

/**
 * The provider callback.
 *
 * Registered for both GET and POST: Google and GitHub redirect back with
 * query params, Apple posts a form (see the urlencoded middleware above).
 * Reading from a merged bag keeps one code path for all three.
 */
const handleOAuthCallback = async (req, res) => {
  const provider = oauth.PROVIDERS[req.params.provider];
  if (!provider) return oauthFail(res, "Unknown sign-in provider.");

  const params = { ...req.query, ...(req.body ?? {}) };

  // The user declining at the provider arrives here as an error param.
  if (params.error) {
    return oauthFail(res, String(params.error_description ?? params.error));
  }

  const { code, state } = params;
  if (!code || !state) return oauthFail(res, "Sign-in response was incomplete.");

  // Single-use state: defeats CSRF and blocks callback replay.
  const entry = oauth.consumeState(String(state));
  if (!entry || entry.providerId !== provider.id) {
    return oauthFail(res, "Sign-in request expired or was not recognised. Please try again.");
  }

  try {
    const tokens = await oauth.exchangeCode(provider, String(code), entry.verifier);

    let profile;
    if (provider.profileFromIdToken) {
      // Apple: no userinfo endpoint. Verify the id_token's signature
      // against Apple's JWKS and read the claims from it. The display
      // name only ever arrives on first authorization, in `user`.
      const claims = await apple.verifyAppleIdToken(tokens.id_token);
      profile = apple.appleProfile(claims, params.user);
    } else {
      profile = await oauth.fetchProfile(provider, tokens.access_token);
    }

    // GitHub hides a private primary email from /user.
    if (provider.id === "github" && !profile.email) {
      const extra = await oauth.fetchGithubEmail(tokens.access_token);
      if (extra) Object.assign(profile, extra);
    }

    const result = db.upsertOAuthUser({
      provider: provider.id,
      providerId: profile.providerId,
      email: profile.email,
      name: profile.name,
      avatar: profile.avatar,
      emailVerified: profile.emailVerified,
    });

    if (result.conflict === "unverified-email") {
      return oauthFail(res,
        `An account already uses ${profile.email}, but ${provider.label} hasn't verified that ` +
        `address for you. Sign in with your password instead, or verify the email with ` +
        `${provider.label} and try again.`);
    }

    const { user, created, linked } = result;

    // Hand the session over via a short-lived opaque code so the token
    // never appears in the URL, history or Referer header.
    const handoff = oauth.createHandoff({
      user: publicUser(user),
      token: tokenFor(user),
      provider: provider.id,
      created,
      linked,
    });
    res.redirect(`${oauth.APP_PUBLIC_URL}/?oauth=${handoff}`);
  } catch (e) {
    console.error("[oauth]", e);
    oauthFail(res, e.message);
  }
};

app.get("/api/auth/:provider/callback", handleOAuthCallback);
// Apple only: response_mode=form_post. Harmless for the others.
app.post("/api/auth/:provider/callback", handleOAuthCallback);

app.post("/api/auth/exchange", handler((req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "Missing handoff code." });
  const session = oauth.consumeHandoff(String(code));
  if (!session) {
    return res.status(410).json({ error: "That sign-in link has already been used or expired." });
  }
  res.json(session);
}));

// ─── ME ─────────────────────────────────────────────────
app.get("/api/me", requireUser, handler((req, res) => {
  res.json({ user: publicUser(req.user) });
}));

app.patch("/api/me", requireUser, handler((req, res) => {
  const { name, email, phone, upiId } = req.body ?? {};
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  // UPI id is optional, but if given it must be well-formed — a payout to a
  // malformed VPA would silently fail later.
  const upi = String(upiId ?? "").trim();
  if (upi && !UPI_ID.test(upi)) {
    return res.status(400).json({ error: "That doesn't look like a UPI id. Use the name@bank form." });
  }
  // Only a clash in the SAME role blocks the change: another role's
  // account on that address is a separate account and may coexist.
  const clash = db.findAccount(email, req.user.role);
  if (clash && clash.id !== req.user.id) {
    return res.status(409).json({ error: "That email is already in use." });
  }
  const user = db.updateUserProfile(req.user.id, { name, email, phone: phone ?? "", upiId: upi });
  // The token embeds the email, so changing it invalidates the old one.
  res.json({ user: publicUser(user), token: tokenFor(user) });
}));

app.post("/api/me/password", requireUser, handler((req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Both current and new password are required." });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }
  // An account created through an identity provider has no local password
  // to change, and must not be able to set one this way.
  if (req.user.provider && req.user.provider !== "local") {
    return res.status(409).json({
      error: `This account signs in with ${req.user.provider}, so it has no password to change.`,
    });
  }
  // By id, not by email: an address can carry more than one account and
  // only this one's password is being changed.
  if (!db.authenticateById(req.user.id, currentPassword)) {
    noteAuthFailure(req);
    return res.status(403).json({ error: "Current password is incorrect." });
  }
  db.changePassword(req.user.id, newPassword);
  res.json({ ok: true, message: "Password updated." });
}));

// ─── SPOTS ──────────────────────────────────────────────
// GET /api/spots?lat=&lng=&radius=
// With lat/lng the results carry a real haversine distance and are sorted
// nearest-first; without, distance is null and order is by id.
app.get("/api/spots", handler((req, res) => {
  const num = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const radius = num(req.query.radius);

  if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius)) {
    return res.status(400).json({ error: "lat, lng and radius must be numbers." });
  }
  if ((lat == null) !== (lng == null)) {
    return res.status(400).json({ error: "lat and lng must be provided together." });
  }
  if (lat != null && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
    return res.status(400).json({ error: "lat or lng is out of range." });
  }

  res.json({
    spots: db.listSpots({ lat, lng, radius }),
    center: lat != null ? { lat, lng } : db.DEFAULT_CENTER,
    usedFallbackCenter: lat == null,
  });
}));

const SPOT_TYPES = ["Covered", "Open"];
const SPOT_PHOTOS = [
  "/spots/covered-garage.svg",
  "/spots/open-driveway.svg",
  "/spots/basement-lot.svg",
  "/spots/gated-compound.svg",
];

app.post("/api/spots", requireRole("owner", "admin"), handler((req, res) => {
  const { name, address, type, vehicle, price, lat, lng, photo, available } = req.body ?? {};

  if (!name || !address || !vehicle || !available) {
    return res.status(400).json({ error: "Name, address, vehicle and availability are required." });
  }
  if (!SPOT_TYPES.includes(type)) {
    return res.status(400).json({ error: `Type must be one of: ${SPOT_TYPES.join(", ")}.` });
  }
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) {
    return res.status(400).json({ error: "Price must be a positive number." });
  }
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return res.status(400).json({ error: "Valid lat and lng are required." });
  }
  // Either one of the bundled illustrations, or a photo this owner has
  // uploaded. Checking ownership stops one owner referencing another's
  // upload by guessing a path.
  if (photo && !SPOT_PHOTOS.includes(photo) && !db.findSpotPhoto(req.user.id, photo)) {
    return res.status(400).json({ error: "Unknown photo." });
  }

  try {
    const spot = db.createSpot({
      name, address, type, vehicle, price: p, lat: la, lng: ln,
      photo: photo || SPOT_PHOTOS[0],
      owner: req.user.name,
      available,
      createdBy: req.user.id,
    });
    res.status(201).json({ spot });
  } catch (e) {
    // (name, address) is unique. Report the clash as a conflict with a
    // usable message instead of letting it surface as a 500.
    if (e?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed: spots/.test(e.message)) {
      return res.status(409).json({
        error: "A listing with that name already exists at that address.",
      });
    }
    throw e;
  }
}));

app.patch("/api/spots/:id", requireAdmin, handler((req, res) => {
  const id = asId(req.params.id);
  if (!id || !db.findSpot(id)) return res.status(404).json({ error: "Spot not found." });
  const { verified } = req.body ?? {};
  if (typeof verified !== "boolean") {
    return res.status(400).json({ error: "`verified` must be true or false." });
  }
  res.json({ spot: db.setSpotVerified(id, verified) });
}));

// Admins can delete any spot; owners only their own.
app.delete("/api/spots/:id", requireRole("owner", "admin"), handler((req, res) => {
  const id = asId(req.params.id);
  const spot = id && db.findSpot(id);
  if (!spot) return res.status(404).json({ error: "Spot not found." });
  if (req.user.role !== "admin" && spot.created_by !== req.user.id) {
    return res.status(403).json({ error: "You can only delete your own listings." });
  }
  db.deleteSpot(id);
  res.json({ ok: true, deleted: id });
}));

// ─── BOOKING PAYMENT ────────────────────────────────────
// Online payments run through the gateway (see payments.js): the client
// completes payment, then hands back the gateway's signed receipt, which is
// verified server-side before a booking is confirmed. Cash is recorded
// pending. Nothing reusable — no card number, no UPI credential — is ever
// stored; only a short display label survives on the booking row.

// A UPI id, e.g. "asha@okhdfc". Deliberately loose on the handle and
// strict on the shape: the list of PSP suffixes changes constantly, so
// validating against one would reject valid ids a month from now.
const UPI_ID = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{1,48}[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]{1,29}$/;

/**
 * Validates the payment half of a booking request.
 *
 * Online payments (card/UPI/netbanking) go through the gateway: the client
 * sends back the order id, the gateway's payment id and its signature, and
 * this verifies that signature. A verified signature is proof the money
 * moved — it cannot be forged without the gateway secret — so only then is
 * the booking marked confirmed. Cash is recorded pending for the owner to
 * confirm on receipt.
 *
 * @param {object} payment The client's payment object.
 * @param {number} expectedPaise Server-computed amount, to reject tampering.
 * @returns {{ label: string, status: string } | { error: string }}
 */
const takePayment = (payment, expectedPaise) => {
  const { mode } = payment ?? {};

  if (mode === "cash") {
    return { label: "Cash", status: "pending" };
  }

  if (mode === "online") {
    const { orderId, paymentId, signature, method, amount } = payment ?? {};
    if (!payments.verifyPayment({ orderId, paymentId, signature })) {
      return { error: "Payment could not be verified. You have not been charged." };
    }
    // The amount echoed back must match what the server billed, so a
    // verified small-amount order can't be replayed against a big booking.
    if (Number(amount) !== expectedPaise) {
      return { error: "Payment amount did not match the booking." };
    }
    const label = method === "upi" ? "UPI" : method === "card" ? "Card" : "Online";
    return { label: `${label} · ${paymentId}`, status: "confirmed" };
  }

  return { error: "Choose how you'd like to pay." };
};

// ─── PAYMENTS ───────────────────────────────────────────
// Step 1 of an online payment: the client asks the server to open an order
// for a specific booking. The amount is computed here from the spot's price
// and never trusted from the client, so the sum the gateway charges is the
// sum the server intends to bill.
app.post("/api/payments/order", requireUser, handler(async (req, res) => {
  const { spotId, hours } = req.body ?? {};
  const sid = asId(spotId);
  const h = Number(hours);
  if (!sid) return res.status(400).json({ error: "A valid spotId is required." });
  if (!Number.isInteger(h) || h < 1 || h > 24) {
    return res.status(400).json({ error: "Hours must be a whole number from 1 to 24." });
  }
  const spot = db.findSpot(sid);
  if (!spot) return res.status(404).json({ error: "Spot not found." });

  const amountPaise = Math.round(spot.price * h * 1.1) * 100;
  const order = await payments.createOrder(amountPaise, `spot${sid}-${Date.now()}`);
  // The owner's UPI id (if they set one) rides along so the client can show
  // "paying <owner>" and, in a real deployment, route the payout.
  const owner = spot.created_by ? db.findUser(spot.created_by) : null;
  res.json({ ...order, ownerUpi: owner?.upi_id || "" });
}));

// Step 2, DEMO ONLY: stands in for the user completing payment in their UPI
// app. Returns a valid payment id + signature the client then submits with
// the booking, exactly as Razorpay Checkout would in production. Refused
// when real gateway keys are configured.
app.post("/api/payments/demo-complete", requireUser, handler((req, res) => {
  if (payments.GATEWAY_LIVE) {
    return res.status(404).json({ error: "Not available." });
  }
  const { orderId } = req.body ?? {};
  if (!orderId) return res.status(400).json({ error: "orderId is required." });
  res.json(payments.demoComplete(String(orderId)));
}));

// ─── BOOKINGS ───────────────────────────────────────────
app.get("/api/bookings", requireUser, handler((req, res) => {
  res.json({ bookings: db.listBookingsForUser(req.user) });
}));

app.post("/api/bookings", requireUser, handler((req, res) => {
  const { spotId, hours, startAt, payment } = req.body ?? {};
  const sid = asId(spotId);
  const h = Number(hours);

  if (!sid) return res.status(400).json({ error: "A valid spotId is required." });
  if (!Number.isInteger(h) || h < 1 || h > 24) {
    return res.status(400).json({ error: "Hours must be a whole number from 1 to 24." });
  }
  if (!db.findSpot(sid)) return res.status(404).json({ error: "Spot not found." });

  // The date and time window are derived server-side from the start
  // instant, so a client can't submit a label that disagrees with the
  // hours actually booked.
  if (startAt != null && Number.isNaN(new Date(startAt).getTime())) {
    return res.status(400).json({ error: "startAt must be a valid date." });
  }

  // Payment is checked before the row is written, so a rejected card never
  // leaves a booking behind. The amount is recomputed here, never trusted
  // from the client, and the gateway signature is verified against it.
  const spot = db.findSpot(sid);
  const expectedPaise = Math.round(spot.price * h * 1.1) * 100;
  const paid = takePayment(payment, expectedPaise);
  if (paid.error) return res.status(400).json({ error: paid.error });

  const booking = db.createBooking({
    userId: req.user.id, spotId: sid, hours: h, startAt, paidVia: paid.label, paymentStatus: paid.status,
  });
  res.status(201).json({ booking });
}));

app.patch("/api/bookings/:id", requireUser, handler((req, res) => {
  const id = asId(req.params.id);
  const booking = id && db.findBooking(id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  // A driver may only touch their own booking; owners and admins may act
  // on bookings surfaced to them.
  const mine = booking.user_id === req.user.id;
  const privileged = req.user.role === "admin" ||
    (req.user.role === "owner" && booking.spot?.created_by === req.user.id);
  if (!mine && !privileged) {
    return res.status(403).json({ error: "Not your booking." });
  }

  const { status, extendHours } = req.body ?? {};

  if (extendHours != null) {
    const extra = Number(extendHours);
    if (!Number.isInteger(extra) || extra < 1 || extra > 12) {
      return res.status(400).json({ error: "extendHours must be a whole number from 1 to 12." });
    }
    if (booking.status !== "active") {
      return res.status(409).json({ error: `Cannot extend a ${booking.status} booking.` });
    }
    if (booking.hours + extra > 24) {
      return res.status(400).json({ error: "A booking cannot exceed 24 hours." });
    }
    return res.json({ booking: db.extendBooking(id, extra) });
  }

  if (status != null) {
    if (!["cancelled", "completed"].includes(status)) {
      return res.status(400).json({ error: "Status must be cancelled or completed." });
    }
    if (booking.status !== "active") {
      return res.status(409).json({ error: `Booking is already ${booking.status}.` });
    }
    return res.json({ booking: db.setBookingStatus(id, status) });
  }

  res.status(400).json({ error: "Provide either status or extendHours." });
}));

// ─── BOOKING PASS (what the QR code opens) ──────────────
// Deliberately reachable without a session: the point of the code is that
// whoever is standing at the space can scan it. Holding the token is the
// only credential, which is why it is 128 random bits and not the ref.
//
// Who the viewer is decides what comes back, and that is the whole
// feature. Two audiences, one URL:
//   - the spot's owner (or an admin), signed in: sees everything and can
//     confirm the car arrived and parked;
//   - anyone else, including the driver on a second phone or a passer-by:
//     sees the parking details only. No driver name, no payment label.
const passViewerRole = (user, booking) => {
  if (!user) return "public";
  if (user.role === "admin") return "admin";
  if (booking.spot?.created_by === user.id) return "owner";
  if (booking.user_id === user.id) return "driver";
  return "public";
};

const passBody = (booking, role) => {
  const { spot } = booking;
  // Only the fields describing the parking itself. `created_by`, the
  // driver's email and the pass token are never in here.
  const base = {
    ref: booking.ref,
    status: booking.status,
    date: booking.date,
    time: booking.time,
    hours: booking.hours,
    total: booking.total,
    arrivedAt: booking.arrived_at ?? null,
    spot: spot && {
      name: spot.name, address: spot.address, type: spot.type,
      vehicle: spot.vehicle, price: spot.price, photo: spot.photo,
      owner: spot.owner, lat: spot.lat, lng: spot.lng, verified: spot.verified,
    },
    viewer: role,
    // Only the owner of this spot can vouch for a car being in it.
    canConfirmArrival:
      (role === "owner" || role === "admin") && booking.status === "active",
  };

  if (role === "public") return base;
  return {
    ...base,
    driver: { name: booking.user?.name ?? "" },
    paidVia: booking.paid_via || null,
  };
};

// A token is a fixed-length hex string; anything else is not worth a
// database round trip.
const asPassToken = (v) => (/^[a-f0-9]{32}$/i.test(String(v ?? "")) ? String(v) : null);

app.get("/api/pass/:token", handler((req, res) => {
  const token = asPassToken(req.params.token);
  const booking = token && db.findBookingByPassToken(token);
  // Same 404 for a malformed token and an unknown one, so the shape of a
  // valid token can't be probed for.
  if (!booking) return res.status(404).json({ error: "That parking pass isn't valid." });

  res.json({ pass: passBody(booking, passViewerRole(currentUser(req), booking)) });
}));

app.post("/api/pass/:token/arrival", requireUser, handler((req, res) => {
  const token = asPassToken(req.params.token);
  const booking = token && db.findBookingByPassToken(token);
  if (!booking) return res.status(404).json({ error: "That parking pass isn't valid." });

  const role = passViewerRole(req.user, booking);
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({
      error: "Only the owner of this parking spot can confirm an arrival.",
    });
  }
  if (booking.status !== "active") {
    return res.status(409).json({ error: `This booking is ${booking.status}.` });
  }

  const updated = db.markBookingArrived(booking.id, req.user.id);
  res.json({ pass: passBody(updated, passViewerRole(req.user, updated)) });
}));

// ─── FAVOURITES ─────────────────────────────────────────
app.get("/api/favourites", requireUser, handler((req, res) => {
  res.json({ favourites: db.listFavourites(req.user.id) });
}));

app.put("/api/favourites/:spotId", requireUser, handler((req, res) => {
  const id = asId(req.params.spotId);
  if (!id || !db.findSpot(id)) return res.status(404).json({ error: "Spot not found." });
  db.addFavourite(req.user.id, id);
  res.json({ favourites: db.listFavourites(req.user.id) });
}));

app.delete("/api/favourites/:spotId", requireUser, handler((req, res) => {
  const id = asId(req.params.spotId);
  if (!id) return res.status(400).json({ error: "Invalid spot id." });
  db.removeFavourite(req.user.id, id);
  res.json({ favourites: db.listFavourites(req.user.id) });
}));

// ─── VEHICLES ───────────────────────────────────────────
const VEHICLE_TYPES = ["Bike", "Sedan", "SUV", "Hatchback"];

app.get("/api/vehicles", requireUser, handler((req, res) => {
  res.json({ vehicles: db.listVehicles(req.user.id) });
}));

app.post("/api/vehicles", requireUser, handler((req, res) => {
  const { label, plate, type } = req.body ?? {};
  if (!label || !plate) {
    return res.status(400).json({ error: "Model and plate number are required." });
  }
  if (!VEHICLE_TYPES.includes(type)) {
    return res.status(400).json({ error: `Type must be one of: ${VEHICLE_TYPES.join(", ")}.` });
  }
  res.status(201).json({ vehicle: db.addVehicle(req.user.id, { label, plate, type }) });
}));

app.delete("/api/vehicles/:id", requireUser, handler((req, res) => {
  const id = asId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid vehicle id." });
  if (!db.deleteVehicle(req.user.id, id)) {
    return res.status(404).json({ error: "Vehicle not found." });
  }
  res.json({ ok: true, deleted: id });
}));

// ─── OWNER ──────────────────────────────────────────────
app.get("/api/owner/earnings", requireRole("owner", "admin"), handler((req, res) => {
  const e = db.ownerEarnings(req.user.id);
  res.json({ revenue: e.revenue, bookings: e.bookings });
}));

// ─── SPOT PHOTO UPLOADS ─────────────────────────────────
// Owners photograph the bay (or reuse an earlier shot). Uploads arrive as
// base64 data URLs, which avoids a multipart dependency for what is a
// single small image, and are written under server/uploads/.
// Alongside the database on the mounted volume, so uploads survive a
// redeploy too.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(db.DATA_DIR, "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

// Served read-only. The filenames are random, so one owner cannot guess
// another's, but this is not a substitute for real per-file authorisation.
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "1h", index: false }));

// Magic-byte signatures: the declared MIME type comes from the client and
// cannot be trusted, so the actual bytes decide what this file is.
const IMAGE_SIGNATURES = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", mime: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: "webp", mime: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

app.get("/api/spot-photos", requireRole("owner", "admin"), handler((req, res) => {
  res.json({ photos: db.listSpotPhotos(req.user.id), stock: SPOT_PHOTOS });
}));

app.post("/api/spot-photos", requireRole("owner", "admin"), handler((req, res) => {
  const { dataUrl, label } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return res.status(400).json({ error: "Expected an image as a data URL." });
  }

  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(5, comma);
  if (!meta.includes("base64")) {
    return res.status(400).json({ error: "Image must be base64 encoded." });
  }

  let bytes;
  try {
    bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  } catch {
    return res.status(400).json({ error: "Image data is not valid base64." });
  }

  if (bytes.length === 0) return res.status(400).json({ error: "Image is empty." });
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: `Image is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` });
  }

  const kind = IMAGE_SIGNATURES.find((s) => s.test(bytes));
  if (!kind) {
    return res.status(415).json({ error: "Only JPEG, PNG or WebP images are accepted." });
  }

  const name = `spot-${req.user.id}-${randomUUID()}.${kind.ext}`;
  writeFileSync(join(UPLOAD_DIR, name), bytes);
  const path = `/uploads/${name}`;

  res.status(201).json({
    photo: db.addSpotPhoto(req.user.id, path, String(label ?? "").slice(0, 60)),
    bytes: bytes.length,
    type: kind.mime,
  });
}));

app.delete("/api/spot-photos/:id", requireRole("owner", "admin"), handler((req, res) => {
  const id = asId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid photo id." });
  const row = db.deleteSpotPhoto(req.user.id, id);
  if (!row) return res.status(404).json({ error: "Photo not found." });

  // Only unlink once no listing still points at it.
  const stillUsed = db.listSpots().some((s) => s.photo === row.path);
  if (!stillUsed) {
    try { unlinkSync(join(UPLOAD_DIR, row.path.replace("/uploads/", ""))); } catch { /* already gone */ }
  }
  res.json({ ok: true, deleted: id, fileRemoved: !stillUsed });
}));

// ─── PLACE SEARCH (geocoding) ───────────────────────────
// Proxied through the server rather than called from the browser: keeps
// the required User-Agent under our control, avoids CORS, and lets us
// cache so typing doesn't hammer a free public service.
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const geoCache = new Map(); // query -> { at, places }
const GEO_TTL_MS = 10 * 60_000;

app.get("/api/places", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 3) return res.json({ places: [] });

  const key = q.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) {
    return res.json({ places: hit.places, cached: true });
  }

  const url = `${NOMINATIM}?${new URLSearchParams({
    q, format: "jsonv2", limit: "6", addressdetails: "1", countrycodes: "in",
  })}`;

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "ParkSpace/0.0 (demo app)", "Accept-Language": "en" },
      signal: AbortSignal.timeout(6000),
    });
    if (!upstream.ok) throw new Error(`geocoder returned ${upstream.status}`);

    const raw = await upstream.json();
    const places = raw.map((r) => ({
      id: String(r.place_id),
      name: r.name || r.display_name.split(",")[0],
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }));

    geoCache.set(key, { at: Date.now(), places });
    res.json({ places });
  } catch (e) {
    // A geocoder outage must not break search: the client falls back to
    // calling the geocoder directly and still filters spots locally.
    // Behind a TLS-inspecting proxy this fails with
    // UNABLE_TO_GET_ISSUER_CERT_LOCALLY; point NODE_EXTRA_CA_CERTS at the
    // corporate root CA to use this path instead of the fallback.
    const cause = e.cause?.code ?? e.message;
    console.warn(`[api] place search failed: ${cause}`);
    res.status(503).json({ error: `Place search unavailable: ${cause}`, places: [] });
  }
});

// ─── ADMIN ──────────────────────────────────────────────
app.get("/api/users", requireAdmin, handler((_req, res) => {
  res.json({ users: db.listUsers() });
}));

app.patch("/api/users/:id", requireAdmin, handler((req, res) => {
  const id = asId(req.params.id);
  const target = id && db.findUser(id);
  if (!target) return res.status(404).json({ error: "User not found." });

  const { role } = req.body ?? {};
  if (!["driver", "owner", "admin"].includes(role)) {
    return res.status(400).json({ error: "Role must be driver, owner or admin." });
  }
  // Self-lockout guards: an admin must not be able to strip their own
  // access, nor remove the last remaining admin.
  if (target.id === req.user.id && role !== "admin") {
    return res.status(409).json({ error: "You cannot change your own role." });
  }
  if (target.role === "admin" && role !== "admin" && db.countAdmins() <= 1) {
    return res.status(409).json({ error: "Cannot demote the last admin." });
  }
  const user = db.setUserRole(id, role);
  // Null means this address already holds an account in the target role.
  // Merging the two is not something a role dropdown should decide.
  if (!user) {
    return res.status(409).json({
      error: `${target.email} already has a ${role} account. Delete one of them first.`,
    });
  }
  res.json({ user });
}));

app.delete("/api/users/:id", requireAdmin, handler((req, res) => {
  const id = asId(req.params.id);
  const target = id && db.findUser(id);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.id === req.user.id) {
    return res.status(409).json({ error: "You cannot delete your own account." });
  }
  if (target.role === "admin" && db.countAdmins() <= 1) {
    return res.status(409).json({ error: "Cannot delete the last admin." });
  }
  db.deleteUser(id);
  res.json({ ok: true, deleted: id });
}));

app.get("/api/stats", requireAdmin, handler((_req, res) => {
  const byRole = Object.fromEntries(db.countUsers().map((r) => [r.role, r.n]));
  res.json({
    total: db.listUsers().length,
    drivers: byRole.driver ?? 0,
    owners: byRole.owner ?? 0,
    admins: byRole.admin ?? 0,
    spots: db.countSpots(),
    bookings: db.countBookings(),
  });
}));

// ─── MISC ───────────────────────────────────────────────
app.get("/api/health", handler((_req, res) => res.json({ ok: true, db: db.DB_PATH })));

// Test credentials for the seeded throwaway accounts.
//
// The sign-in screen no longer calls this — it used to render these
// emails and passwords into the page, which has been removed; the
// Playwright suite owns the credentials now (tests/fixtures). The
// endpoint is kept so the production suite can keep asserting that it
// stays 404 on a public deployment.
//
// Serving passwords over HTTP is only tolerable for fixed throwaway
// accounts on a local machine, so this is hard-disabled unless DEMO_MODE
// is on — which defaults to off in production.
app.get("/api/demo-accounts", requireDemoMode, handler((_req, res) => {
  res.json({
    accounts: db.SEED_USERS.map(({ email, password, role }) => ({ email, password, role })),
  });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown endpoint." }));

// ─── STATIC SITE ────────────────────────────────────────
// In production the API also serves the built React app, so the whole
// thing is one origin: no CORS, and cookies/headers behave predictably.
// In development Vite serves the app and proxies /api here instead.
const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

if (existsSync(join(DIST_DIR, "index.html"))) {
  // Hashed asset filenames are safe to cache hard; index.html must not be
  // cached or clients pin themselves to a stale build.
  app.use("/assets", express.static(join(DIST_DIR, "assets"), {
    immutable: true,
    maxAge: "1y",
  }));
  app.use(express.static(DIST_DIR, { index: false, maxAge: "1h" }));

  // SPA fallback: every non-API path returns the shell so client-side
  // routing works on a hard refresh or a shared deep link.
  //
  // Written as path-less middleware rather than app.get("*"): Express 5
  // uses path-to-regexp v8, where a bare "*" is no longer a valid path
  // and throws at startup.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Anything under /api that reached here is a genuine 404, handled above.
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(join(DIST_DIR, "index.html"));
  });
} else if (IS_PROD) {
  console.warn("[web] dist/ not found — run `npm run build` before starting in production.");
}

// Body-parser rejects malformed JSON before any route runs, so without
// this Express would answer with its default HTML error page and the
// client's `res.json()` parse would fail with a confusing message.
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON." });
  }
  console.error("[api]", err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));

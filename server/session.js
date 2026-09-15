// Signed session tokens.
//
// These replace an unsigned `base64url("<id>:<email>")` token, which any
// visitor could forge to become any user — including the admin. The
// format is now:
//
//   base64url(JSON payload) "." base64url(HMAC-SHA256 of that payload)
//
// The HMAC is keyed on SESSION_SECRET, so a payload cannot be modified or
// invented without the secret. Tokens also expire.
//
// This is deliberately not a JWT library: the requirement is one signed,
// expiring bearer token, and hand-rolling that with node:crypto avoids a
// dependency and the JWT algorithm-confusion footguns. If this grows to
// need JWKS, refresh tokens or third-party verification, switch to `jose`.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const isProd = process.env.NODE_ENV === "production";
const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);
export const SESSION_TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const resolveSecret = () => {
  const fromEnv = (process.env.SESSION_SECRET ?? "").trim();

  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error(
        "SESSION_SECRET must be at least 32 characters. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
      );
    }
    return fromEnv;
  }

  // Never fall back to a fixed default: a known secret is the same as no
  // signature at all. In production this is fatal; in development a random
  // per-boot secret is fine (it just signs everyone out on restart).
  if (isProd) {
    throw new Error(
      "SESSION_SECRET is required when NODE_ENV=production. Generate one with:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n" +
      "then set it on the host (e.g. `fly secrets set SESSION_SECRET=...`)."
    );
  }

  console.warn("[session] SESSION_SECRET not set — using a random development secret; existing sessions will not survive a restart.");
  return randomBytes(48).toString("base64url");
};

const SECRET = resolveSecret();

const sign = (data) => createHmac("sha256", SECRET).update(data).digest("base64url");

/** Issue a token for a user. */
export const issue = (user, now = Date.now()) => {
  const payload = {
    uid: user.id,
    // Included for logging and debuggability only — never trusted for
    // lookup, which always goes through uid.
    eml: user.email,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
};

/**
 * Verify a token's signature and expiry.
 * @returns {{uid:number, eml:string, iat:number, exp:number} | null}
 */
export const verify = (token, now = Date.now()) => {
  if (typeof token !== "string") return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expected = sign(body);
  // Compare as fixed-length buffers: a plain === leaks how much of the
  // signature matched via timing.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload.uid !== "number") return null;
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;

  return payload;
};

// Sign in with Apple.
//
// Apple is not a drop-in OIDC provider. Three things differ from Google,
// and each one is a place this used to be easy to get wrong:
//
//  1. THERE IS NO CLIENT SECRET. You mint one yourself: a short-lived
//     JWT signed ES256 with a .p8 private key from the developer portal.
//     It expires (Apple caps it at 6 months), so it is generated per
//     token request rather than stored in the environment.
//
//  2. THERE IS NO USERINFO ENDPOINT. The profile comes out of the
//     `id_token` in the token response. That token is verified against
//     Apple's published JWKS before anything in it is trusted.
//
//  3. THE CALLBACK IS A POST. Asking for `name email` scope forces
//     `response_mode=form_post`, so Apple posts a form back instead of
//     redirecting with query params. The user's NAME is only ever sent
//     on the very first authorization, in a `user` JSON field — after
//     that it is gone forever, so it has to be stored on first sight.
//
// Configuration (see .env.example):
//   APPLE_CLIENT_ID    the Services ID, e.g. com.example.parkspace.web
//   APPLE_TEAM_ID      10-character team id
//   APPLE_KEY_ID       10-character key id for the .p8
//   APPLE_PRIVATE_KEY  contents of the .p8, newlines as \n
//
// Apple requires HTTPS for the redirect URI, with one exception:
// `localhost` is not accepted at all. For local development use a
// tunnel (e.g. ngrok) and set OAUTH_PUBLIC_URL to the https URL.

import { createPrivateKey, createPublicKey, createSign, createVerify } from "node:crypto";

const env = (k, fallback = "") => (process.env[k] ?? "").trim() || fallback;

export const APPLE_ISSUER = "https://appleid.apple.com";

export const appleConfig = () => ({
  clientId: env("APPLE_CLIENT_ID"),
  teamId: env("APPLE_TEAM_ID"),
  keyId: env("APPLE_KEY_ID"),
  // A .p8 pasted into an env var arrives with literal \n rather than real
  // newlines; PEM parsing needs the real thing.
  privateKey: env("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  jwksUrl: env("APPLE_JWKS_URL", `${APPLE_ISSUER}/auth/keys`),
  issuer: env("APPLE_ISSUER", APPLE_ISSUER),
});

/** Apple needs four values, not the usual two. */
export const isAppleConfigured = () => {
  const c = appleConfig();
  return Boolean(c.clientId && c.teamId && c.keyId && c.privateKey);
};

const b64url = (input) => Buffer.from(input).toString("base64url");

/**
 * Apple's ES256 signature is raw R||S (JOSE), but node's signer emits
 * DER. Convert: strip the DER wrapper and left-pad each integer to 32
 * bytes. Signing with the DER bytes directly produces a token Apple
 * rejects as malformed, with no useful error message.
 */
const derToJose = (der) => {
  let offset = 2;
  // Skip a long-form length byte if present.
  if (der[1] & 0x80) offset += der[1] & 0x7f;

  const readInt = () => {
    if (der[offset] !== 0x02) throw new Error("malformed ECDSA signature");
    const len = der[offset + 1];
    let start = offset + 2;
    let end = start + len;
    offset = end;
    // DER integers are signed, so a leading 0x00 may pad a high bit.
    let bytes = der.subarray(start, end);
    while (bytes.length > 32 && bytes[0] === 0x00) bytes = bytes.subarray(1);
    const out = Buffer.alloc(32);
    bytes.copy(out, 32 - bytes.length);
    return out;
  };

  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
};

/**
 * Mint the client secret JWT.
 *
 * `sub` is the Services ID and `iss` is the team id — the opposite way
 * round to most JWTs, and swapping them yields `invalid_client`.
 */
export const appleClientSecret = ({ ttlSeconds = 300 } = {}) => {
  const { clientId, teamId, keyId, privateKey } = appleConfig();
  if (!isAppleConfigured()) {
    throw new Error("Apple sign-in is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + ttlSeconds,
    aud: APPLE_ISSUER,
    sub: clientId,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  let key;
  try {
    key = createPrivateKey(privateKey);
  } catch (e) {
    throw new Error(
      `APPLE_PRIVATE_KEY is not a readable PEM key (${e.message}). Paste the ` +
        `whole .p8 including the BEGIN/END lines, with newlines as \\n.`,
    );
  }

  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = derToJose(signer.sign(key));

  return `${signingInput}.${signature.toString("base64url")}`;
};

// ─── id_token verification ──────────────────────────────
// Apple's signing keys rotate, so the JWKS is fetched and cached rather
// than pinned. A key id we have not seen forces a refetch once.
let jwksCache = { at: 0, keys: [] };
const JWKS_TTL_MS = 60 * 60_000;

const fetchJwks = async (force = false) => {
  const fresh = Date.now() - jwksCache.at < JWKS_TTL_MS;
  if (!force && fresh && jwksCache.keys.length) return jwksCache.keys;

  const { jwksUrl } = appleConfig();
  const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Could not fetch Apple's signing keys (${res.status}).`);

  const body = await res.json();
  jwksCache = { at: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
};

/** Reset between tests, and after a key rotation. */
export const __clearJwksCache = () => {
  jwksCache = { at: 0, keys: [] };
};

const decodeSegment = (segment) =>
  JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

/**
 * Verify and decode an Apple id_token.
 *
 * Checks the signature against Apple's JWKS, then the issuer, audience
 * and expiry. Skipping any of these would accept a token minted by
 * anyone — the signature alone does not tell you who it was issued *for*.
 */
export const verifyAppleIdToken = async (idToken, { nonce } = {}) => {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) throw new Error("Apple returned a malformed identity token.");

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeSegment(headerB64);
  const payload = decodeSegment(payloadB64);

  if (header.alg !== "RS256") {
    throw new Error(`Unexpected Apple token algorithm: ${header.alg}`);
  }

  let keys = await fetchJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Key may have rotated since the cache was filled.
    keys = await fetchJwks(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("Apple signed the token with an unknown key.");

  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(publicKey, Buffer.from(signatureB64, "base64url"))) {
    throw new Error("Apple's identity token failed signature verification.");
  }

  const { clientId, issuer } = appleConfig();
  if (payload.iss !== issuer) {
    throw new Error(`Apple token issuer mismatch: ${payload.iss}`);
  }
  // `aud` is our Services ID. Without this check a token Apple issued for
  // a different app would be accepted.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(clientId)) {
    throw new Error("Apple token was issued for a different application.");
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    throw new Error("Apple's identity token has expired.");
  }
  if (nonce && payload.nonce !== nonce) {
    throw new Error("Apple token nonce mismatch.");
  }

  return payload;
};

/**
 * Build a profile from a verified id_token plus the one-shot `user` form
 * field.
 *
 * Apple sends the name ONLY on first authorization. On every later
 * sign-in there is no name at all, so a placeholder is used and the
 * stored name is left alone by the upsert.
 */
export const appleProfile = (claims, userField) => {
  let firstName = "";
  let lastName = "";

  if (userField) {
    try {
      const parsed = typeof userField === "string" ? JSON.parse(userField) : userField;
      firstName = parsed?.name?.firstName ?? "";
      lastName = parsed?.name?.lastName ?? "";
    } catch {
      // A malformed `user` field is not worth failing the sign-in over.
    }
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const email = claims.email ?? null;

  return {
    providerId: String(claims.sub),
    email,
    // Apple sends this as a string on some paths and a boolean on others.
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    // NULL, not a derived placeholder, when Apple sent no name.
    //
    // This matters on every sign-in after the first, because Apple only
    // ever sends the name once. Returning something like the email's
    // local part here looks harmless but means the second sign-in
    // OVERWRITES the stored name — "Apple Tester" becomes
    // "apple.tester". upsertOAuthUser keeps the existing name when this
    // is falsy, so null is what preserves it.
    name: fullName || null,
    // Apple never provides an avatar.
    avatar: "",
    /** True when Apple is relaying to a generated private address. */
    isPrivateRelay: claims.is_private_email === true || claims.is_private_email === "true",
  };
};

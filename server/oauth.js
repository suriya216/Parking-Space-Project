// OAuth 2.0 / OpenID Connect sign-in, Authorization Code flow with PKCE.
//
// Configure with environment variables (see .env.example) and start the
// server with `--env-file=.env`, or export them yourself:
//
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//   OAUTH_PUBLIC_URL   default http://localhost:3001
//   APP_PUBLIC_URL     default http://localhost:5173
//
// A provider with no client id is simply reported as unconfigured; the
// sign-in screen then falls back to the labelled demo sign-in rather than
// offering a button that cannot work.

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { appleClientSecret, appleConfig, isAppleConfigured } from "./apple.js";

const env = (k, fallback = "") => (process.env[k] ?? "").trim() || fallback;

export const OAUTH_PUBLIC_URL = env("OAUTH_PUBLIC_URL", "http://localhost:3001");
export const APP_PUBLIC_URL = env("APP_PUBLIC_URL", "http://localhost:5173");

// Endpoints are overridable so the test suite can point the whole flow at
// a local fake provider and exercise it for real.
export const PROVIDERS = {
  google: {
    id: "google",
    label: "Google",
    authUrl: env("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    tokenUrl: env("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    userInfoUrl: env("GOOGLE_USERINFO_URL", "https://openidconnect.googleapis.com/v1/userinfo"),
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    scope: "openid email profile",
    usesPkce: true,
    // Google returns an OIDC id_token; we read the profile from userinfo
    // so there is one code path for both providers.
    mapProfile: (u) => ({
      providerId: String(u.sub),
      email: u.email ?? null,
      emailVerified: u.email_verified === true || u.email_verified === "true",
      name: u.name || u.given_name || (u.email ? u.email.split("@")[0] : "New user"),
      avatar: u.picture ?? "",
    }),
  },
  apple: {
    id: "apple",
    label: "Apple",
    authUrl: env("APPLE_AUTH_URL", "https://appleid.apple.com/auth/authorize"),
    tokenUrl: env("APPLE_TOKEN_URL", "https://appleid.apple.com/auth/token"),
    // Apple has no userinfo endpoint — the profile comes from the
    // id_token. See server/apple.js.
    userInfoUrl: null,
    get clientId() {
      return appleConfig().clientId;
    },
    // Minted per request as a signed JWT, never read from the
    // environment. `exchangeCode` calls this instead of using a static
    // value.
    get clientSecret() {
      return isAppleConfigured() ? appleClientSecret() : "";
    },
    scope: "name email",
    usesPkce: true,
    // Asking for name/email scope obliges Apple to POST the callback
    // back to us as a form rather than redirecting with query params.
    usesFormPost: true,
    // Profile is read from the verified id_token, not fetched.
    profileFromIdToken: true,
    // Four env vars rather than two, so it has its own predicate.
    isConfigured: isAppleConfigured,
  },
  github: {
    id: "github",
    label: "GitHub",
    authUrl: env("GITHUB_AUTH_URL", "https://github.com/login/oauth/authorize"),
    tokenUrl: env("GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"),
    userInfoUrl: env("GITHUB_USERINFO_URL", "https://api.github.com/user"),
    clientId: env("GITHUB_CLIENT_ID"),
    clientSecret: env("GITHUB_CLIENT_SECRET"),
    scope: "read:user user:email",
    usesPkce: false, // GitHub's OAuth app flow does not support PKCE
    mapProfile: (u) => ({
      providerId: String(u.id),
      email: u.email ?? null,
      // GitHub's /user email is only present when public; it is verified
      // on their side, but treat a null email as unverified.
      emailVerified: Boolean(u.email),
      name: u.name || u.login || "New user",
      avatar: u.avatar_url ?? "",
    }),
  },
};

/**
 * Is this provider usable?
 *
 * A provider may supply its own predicate — Apple needs four values
 * (Services ID, team id, key id, private key) rather than the usual
 * id/secret pair, and reading its `clientSecret` getter mints a JWT,
 * which must not happen just to answer "is it set up?".
 */
export const isConfigured = (p) => {
  if (!p) return false;
  if (typeof p.isConfigured === "function") return p.isConfigured();
  return Boolean(p.clientId && p.clientSecret);
};

export const configuredProviders = () =>
  Object.values(PROVIDERS)
    .filter(isConfigured)
    .map((p) => ({ id: p.id, label: p.label }));

export const redirectUriFor = (provider) =>
  `${OAUTH_PUBLIC_URL}/api/auth/${provider.id}/callback`;

// ─── PKCE ───────────────────────────────────────────────
const base64url = (buf) => buf.toString("base64url");

const makePkce = () => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

// ─── TRANSIENT STATE ────────────────────────────────────
// `state` defeats CSRF on the callback and carries the PKCE verifier.
// In-memory is fine for a single-process demo; a multi-instance
// deployment would need a shared store (Redis, or a signed cookie).
const STATE_TTL_MS = 10 * 60_000;
const states = new Map();

const sweep = (map, ttl) => {
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > ttl) map.delete(k);
};

export const createState = (providerId) => {
  sweep(states, STATE_TTL_MS);
  const state = base64url(randomBytes(24));
  const pkce = makePkce();
  states.set(state, { at: Date.now(), providerId, verifier: pkce.verifier });
  return { state, challenge: pkce.challenge };
};

export const consumeState = (state) => {
  sweep(states, STATE_TTL_MS);
  const entry = states.get(state);
  // Single use: a replayed callback must not authenticate again.
  if (entry) states.delete(state);
  return entry ?? null;
};

// ─── ONE-TIME HANDOFF CODES ─────────────────────────────
// The callback redirects the browser back to the SPA with a short-lived
// opaque code, which the SPA exchanges for its session. This keeps the
// session token out of the URL (and so out of history, logs and the
// Referer header).
const HANDOFF_TTL_MS = 60_000;
const handoffs = new Map();

export const createHandoff = (payload) => {
  sweep(handoffs, HANDOFF_TTL_MS);
  const code = randomUUID();
  handoffs.set(code, { at: Date.now(), payload });
  return code;
};

export const consumeHandoff = (code) => {
  sweep(handoffs, HANDOFF_TTL_MS);
  const entry = handoffs.get(code);
  if (entry) handoffs.delete(code);
  return entry?.payload ?? null;
};

// ─── AUTHORIZATION URL ──────────────────────────────────
export const authorizeUrl = (provider) => {
  const { state, challenge } = createState(provider.id);
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUriFor(provider),
    response_type: "code",
    scope: provider.scope,
    state,
  });
  if (provider.usesPkce) {
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }
  // Ask Google for a fresh account chooser rather than silently reusing a
  // signed-in session, which is confusing on a shared machine.
  if (provider.id === "google") params.set("prompt", "select_account");
  // Apple requires form_post whenever name/email scope is requested; it
  // rejects the authorize request outright without it.
  if (provider.usesFormPost) params.set("response_mode", "form_post");
  return `${provider.authUrl}?${params}`;
};

// ─── TOKEN EXCHANGE + PROFILE ───────────────────────────
const asError = (message, cause) => {
  const e = new Error(message);
  if (cause) e.cause = cause;
  return e;
};

export const exchangeCode = async (provider, code, verifier) => {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    // For Apple this getter mints a fresh ES256 JWT; for the others it is
    // the static secret from the environment.
    client_secret: provider.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUriFor(provider),
  });
  if (provider.usesPkce && verifier) body.set("code_verifier", verifier);

  let res;
  try {
    res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // A TLS-inspecting corporate proxy shows up here as
    // UNABLE_TO_GET_ISSUER_CERT_LOCALLY; NODE_EXTRA_CA_CERTS fixes it.
    throw asError(`Could not reach ${provider.label}: ${e.cause?.code ?? e.message}`, e);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!res.ok || !json?.access_token) {
    const detail = json?.error_description ?? json?.error ?? text.slice(0, 200);
    throw asError(`${provider.label} rejected the authorization code: ${detail}`);
  }
  return json;
};

export const fetchProfile = async (provider, accessToken) => {
  let res;
  try {
    res = await fetch(provider.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "ParkSpace",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw asError(`Could not read your ${provider.label} profile: ${e.cause?.code ?? e.message}`, e);
  }

  if (!res.ok) {
    throw asError(`${provider.label} profile request failed (${res.status}).`);
  }

  const raw = await res.json();
  const profile = provider.mapProfile(raw);
  if (!profile.providerId) throw asError(`${provider.label} did not return an account id.`);
  return profile;
};

// GitHub only exposes a private primary email via a separate endpoint.
export const fetchGithubEmail = async (accessToken) => {
  try {
    const res = await fetch(env("GITHUB_EMAILS_URL", "https://api.github.com/user/emails"), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "ParkSpace" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const list = await res.json();
    const primary = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
    return primary ? { email: primary.email, emailVerified: true } : null;
  } catch {
    return null;
  }
};

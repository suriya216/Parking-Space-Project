/**
 * Sign in with Apple, end to end against a fake Apple.
 *
 * Everything except Apple's own servers is the production path: the
 * ES256 client-secret JWT, PKCE, the form_post callback, RS256 id_token
 * verification against a JWKS, and the issuer/audience/expiry checks.
 *
 * Serial — one fake provider and one app server are shared, and the
 * account-linking assertions depend on what has been seen before.
 */

import { expect, test } from "@playwright/test";

import {
  APPLE_CLIENT_ID,
  APPLE_IDP_PORT,
  startAppleEnvironment,
  type AppleEnvironment,
} from "@support/apple-harness";

test.describe.configure({ mode: "serial" });

let env: AppleEnvironment;

test.beforeAll(async () => {
  env = await startAppleEnvironment();
});

test.afterAll(async () => {
  await env?.stop();
});

const locationOf = (res: Response): URL => {
  const location = res.headers.get("location");
  expect(location, "expected a Location header").toBeTruthy();
  return new URL(location!);
};

/**
 * Walk authorize → form_post callback and return the app-bound redirect.
 *
 * The fake provider answers /authorize with an auto-submitting HTML form,
 * so the POST has to be replayed by hand — there is no browser here.
 */
const completeAppleSignIn = async (): Promise<URL> => {
  const start = await fetch(`${env.apiBase}/auth/apple/start`, { redirect: "manual" });
  expect(start.status).toBe(302);
  const authorizeUrl = locationOf(start);

  const consent = await fetch(authorizeUrl.toString());
  const html = await consent.text();

  const action = html.match(/action="([^"]+)"/)?.[1];
  expect(action, "the form should post back to our callback").toBeTruthy();

  const fields = new URLSearchParams();
  for (const match of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    fields.set(name, value.replace(/&quot;/g, '"'));
  }

  const callback = await fetch(action!, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: fields,
    redirect: "manual",
  });
  return locationOf(callback);
};

const exchange = async (handoff: string | null) => {
  const res = await fetch(`${env.apiBase}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: handoff }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

test.describe("discovery", () => {
  test("apple is advertised once its four values are set", async () => {
    /* Apple needs a Services ID, team id, key id and private key — not
       the usual id/secret pair — so it has its own configured check. */
    const res = await fetch(`${env.apiBase}/auth/providers`);
    const body = (await res.json()) as { providers: Array<{ id: string; label: string }> };

    const apple = body.providers.find((p) => p.id === "apple");
    expect(apple, "apple should be configured in this environment").toBeDefined();
    expect(apple?.label).toBe("Apple");
  });
});

test.describe("the authorize request", () => {
  test("asks for form_post, name/email scope and PKCE", async () => {
    const res = await fetch(`${env.apiBase}/auth/apple/start`, { redirect: "manual" });
    const url = locationOf(res);

    expect(url.origin).toBe(`http://localhost:${APPLE_IDP_PORT}`);
    expect(url.searchParams.get("client_id")).toBe(APPLE_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");

    /* Apple rejects the request outright without this when name/email
       scope is requested. */
    expect(url.searchParams.get("response_mode")).toBe("form_post");
    expect(url.searchParams.get("scope")).toBe("name email");

    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toContain("/api/auth/apple/callback");
  });
});

test.describe("a successful sign-in", () => {
  test("accepts the form POST and creates an account from the id_token", async () => {
    /* First authorization: Apple sends the display name exactly once, in
       a `user` JSON field. */
    env.setUserField(JSON.stringify({ name: { firstName: "Apple", lastName: "Tester" } }));

    const back = await completeAppleSignIn();
    expect(back.origin).toBe("http://localhost:5173");

    const handoff = back.searchParams.get("oauth");
    expect(handoff, back.search).toBeTruthy();
    expect(back.search, "no token may travel in the URL").not.toContain("token");

    const { status, body } = await exchange(handoff);
    expect(status).toBe(200);

    const user = body.user as { name: string; email: string; provider: string; role: string };
    expect(user.provider).toBe("apple");
    expect(user.name).toBe("Apple Tester");
    expect(user.email).toBe("apple.tester@privaterelay.appleid.com");
    /* A new provider account is a driver, never an admin. */
    expect(user.role).toBe("driver");
    expect(body.token).toBeTruthy();

    env.setUserField(null);
  });

  test("the client secret was a JWT with the right claims", () => {
    /* The fake provider rejects the token request unless client_secret is
       a JWT whose iss is the TEAM id and sub is the Services ID — the
       pair that is easiest to swap. Reaching a session above proves it. */
    const paths = env.idpLog().join(" ");
    expect(paths).toContain("/auth/authorize");
    expect(paths).toContain("/auth/token");
    expect(paths).toContain("/auth/keys");
  });

  test("a second sign-in maps to the same user and keeps the stored name", async () => {
    /* Apple sends no name after the first authorization. The account must
       keep the name it already has rather than being renamed to a
       placeholder. */
    env.setUserField(null);

    const back = await completeAppleSignIn();
    const { status, body } = await exchange(back.searchParams.get("oauth"));

    expect(status).toBe(200);
    const user = body.user as { name: string; id: number };
    expect(user.name).toBe("Apple Tester");
    expect(body.created ?? false).toBe(false);
  });
});

test.describe("id_token verification", () => {
  test("rejects a token signed with a key that is not in the JWKS", async () => {
    env.useWrongSigningKey(true);

    const back = await completeAppleSignIn();

    expect(back.searchParams.has("oauth"), "no session may be handed over").toBe(false);
    expect(back.searchParams.get("oauth_error") ?? "").toMatch(
      /signature|unknown key/i,
    );

    env.useWrongSigningKey(false);
  });

  test("rejects a token issued for a different application", async () => {
    /* A valid Apple signature is not enough: the token must be addressed
       to our Services ID. */
    env.setClaims({ aud: "com.someone.else.app" });

    const back = await completeAppleSignIn();
    expect(back.searchParams.has("oauth")).toBe(false);
    expect(back.searchParams.get("oauth_error") ?? "").toMatch(
      /different application/i,
    );

    env.resetClaims();
  });

  test("rejects a token from the wrong issuer", async () => {
    env.setClaims({ iss: "https://evil.example.com" });

    const back = await completeAppleSignIn();
    expect(back.searchParams.has("oauth")).toBe(false);
    expect(back.searchParams.get("oauth_error") ?? "").toMatch(/issuer/i);

    env.resetClaims();
  });

  test("rejects an expired token", async () => {
    env.setClaims({ exp: Math.floor(Date.now() / 1000) - 60 });

    const back = await completeAppleSignIn();
    expect(back.searchParams.has("oauth")).toBe(false);
    expect(back.searchParams.get("oauth_error") ?? "").toMatch(/expired/i);

    env.resetClaims();
  });
});

test.describe("account linking", () => {
  test("an unverified Apple email does not link to an existing account", async () => {
    /* The takeover guard: anyone can claim an address at a provider, so
       an unverified one must never attach to a password account. */
    env.setClaims({
      sub: "001234.other-apple-sub.0000",
      email: "driver@parkspace.test",
      email_verified: false,
    });

    const back = await completeAppleSignIn();
    expect(back.searchParams.has("oauth")).toBe(false);
    expect(back.searchParams.get("oauth_error") ?? "").toMatch(/hasn't verified/i);

    env.resetClaims();
  });

  test("a verified Apple email links to the existing password account", async () => {
    env.setClaims({
      sub: "001234.linking-apple-sub.0000",
      email: "driver@parkspace.test",
      email_verified: true,
    });

    const back = await completeAppleSignIn();
    const { status, body } = await exchange(back.searchParams.get("oauth"));

    expect(status).toBe(200);
    expect(body.linked).toBe(true);
    const user = body.user as { email: string; role: string };
    expect(user.email).toBe("driver@parkspace.test");
    /* Linking must not escalate the account. */
    expect(user.role).toBe("driver");

    env.resetClaims();
  });

  test("an Apple account with no email still gets a usable account", async () => {
    /* Apple can withhold the email entirely if the user hides it and the
       relay is unavailable. */
    env.setClaims({
      sub: "001234.no-email-apple-sub.0000",
      email: undefined,
      email_verified: undefined,
    });

    const back = await completeAppleSignIn();
    const { status, body } = await exchange(back.searchParams.get("oauth"));

    expect(status).toBe(200);
    const user = body.user as { id: number; email: string };
    expect(user.id).toBeGreaterThan(0);
    expect(user.email).toMatch(/invalid|localhost|noreply|\.invalid$/i);

    env.resetClaims();
  });
});

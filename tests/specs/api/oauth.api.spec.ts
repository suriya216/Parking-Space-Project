/**
 * The real OAuth Authorization Code + PKCE flow — ports
 * e2e/oauth.test.mjs.
 *
 * Serial, because every test shares one fake provider and one app server,
 * and several assertions depend on whether a provider identity has been
 * seen before.
 */

import { expect, test } from "@playwright/test";

import {
  CLIENT_ID,
  IDP_PORT,
  OAUTH_API_PORT,
  startOauthEnvironment,
  type OauthEnvironment,
} from "@support/oauth-harness";

test.describe.configure({ mode: "serial" });

let env: OauthEnvironment;

test.beforeAll(async () => {
  env = await startOauthEnvironment();
});

test.afterAll(async () => {
  await env?.stop();
});

/** GET without following redirects, so the Location can be inspected. */
const getNoRedirect = (path: string): Promise<Response> =>
  fetch(`${env.apiBase}${path}`, { redirect: "manual" });

const locationOf = (res: Response): URL => {
  const location = res.headers.get("location");
  expect(location, "response should carry a Location header").toBeTruthy();
  return new URL(location!);
};

/** Walk authorize → callback and return the app-bound redirect. */
const completeHandshake = async (): Promise<URL> => {
  const start = await getNoRedirect("/auth/google/start");
  const authorizeUrl = locationOf(start);

  const consented = await fetch(authorizeUrl.toString(), { redirect: "manual" });
  const callbackUrl = locationOf(consented);

  const callback = await fetch(callbackUrl.toString(), { redirect: "manual" });
  return locationOf(callback);
};

test.describe("provider discovery", () => {
  test("reports google as configured and nothing that isn't", async () => {
    const res = await fetch(`${env.apiBase}/auth/providers`);
    const body = (await res.json()) as { providers: Array<{ id: string }> };

    expect(body.providers.some((p) => p.id === "google")).toBe(true);
    /* Providers without credentials must not be advertised — the sign-in
       screen renders a button per entry, so anything listed here has to
       be able to complete a sign-in. */
    expect(body.providers.some((p) => p.id === "github")).toBe(false);
    expect(body.providers.some((p) => p.id === "apple")).toBe(false);
  });
});

test.describe("the authorize redirect", () => {
  test("sends a correct PKCE + anti-CSRF authorization request", async () => {
    const res = await getNoRedirect("/auth/google/start");
    expect(res.status).toBe(302);

    const url = locationOf(res);
    expect(url.origin).toBe(`http://localhost:${IDP_PORT}`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope") ?? "").toContain("openid");

    /* PKCE S256, not "plain" — a plain challenge is no protection. */
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();

    expect(url.searchParams.get("state"), "anti-CSRF state").toBeTruthy();
    expect(url.searchParams.get("redirect_uri") ?? "").toContain(
      `localhost:${OAUTH_API_PORT}`,
    );
  });

  test("state is unique per request", async () => {
    const first = locationOf(await getNoRedirect("/auth/google/start"));
    const second = locationOf(await getNoRedirect("/auth/google/start"));

    expect(first.searchParams.get("state")).not.toBe(second.searchParams.get("state"));
  });
});

test.describe("callback rejections", () => {
  test("an unknown state is refused and explains itself", async () => {
    const res = await getNoRedirect("/auth/google/callback?code=x&state=not-a-real-state");
    const url = locationOf(res);

    expect(url.searchParams.has("oauth_error")).toBe(true);
    expect(url.searchParams.get("oauth_error") ?? "").toMatch(
      /expired|not been recognised|not recognised/i,
    );
  });

  test("a missing code is refused", async () => {
    const start = locationOf(await getNoRedirect("/auth/google/start"));
    const state = start.searchParams.get("state") ?? "";

    const res = await getNoRedirect(`/auth/google/callback?state=${state}`);
    expect(locationOf(res).searchParams.has("oauth_error")).toBe(true);
  });

  test("a provider-side denial is surfaced, not swallowed", async () => {
    const start = locationOf(await getNoRedirect("/auth/google/start"));
    const state = start.searchParams.get("state") ?? "";

    const res = await getNoRedirect(
      `/auth/google/callback?error=access_denied&state=${state}`,
    );
    expect(locationOf(res).searchParams.has("oauth_error")).toBe(true);
  });

  test("a replayed state is refused the second time", async () => {
    const start = await getNoRedirect("/auth/google/start");
    const authorizeUrl = locationOf(start);
    const consented = await fetch(authorizeUrl.toString(), { redirect: "manual" });
    const callbackUrl = locationOf(consented);

    const first = await fetch(callbackUrl.toString(), { redirect: "manual" });
    expect(locationOf(first).searchParams.has("oauth")).toBe(true);

    /* Same state, same code — must not mint a second session. */
    const second = await fetch(callbackUrl.toString(), { redirect: "manual" });
    expect(locationOf(second).searchParams.has("oauth_error")).toBe(true);
  });
});

test.describe("a successful sign-in", () => {
  test("hands off via a single-use code and never puts a token in the URL", async () => {
    const back = await completeHandshake();

    expect(back.origin).toBe("http://localhost:5173");
    const handoff = back.searchParams.get("oauth");
    expect(handoff, "handoff code should be present").toBeTruthy();
    /* The session token must never travel in a URL — it would land in
       browser history, referrers and server logs. */
    expect(back.search).not.toContain("token");

    const exchanged = await fetch(`${env.apiBase}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: handoff }),
    });
    expect(exchanged.status).toBe(200);

    const session = (await exchanged.json()) as {
      token: string;
      user: { provider: string; name: string; email: string; avatar: string; role: string };
    };

    expect(session.token).toBeTruthy();
    expect(session.user.provider).toBe("google");
    expect(session.user.name).toBe("OAuth Tester");
    expect(session.user.email).toBe("oauth.tester@example.com");
    expect(session.user.avatar).toBe("https://example.com/avatar.png");
    /* A new provider account is a driver — never an admin. */
    expect(session.user.role).toBe("driver");

    /* The handoff code is spent. */
    const replay = await fetch(`${env.apiBase}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: handoff }),
    });
    expect(replay.status).toBe(410);

    /* And the session actually authenticates. */
    const me = await fetch(`${env.apiBase}/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    const meBody = (await me.json()) as { user: { email: string } };
    expect(meBody.user.email).toBe("oauth.tester@example.com");

    /* An OAuth account has no password, so changing one is a conflict
       rather than a 500. */
    const pw = await fetch(`${env.apiBase}/me/password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ currentPassword: "x", newPassword: "Whatever@123" }),
    });
    expect(pw.status).toBe(409);
  });

  test("an unknown handoff code is refused", async () => {
    const res = await fetch(`${env.apiBase}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "nope" }),
    });
    expect(res.status).toBe(410);
  });

  test("signing in twice maps to the same user", async () => {
    const back = await completeHandshake();
    const exchanged = await fetch(`${env.apiBase}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: back.searchParams.get("oauth") }),
    });
    const session = (await exchanged.json()) as {
      user: { id: number };
      created?: boolean;
    };

    /* The identity was already created by the earlier test in this serial
       file, so this must be a returning user, not a duplicate. */
    expect(session.user.id).toBeGreaterThan(0);
    expect(session.created ?? false).toBe(false);
  });

  test("the provider's authorize, token and userinfo were all called", () => {
    const paths = env.idpLog().join(" ");
    expect(paths).toContain("/authorize");
    expect(paths).toContain("/token");
    expect(paths).toContain("/userinfo");
  });
});

test.describe("account linking", () => {
  test("a verified provider email links to an existing password account", async () => {
    env.setProfile({
      sub: "fake-sub-99999",
      email: "driver@parkspace.test",
      email_verified: true,
      name: "Rajesh Kumar",
      picture: "",
    });

    const back = await completeHandshake();
    const exchanged = await fetch(`${env.apiBase}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: back.searchParams.get("oauth") }),
    });
    const session = (await exchanged.json()) as {
      linked?: boolean;
      user: { email: string; role: string };
    };

    expect(session.linked).toBe(true);
    /* Linking must not escalate or reset the existing account. */
    expect(session.user.email).toBe("driver@parkspace.test");
    expect(session.user.role).toBe("driver");

    env.resetProfile();
  });

  test("an UNVERIFIED provider email matching a local account is refused", async () => {
    /* This is the account-takeover guard: anyone can claim an unverified
       address at a provider, so it must not link to a real account. */
    env.setProfile({
      sub: "fake-sub-77777",
      email: "admin@parkspace.test",
      email_verified: false,
      name: "Not The Admin",
      picture: "",
    });

    const back = await completeHandshake();

    expect(back.searchParams.has("oauth"), "no session may be handed over").toBe(false);
    expect(back.searchParams.get("oauth_error") ?? "").toMatch(/hasn't verified/i);

    env.resetProfile();
  });

  test("a provider account with no email still gets a usable account", async () => {
    env.setProfile({ sub: "fake-sub-55555", name: "No Email Person" });

    const back = await completeHandshake();
    const exchanged = await fetch(`${env.apiBase}/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: back.searchParams.get("oauth") }),
    });
    const session = (await exchanged.json()) as { user: { id: number; email: string } };

    expect(session.user.id).toBeGreaterThan(0);
    /* The placeholder address must be non-routable so it can never
       receive mail or collide with a real one. */
    expect(session.user.email).toMatch(/invalid|localhost|\.invalid$|noreply/i);

    env.resetProfile();
  });
});

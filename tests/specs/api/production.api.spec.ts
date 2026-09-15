/**
 * Is the app safe to expose on a public domain? — ports
 * e2e/production.test.mjs.
 *
 * Serial and self-hosted: it boots its own production-mode server and
 * then attacks it. Requires `npm run build`, because it asserts on the
 * built bundle being served from the same origin.
 */

import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  distIsBuilt,
  startProdServer,
  startWithSecret,
  type ProdEnvironment,
} from "@support/prod-harness";

test.describe.configure({ mode: "serial" });

const SEED_ADMIN = { email: "admin@parkspace.test", password: "Admin@123" };
const SEED_DRIVER = { email: "driver@parkspace.test", password: "Driver@123" };

let prod: ProdEnvironment;

test.beforeAll(async () => {
  test.skip(
    !distIsBuilt(),
    "dist/index.html missing — run `npm run build` before the production suite",
  );
  prod = await startProdServer();
});

test.afterAll(() => {
  prod?.stop();
});

const b64url = (value: string): string => Buffer.from(value).toString("base64url");

const loginAs = async (creds: { email: string; password: string }) => {
  const res = await prod.json<{ token: string; user: { role: string } }>("/api/login", {
    method: "POST",
    body: creds,
  });
  expect(res.status).toBe(200);
  return res.data;
};

test.describe("token forgery", () => {
  test("issues signed tokens and accepts the genuine one", async () => {
    const admin = await loginAs(SEED_ADMIN);

    expect(admin.user.role).toBe("admin");
    /* payload.signature — two parts, not a bare base64 blob. */
    expect(admin.token.split(".")).toHaveLength(2);

    const ok = await prod.json("/api/users", { token: admin.token });
    expect(ok.status).toBe(200);
  });

  test("rejects the old unsigned token scheme", async () => {
    /* Exactly the pre-deploy vulnerability: base64url("<id>:<email>"). */
    const legacy = b64url("1:admin@parkspace.test");
    const res = await prod.json("/api/users", { token: legacy });
    expect(res.status).toBe(401);
  });

  test("rejects an attacker-built payload in every form", async () => {
    const payload = b64url(
      JSON.stringify({
        uid: 1,
        eml: "admin@parkspace.test",
        iat: Date.now(),
        exp: Date.now() + 9e9,
      }),
    );

    /* No signature at all. */
    expect((await prod.json("/api/users", { token: payload })).status).toBe(401);

    /* A junk signature. */
    expect((await prod.json("/api/users", { token: `${payload}.deadbeef` })).status).toBe(
      401,
    );

    /* Correctly formed, but signed with the wrong key. */
    const wrongKey = createHmac("sha256", "not-the-real-secret")
      .update(payload)
      .digest("base64url");
    expect(
      (await prod.json("/api/users", { token: `${payload}.${wrongKey}` })).status,
    ).toBe(401);
  });

  test("rejects a tampered payload carrying a genuine signature", async () => {
    const admin = await loginAs(SEED_ADMIN);
    const [body, signature] = admin.token.split(".");

    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString()) as {
      uid: number;
    };
    /* Swap the user id but keep the original signature. */
    const swapped = b64url(JSON.stringify({ ...decoded, uid: 2 }));

    const res = await prod.json("/api/users", { token: `${swapped}.${signature}` });
    expect(res.status).toBe(401);
  });

  test("rejects an expired but correctly signed token", async () => {
    const expired = b64url(
      JSON.stringify({
        uid: 1,
        eml: "admin@parkspace.test",
        iat: 0,
        exp: Date.now() - 1000,
      }),
    );
    const signature = createHmac("sha256", prod.secret)
      .update(expired)
      .digest("base64url");

    const res = await prod.json("/api/users", { token: `${expired}.${signature}` });
    expect(res.status).toBe(401);
  });

  test("a driver token cannot reach admin routes", async () => {
    /* Privilege is re-read from the database per request, so a demotion
       takes effect immediately rather than at token expiry. */
    const driver = await loginAs(SEED_DRIVER);
    const res = await prod.json("/api/users", { token: driver.token });
    expect(res.status).toBe(403);
  });
});

test.describe("demo shortcuts are gone in production", () => {
  test("the published test passwords are not served", async () => {
    const res = await prod.json<Record<string, unknown>>("/api/demo-accounts");
    expect(res.status).toBe(404);
    /* And nothing password-shaped leaked in the 404 body. */
    expect(JSON.stringify(res.data).toLowerCase()).not.toContain("admin@123");
  });

  test("fake SSO sign-in does not exist", async () => {
    /* This route is gone, not merely gated: it used to sign the seeded
       driver in for anyone who tapped Google or Apple. */
    const res = await prod.json("/api/demo-sso", {
      method: "POST",
      body: { provider: "google" },
    });
    expect(res.status).toBe(404);
  });

  test("the providers endpoint reports demo mode off and lists nothing", async () => {
    const res = await prod.json<{ demoMode: boolean; providers: unknown[] }>(
      "/api/auth/providers",
    );
    expect(res.data.demoMode).toBe(false);
    /* No credentials configured, so nothing may be advertised — and with
       no demo fallback, the sign-in screen shows password entry only. */
    expect(res.data.providers).toHaveLength(0);
  });
});

test.describe("single-origin static hosting", () => {
  test("serves the app shell referencing the built bundle", async () => {
    const res = await prod.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    /* The shell itself must not be cached, or a deploy can't take. */
    expect(res.headers.get("cache-control") ?? "").toContain("no-cache");

    const html = await res.text();
    expect(html).toMatch(/\/assets\/index-[\w-]+\.js/);
  });

  test("hashed assets are served and cached immutably", async () => {
    const html = await (await prod.request("/")).text();
    const asset = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
    expect(asset, "the shell should reference a hashed bundle").toBeTruthy();

    const res = await prod.request(asset!);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control") ?? "").toContain("immutable");
  });

  test("a client-side route falls back to the shell", async () => {
    const res = await prod.request("/bookings");
    expect(res.status).toBe(200);
  });

  test("an unknown API path stays a JSON 404", async () => {
    /* The SPA fallback must not swallow API paths — a mistyped endpoint
       returning HTML is how a client ends up parse-erroring. */
    const res = await prod.json<{ error?: string }>("/api/nope");
    expect(res.status).toBe(404);
    expect(res.data.error).toBeTruthy();
  });
});

test.describe("security headers", () => {
  test("sets the headers a public deployment needs", async () => {
    const res = await prod.request("/");
    const header = (key: string): string => res.headers.get(key) ?? "";

    expect(header("strict-transport-security")).toContain("max-age");
    expect(header("content-security-policy")).toContain("default-src 'self'");
    /* The map would break without this, so it is a real requirement. */
    expect(header("content-security-policy")).toContain("tile.openstreetmap.org");
    expect(header("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(header("x-content-type-options")).toBe("nosniff");
    expect(header("x-frame-options")).toBe("DENY");
    expect(header("referrer-policy").length).toBeGreaterThan(0);
    /* Don't advertise the framework. */
    expect(res.headers.has("x-powered-by")).toBe(false);
  });

  test("API responses still forbid storing", async () => {
    const res = await prod.request("/api/spots");
    expect(res.headers.get("cache-control") ?? "").toContain("no-store");
  });
});

test.describe("login rate limiting", () => {
  /* Slower than the rest: ~85 sequential logins by design. */
  test.setTimeout(180_000);

  test("successful sign-ins are never limited", async () => {
    /* Many people legitimately share one NAT address, and only guessing
       produces failures — so throttling successes would lock out an
       entire office. */
    let succeeded = 0;
    for (let i = 0; i < 40; i += 1) {
      const res = await prod.request("/api/login", {
        method: "POST",
        body: SEED_DRIVER,
      });
      if (res.status === 200) succeeded += 1;
    }
    expect(succeeded, `${succeeded}/40 succeeded`).toBe(40);
  });

  test("repeated bad logins are throttled, and the block holds", async () => {
    let blocked = 0;
    let retryAfter: string | null = null;

    for (let i = 0; i < 45; i += 1) {
      const res = await prod.request("/api/login", {
        method: "POST",
        body: { email: SEED_ADMIN.email, password: "wrong" },
      });
      if (res.status === 429) {
        blocked += 1;
        retryAfter = res.headers.get("retry-after");
      }
    }

    expect(blocked, `${blocked} of 45 blocked`).toBeGreaterThan(0);
    expect(retryAfter, "a 429 should say when to retry").toBeTruthy();

    /* And the correct password is refused while the block is active, so a
       guesser cannot slip through by getting lucky mid-window. */
    const during = await prod.request("/api/login", {
      method: "POST",
      body: SEED_ADMIN,
    });
    expect(during.status).toBe(429);
  });
});

test.describe("startup refuses an insecure config", () => {
  test("a missing SESSION_SECRET is fatal", async () => {
    /* Silently falling back to a guessable key would make every signed
       token forgeable. */
    const { code, output } = await startWithSecret(4701, "");
    expect(code, `exited with ${code}`).not.toBe(0);
    expect(output).toMatch(/SESSION_SECRET is required/);
  });

  test("a too-short SESSION_SECRET is fatal", async () => {
    const { code, output } = await startWithSecret(4702, "tooshort");
    expect(code, `exited with ${code}`).not.toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });
});

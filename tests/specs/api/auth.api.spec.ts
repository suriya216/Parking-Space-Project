/**
 * Auth API — ports e2e/api.test.mjs (the auth half) and the auth-related
 * assertions from e2e/production.test.mjs.
 *
 * Runs in the `api` project, so no browser is launched.
 */

import { USERS, expect, test } from "@fixtures/index";
import { newAccount } from "@fixtures/users.fixture";

test.describe("POST /api/login", () => {
  for (const [role, user] of Object.entries(USERS)) {
    test(`${role} can authenticate and receives a usable token`, async ({ api }) => {
      const res = await api.login(user.email, user.password);

      expect(res.status).toBe(200);
      expect(res.data.token).toBeTruthy();
      expect(res.data.user.email).toBe(user.email);
      expect(res.data.user.role).toBe(user.role);

      /* A token that cannot fetch /me is not a token. */
      const me = await api.me(res.data.token);
      expect(me.status).toBe(200);
      expect(me.data.user.email).toBe(user.email);
    });
  }

  test("never returns the password hash", async ({ api }) => {
    const res = await api.login(USERS.driver.email, USERS.driver.password);
    const serialised = JSON.stringify(res.data);
    expect(serialised).not.toContain("pass_hash");
    expect(serialised).not.toContain(USERS.driver.password);
  });

  test("rejects a wrong password", async ({ api }) => {
    const res = await api.login(USERS.driver.email, "WrongPassword1!");
    expect(res.status).toBe(401);
    expect(res.data).not.toHaveProperty("token");
  });

  test("rejects an unknown email", async ({ api }) => {
    const res = await api.login("nobody@parkspace.test", "Whatever1!");
    expect(res.status).toBe(401);
  });

  test("does not distinguish unknown-user from wrong-password", async ({ api }) => {
    /* Different messages here would let an attacker enumerate accounts. */
    const unknown = await api.login("nobody@parkspace.test", "Whatever1!");
    const wrongPass = await api.login(USERS.driver.email, "WrongPassword1!");
    expect(unknown.status).toBe(wrongPass.status);
    expect(unknown.error).toBe(wrongPass.error);
  });

  test("matches email case-insensitively", async ({ api }) => {
    const res = await api.login(USERS.driver.email.toUpperCase(), USERS.driver.password);
    expect(res.status).toBe(200);
    expect(res.data.user.email).toBe(USERS.driver.email);
  });

  test("rejects a missing body", async ({ api }) => {
    const res = await api.call("/login", { method: "POST", body: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

test.describe("authorisation", () => {
  test("/me requires a token", async ({ api }) => {
    const res = await api.call("/me");
    expect(res.status).toBe(401);
  });

  test("/me rejects a forged token", async ({ api }) => {
    const forged = Buffer.from("1:admin@parkspace.test").toString("base64url");
    const res = await api.me(forged);
    expect(res.status).toBe(401);
  });

  test("a driver cannot list users", async ({ api }) => {
    const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const res = await api.users(driver.token);
    expect(res.status).toBe(403);
  });

  test("a driver cannot read admin stats", async ({ api }) => {
    const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const res = await api.stats(driver.token);
    expect(res.status).toBe(403);
  });

  test("an admin can list users and read stats", async ({ api }) => {
    const admin = await api.loginOrThrow(USERS.admin.email, USERS.admin.password);

    const users = await api.users(admin.token);
    expect(users.status).toBe(200);
    expect(users.data.users.length).toBeGreaterThanOrEqual(3);

    const stats = await api.stats(admin.token);
    expect(stats.status).toBe(200);
  });

  test("an admin cannot delete their own account", async ({ api }) => {
    const admin = await api.loginOrThrow(USERS.admin.email, USERS.admin.password);
    const res = await api.deleteUser(admin.token, admin.user.id);
    expect(res.status).toBeGreaterThanOrEqual(400);

    /* And is still able to authenticate afterwards. */
    const again = await api.login(USERS.admin.email, USERS.admin.password);
    expect(again.status).toBe(200);
  });
});

test.describe("POST /api/register", () => {
  test("creates an account and signs it in", async ({ api }) => {
    const account = newAccount("driver");
    const res = await api.register(account);

    /* 201 Created, not 200 — the route is correct; this assertion wasn't. */
    expect(res.status).toBe(201);
    expect(res.data.user.email).toBe(account.email);
    expect(res.data.user.role).toBe("driver");
    expect(res.data.token).toBeTruthy();
  });

  test("refuses a duplicate email", async ({ api }) => {
    const res = await api.register({ ...newAccount("driver"), email: USERS.driver.email });
    expect(res.status).toBe(409);
  });

  test("refuses a self-assigned admin role", async ({ api }) => {
    /* Privilege escalation guard: admin must not be self-serve. */
    const account = newAccount("driver");
    const res = await api.call<{ user?: { role?: string } }>("/register", {
      method: "POST",
      body: { ...account, role: "admin" },
    });

    if (res.status === 200) {
      expect(res.data.user?.role).not.toBe("admin");
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe("profile", () => {
  test("a user can update their own name and phone", async ({ api }) => {
    const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);

    const res = await api.updateProfile(driver.token, {
      name: USERS.driver.name,
      email: USERS.driver.email,
      phone: "+91 98400 11223",
    });

    expect(res.status).toBe(200);
    expect(res.data.user.phone).toBe("+91 98400 11223");
  });

  test("cannot take an email that already belongs to someone else", async ({ api }) => {
    const driver = await api.loginOrThrow(USERS.driver.email, USERS.driver.password);
    const res = await api.updateProfile(driver.token, {
      name: "X",
      email: USERS.admin.email,
    });
    expect(res.status).toBe(409);
  });
});

test.describe("POST /api/password-reset", () => {
  test("responds identically for known and unknown addresses", async ({ api }) => {
    const known = await api.requestPasswordReset(USERS.driver.email);
    const unknown = await api.requestPasswordReset("nobody@parkspace.test");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    /* Same shape, so the response cannot be used to enumerate accounts. */
    expect(Object.keys(unknown.data).sort()).toEqual(Object.keys(known.data).sort());
  });
});

test.describe("demo endpoints", () => {
  /* Gated by DEMO_MODE, which playwright.config.ts sets true for the
     local webServer. The production suite asserts the opposite for a
     deployed target — see specs/api/production.api.spec.ts. */

  test("there is no fake SSO endpoint, in any mode", async ({ api }) => {
    /* POST /api/demo-sso signed the seeded driver in for whoever tapped
       the Google or Apple button, regardless of credentials. It has been
       removed rather than gated: Google and Apple now run the real
       Authorization Code + PKCE flow. */
    const res = await api.call("/demo-sso", {
      method: "POST",
      body: { provider: "google" },
    });
    expect(res.status).toBe(404);
  });

  test("the demo-accounts endpoint still backs the seed, but nothing reads it in the UI", async ({
    api,
  }) => {
    /* Kept deliberately: the sign-in screen no longer calls this (the
       credential panel was removed), but the production suite asserts it
       is 404 on a public deployment, so the route must still exist. */
    const res = await api.demoAccounts();
    expect(res.status).toBe(200);
    expect(res.data.accounts.length).toBe(3);
  });
});

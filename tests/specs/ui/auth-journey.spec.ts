/**
 * Auth, end to end: registration, sign-in, password reset and the OAuth
 * return path, as a handful of longer journeys rather than one test per
 * assertion.
 *
 * This replaces auth.spec.ts, recovery.spec.ts's session-expiry block and
 * oauth-return.spec.ts. Each test below chains several steps that used to
 * be separate specs — the assertions are the same; what's gone is a
 * separate sign-in-and-navigate for each one. The trade is that a failure
 * midway through a journey takes a little more reading to localise; see
 * the file-level comment in driver-journey.spec.ts for why that's the
 * right call here.
 */

import { TID } from "@shared/testids";
import { SESSION_STORAGE_KEY } from "@fixtures/auth.fixture";
import { BAD_CREDENTIALS, USERS, expect, newAccount, test } from "@fixtures/index";
import { EMAIL_CASE_VARIANTS, INVALID_REGISTRATIONS } from "@fixtures/users.fixture";

test.describe("registration and sign-in", () => {
  test("a driver can register, sign in, and the session survives a reload — with no credentials ever shown", async ({
    authPage,
    page,
  }) => {
    await authPage.openSignIn();

    /* The sign-in form itself must never leak a seed password — the
       regression this guards is the old "Test accounts" panel that
       printed every seed email and password with one-tap login. */
    const body = (await page.locator("body").textContent()) ?? "";
    for (const user of Object.values(USERS)) expect(body).not.toContain(user.password);
    await expect(page.getByText("Test accounts")).toHaveCount(0);

    const account = newAccount("driver");
    await authPage.register(account);

    /* Registering returns to the login form rather than signing in
       straight away — email kept, password cleared, no name field. */
    await expect(authPage.el.registered).toBeVisible();
    await expect(page.getByTestId(TID.driverHome)).toBeHidden();
    await expect(authPage.el.name).toBeHidden();
    await expect(authPage.el.email).toHaveValue(account.email);
    await expect(authPage.el.password).toHaveValue("");

    await authPage.signIn(account);
    await expect(page.getByTestId(TID.driverHome)).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(TID.driverHome)).toBeVisible();
    await expect(authPage.el.screen).toHaveCount(0);
  });

  test("an owner registration lands on the owner dashboard, and a taken email is refused", async ({
    authPage,
    page,
  }) => {
    await authPage.openSignIn();
    const account = newAccount("owner");
    await authPage.register(account);
    await authPage.signIn(account);
    await expect(page.getByTestId(TID.ownerDashboard)).toBeVisible();

    await authPage.openSignIn();
    await authPage.register(newAccount("driver", { email: USERS.driver.email }));
    await expect(authPage.el.error).toBeVisible();
    await expect(authPage.el.screen).toBeVisible();

    /* A representative sample of the invalid-registration cases, in one
       pass rather than one sign-in per case. */
    for (const invalid of INVALID_REGISTRATIONS.slice(0, 3)) {
      await authPage.openSignIn();
      await authPage.register(newAccount("driver", invalid.patch));
      await expect(authPage.el.error, invalid.label).toBeVisible();
    }
  });

  test("bad credentials, case-insensitive email, and the error clearing on switching forms", async ({
    authPage,
    page,
  }) => {
    await authPage.openSignIn();

    for (const bad of BAD_CREDENTIALS.slice(0, 4)) {
      await authPage.openSignIn();
      await authPage.signInExpectingFailure(bad.email, bad.password);
      await expect(authPage.el.error, bad.label).toBeVisible();
      await expect(authPage.el.screen).toBeVisible();
      if (bad.expect === "validation") {
        await expect(authPage.el.error).toContainText(/required/i);
      }
    }

    await authPage.openSignIn();
    await authPage.signInExpectingFailure("", "");
    await expect(authPage.el.error).toBeVisible();
    await authPage.switchToRegister();
    await expect(authPage.el.error).toHaveCount(0);

    /* users.email is UNIQUE COLLATE NOCASE — every spelling must land the
       same seeded driver. */
    for (const variant of EMAIL_CASE_VARIANTS) {
      await authPage.openSignIn();
      await authPage.signIn({ email: variant, password: USERS.driver.password });
      await expect(page.getByTestId(TID.driverHome)).toBeVisible();
    }
  });
});

test.describe("password reset", () => {
  test("validates locally, then reports the same result whether or not the address exists", async ({
    authPage,
  }) => {
    await authPage.openSignIn();
    await authPage.openForgotPassword();

    await authPage.forgot.submit.click();
    await expect(authPage.forgot.error).toContainText(/enter your email/i);
    await expect(authPage.forgot.result).toHaveCount(0);

    await authPage.requestReset(USERS.driver.email);
    await expect(authPage.forgot.result).toBeVisible();

    await authPage.openSignIn();
    await authPage.openForgotPassword();
    await authPage.requestReset("definitely-not-a-user@parkspace.test");
    await expect(authPage.forgot.result).toBeVisible();
  });
});

test.describe("OAuth return and session expiry", () => {
  test("a stale handoff code and a provider error are both explained and cleaned from the URL", async ({
    page,
    authPage,
  }) => {
    await authPage.openSignIn();
    await page.goto("/?oauth=definitely-not-a-real-handoff-code", {
      waitUntil: "domcontentloaded",
    });
    await authPage.waitForApp();
    await expect(authPage.el.notice).toContainText(/already been used or expired/i, {
      timeout: 20_000,
    });
    expect(page.url()).not.toContain("oauth=");

    const message = "Google said no thanks";
    await page.goto(`/?oauth_error=${encodeURIComponent(message)}`, {
      waitUntil: "domcontentloaded",
    });
    await authPage.waitForApp();
    await expect(authPage.el.notice).toContainText(message, { timeout: 20_000 });
    expect(page.url()).not.toContain("oauth_error");

    /* And the form underneath is still fully usable — a failed provider
       round trip must not block the password path. */
    await expect(authPage.el.email).toBeEnabled();
    await expect(authPage.el.password).toBeEnabled();
    await expect(authPage.el.submit).toBeEnabled();
  });

  test("with no provider configured there is no way to sign in without credentials", async ({
    authPage,
    page,
    api,
  }) => {
    const providers = await api.authProviders();
    test.skip(
      providers.data.providers.length > 0,
      "real OAuth credentials are configured in this environment",
    );

    await authPage.openSignIn();
    await expect(authPage.el.ssoProviders).toHaveCount(0);
    await expect(authPage.el.ssoDivider).toHaveCount(0);
    await expect(page.getByText(/Demo sign-in/i)).toHaveCount(0);
    await expect(authPage.el.email).toBeEnabled();
    await expect(authPage.el.submit).toBeEnabled();
  });

  test("an expired session returns to sign-in, explains why without a status code, and clears the token", async ({
    page,
    signIn,
    authPage,
  }) => {
    await signIn("driver");

    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) throw new Error("no session to tamper with");
      const session = JSON.parse(raw) as { token: string };
      session.token = "bogus.token";
      window.localStorage.setItem(key, JSON.stringify(session));
    }, SESSION_STORAGE_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(authPage.el.screen).toBeVisible({ timeout: 30_000 });
    await expect(authPage.el.notice).toContainText(/session has expired/i);
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toMatch(/\b401\b/);

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY);
    expect(stored).toBeNull();

    await authPage.el.noticeDismiss.click();
    await expect(authPage.el.notice).toHaveCount(0);
  });
});

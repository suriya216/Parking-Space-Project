/**
 * How the app handles an OAuth round trip coming back in the URL —
 * ports the browser half of e2e/oauth.test.mjs.
 *
 * These run against the ordinary dev pair; the protocol itself is
 * covered in specs/api/oauth.api.spec.ts against a fake provider.
 */

import { TID } from "@shared/testids";
import { expect, test } from "@fixtures/index";

test.describe("returning from a provider", () => {
  test("a stale or unknown handoff code is explained, not swallowed", async ({
    page,
    authPage,
  }) => {
    await authPage.openSignIn();

    /* A code this server never issued — the same shape a user would hit
       by reloading a stale callback URL. */
    await page.goto("/?oauth=definitely-not-a-real-handoff-code", {
      waitUntil: "domcontentloaded",
    });
    await authPage.waitForApp();

    await expect(authPage.el.notice).toContainText(/already been used or expired/i, {
      timeout: 20_000,
    });

    /* And the spent code must be stripped, so a reload doesn't retry it
       and re-show the error forever. */
    expect(page.url()).not.toContain("oauth=");
  });

  test("a provider error message is displayed and then cleared from the URL", async ({
    page,
    authPage,
  }) => {
    const message = "Google said no thanks";
    await page.goto(`/?oauth_error=${encodeURIComponent(message)}`, {
      waitUntil: "domcontentloaded",
    });
    await authPage.waitForApp();

    await expect(authPage.el.notice).toContainText(message, { timeout: 20_000 });
    expect(page.url()).not.toContain("oauth_error");
  });

  test("the sign-in screen is still usable after a failed round trip", async ({
    page,
    authPage,
  }) => {
    await page.goto("/?oauth_error=Something%20went%20wrong", {
      waitUntil: "domcontentloaded",
    });
    await authPage.waitForApp();
    await expect(authPage.el.notice).toBeVisible({ timeout: 20_000 });

    /* The form must not be blocked by the notice — a failed provider
       sign-in has to leave a working password path. */
    await expect(authPage.el.email).toBeEnabled();
    await expect(authPage.el.password).toBeEnabled();
    await expect(authPage.el.submit).toBeEnabled();
  });

  test("with no provider configured there is no social sign-in at all", async ({
    authPage,
    page,
    api,
  }) => {
    /* The regression this locks down: the screen used to offer Google and
       Apple buttons that hit /api/demo-sso and signed the seeded driver
       in for anybody, credentials or not. With nothing configured the
       whole block — divider included — must simply be absent. */
    const providers = await api.authProviders();
    test.skip(
      providers.data.providers.length > 0,
      "real OAuth credentials are configured in this environment",
    );

    await authPage.openSignIn();

    await expect(authPage.el.ssoProviders).toHaveCount(0);
    await expect(authPage.el.ssoDivider).toHaveCount(0);
    await expect(page.getByText(/Demo sign-in/i)).toHaveCount(0);

    /* Password entry is still fully available. */
    await expect(authPage.el.email).toBeEnabled();
    await expect(authPage.el.password).toBeEnabled();
    await expect(authPage.el.submit).toBeEnabled();
  });

  test("no button on the sign-in screen can authenticate without credentials", async ({
    authPage,
    page,
  }) => {
    await authPage.openSignIn();

    /* Click every button except the ones that legitimately open something,
       and assert none of them signs anybody in. */
    const buttons = page.locator("button");
    const count = await buttons.count();

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const label = ((await button.textContent()) ?? "").trim();
      if (/forgot password/i.test(label)) continue; // opens a sheet
      if (/sign in|create account/i.test(label)) continue; // needs input

      await button.click({ trial: true }).catch(() => {});
    }

    await expect(authPage.el.screen).toBeVisible();
    await expect(page.getByTestId(TID.driverHome)).toHaveCount(0);
  });
});

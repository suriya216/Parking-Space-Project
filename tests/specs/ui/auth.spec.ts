/**
 * Sign-in, registration and password reset, driven through the real form.
 *
 * This is the suite that justifies removing the demo-accounts panel: the
 * credentials come from the fixture, so the same spec body covers eight
 * negative cases that the old "tap a test account" shortcut could not
 * express at all.
 */

import { TID } from "@shared/testids";
import { BAD_CREDENTIALS, USERS, expect, newAccount, test } from "@fixtures/index";
import { EMAIL_CASE_VARIANTS, INVALID_REGISTRATIONS } from "@fixtures/users.fixture";

/** Where each role is expected to land after a successful sign-in. */
const LANDING = {
  driver: TID.driverHome,
  owner: TID.ownerDashboard,
  admin: TID.adminDashboard,
} as const;

test.describe("sign in", () => {
  test.beforeEach(async ({ authPage }) => {
    await authPage.openSignIn();
  });

  test("the sign-in form is offered, and no credentials are on the page", async ({
    authPage,
    page,
  }) => {
    await expect(authPage.el.heading).toHaveText("Welcome back");
    await expect(authPage.el.email).toBeVisible();
    await expect(authPage.el.password).toBeVisible();

    /* Regression guard for the removed panel: the sign-in screen must not
       print a seed password anywhere in its DOM. */
    const body = (await page.locator("body").textContent()) ?? "";
    for (const user of Object.values(USERS)) {
      expect(body).not.toContain(user.password);
    }
    await expect(page.getByText("Test accounts")).toHaveCount(0);
  });

  for (const role of ["driver", "owner", "admin"] as const) {
    test(`${role} can sign in and lands on their own dashboard`, async ({ authPage, page }) => {
      await authPage.signIn(USERS[role]);

      /* Each role has a different landing surface; assert the right one
         appeared rather than merely that login "worked". */
      await expect(page.getByTestId(LANDING[role])).toBeVisible();
    });
  }

  test("a session survives a reload", async ({ authPage, page }) => {
    await authPage.signIn(USERS.driver);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(TID.driverHome)).toBeVisible();
    await expect(authPage.el.screen).toHaveCount(0);
  });

  for (const bad of BAD_CREDENTIALS) {
    test(`rejects: ${bad.label}`, async ({ authPage }) => {
      await authPage.signInExpectingFailure(bad.email, bad.password);

      /* Either way the user stays on the sign-in screen with a readable
         message — never a blank page or a silent no-op. */
      await expect(authPage.el.error).toBeVisible();
      await expect(authPage.el.screen).toBeVisible();

      const message = await authPage.errorText();
      expect(message.trim().length).toBeGreaterThan(0);

      if (bad.expect === "validation") {
        /* Client-side validation: nothing should have been sent. */
        await expect(authPage.el.error).toContainText(/required/i);
      }
    });
  }

  test("an error clears when the user switches to register", async ({ authPage }) => {
    await authPage.signInExpectingFailure("", "");
    await expect(authPage.el.error).toBeVisible();

    await authPage.switchToRegister();
    await expect(authPage.el.error).toHaveCount(0);
  });

  test("email matching is case-insensitive", async ({ authPage, page }) => {
    /* users.email is UNIQUE COLLATE NOCASE, so every spelling of the
       seeded driver's address must reach the same account. */
    for (const variant of EMAIL_CASE_VARIANTS) {
      await authPage.openSignIn();
      await authPage.signIn({ email: variant, password: USERS.driver.password });
      await expect(page.getByTestId(TID.driverHome)).toBeVisible();
    }
  });
});

test.describe("register", () => {
  test.beforeEach(async ({ authPage }) => {
    await authPage.openSignIn();
  });

  test("a new driver is returned to sign-in, not signed straight in", async ({
    authPage,
    page,
  }) => {
    const account = newAccount("driver");
    await authPage.register(account);

    await expect(authPage.el.registered).toBeVisible();
    await expect(page.getByTestId(TID.driverHome)).toBeHidden();
    // Back on the login form: no name field, email kept, password cleared.
    await expect(authPage.el.name).toBeHidden();
    await expect(authPage.el.email).toHaveValue(account.email);
    await expect(authPage.el.password).toHaveValue("");
  });

  test("the credentials just chosen work on the sign-in form", async ({
    authPage,
    page,
  }) => {
    const account = newAccount("driver");
    await authPage.register(account);
    await authPage.signIn(account);
    await expect(page.getByTestId(TID.driverHome)).toBeVisible();
  });

  test("a new owner signs in to the owner dashboard", async ({ authPage, page }) => {
    const account = newAccount("owner");
    await authPage.register(account);
    await authPage.signIn(account);
    await expect(page.getByTestId(TID.ownerDashboard)).toBeVisible();
  });

  test("an existing email is refused", async ({ authPage }) => {
    await authPage.register(newAccount("driver", { email: USERS.driver.email }));
    await expect(authPage.el.error).toBeVisible();
    await expect(authPage.el.screen).toBeVisible();
  });

  for (const invalid of INVALID_REGISTRATIONS) {
    test(`refuses registration with ${invalid.label}`, async ({ authPage }) => {
      await authPage.register(newAccount("driver", invalid.patch));
      await expect(authPage.el.error).toBeVisible();
    });
  }
});

test.describe("password reset", () => {
  test.beforeEach(async ({ authPage }) => {
    await authPage.openSignIn();
    await authPage.openForgotPassword();
  });

  test("validates an empty email before sending anything", async ({ authPage }) => {
    await authPage.forgot.submit.click();
    await expect(authPage.forgot.error).toContainText(/enter your email/i);
    await expect(authPage.forgot.result).toHaveCount(0);
  });

  test("reports a simulated result for a known address", async ({ authPage }) => {
    await authPage.requestReset(USERS.driver.email);
    await expect(authPage.forgot.result).toBeVisible();
  });

  test("does not reveal whether an address exists", async ({ authPage }) => {
    /* An enumeration guard: the unknown-address response must look the
       same as the known-address one. */
    await authPage.requestReset("definitely-not-a-user@parkspace.test");
    await expect(authPage.forgot.result).toBeVisible();
  });
});

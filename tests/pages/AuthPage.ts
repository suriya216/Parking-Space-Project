import type { Page } from "@playwright/test";

import { authLocators, forgotPasswordLocators } from "@locators/auth.locators";
import type { NewAccount, TestUser } from "@fixtures/users.fixture";

import { BasePage } from "./BasePage";

/**
 * Sign-in, registration and password-reset screen.
 *
 * Every login in the suite goes through `signIn` — filling the form and
 * submitting, the way a user does. The previous suites clicked a
 * quick-login button that only existed because the page printed the test
 * credentials on screen, so they were never actually exercising the
 * login form at all.
 */
export class AuthPage extends BasePage {
  readonly el: ReturnType<typeof authLocators>;
  readonly forgot: ReturnType<typeof forgotPasswordLocators>;

  constructor(page: Page) {
    super(page);
    this.el = authLocators(page);
    this.forgot = forgotPasswordLocators(page);
  }

  async openSignIn(): Promise<void> {
    await this.resetSession();
    await this.el.screen.waitFor({ state: "visible" });
  }

  /** Fill the credentials without submitting — for validation specs. */
  async fillCredentials(email: string, password: string): Promise<void> {
    await this.el.email.fill(email);
    await this.el.password.fill(password);
  }

  async submit(): Promise<void> {
    await this.el.submit.click();
  }

  /**
   * Sign in and wait for the auth screen to go away.
   *
   * Does not assert which dashboard appeared — the role landing is the
   * caller's concern, and asserting it here would hide it from the spec.
   */
  async signIn(user: Pick<TestUser, "email" | "password">): Promise<void> {
    await this.fillCredentials(user.email, user.password);
    await this.submit();
    await this.el.screen.waitFor({ state: "detached" });
  }

  /** Attempt a sign-in that is expected to fail; leaves the form up. */
  async signInExpectingFailure(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submit();
  }

  async switchToRegister(): Promise<void> {
    await this.el.switchToRegister.click();
    await this.el.name.waitFor({ state: "visible" });
  }

  async switchToLogin(): Promise<void> {
    await this.el.switchToLogin.click();
    await this.el.name.waitFor({ state: "detached" });
  }

  async register(account: NewAccount): Promise<void> {
    await this.switchToRegister();
    if (account.role === "owner") {
      await this.el.roleOwner.click();
    } else {
      await this.el.roleDriver.click();
    }
    await this.el.name.fill(account.name);
    await this.el.email.fill(account.email);
    await this.el.password.fill(account.password);
    await this.submit();
    /* Registering returns to the sign-in form, which clears the password
       field as it switches mode. Wait for that to land: a caller that
       starts typing credentials first would have them wiped mid-fill.
       Registrations the server rejects leave the form up, so this only
       waits for whichever of the two outcomes arrives. */
    await this.el.registered.or(this.el.error).first().waitFor({ state: "visible" });
  }

  /** Fill a registration form without submitting — for validation specs. */
  async fillRegistration(account: NewAccount): Promise<void> {
    await this.switchToRegister();
    await this.el.name.fill(account.name);
    await this.el.email.fill(account.email);
    await this.el.password.fill(account.password);
  }

  async openForgotPassword(): Promise<void> {
    await this.el.forgotLink.click();
    await this.forgot.sheet.waitFor({ state: "visible" });
  }

  async requestReset(email: string): Promise<void> {
    await this.forgot.email.fill(email);
    await this.forgot.submit.click();
  }

  /**
   * Start a real provider round trip.
   *
   * This navigates away to the provider, so it does NOT wait for the app
   * to change — the caller decides what to assert about where it lands.
   * (`signInWithDemoSso` used to live here and completed instantly
   * because nothing left the page; that shortcut is gone.)
   */
  async startProviderSignIn(label: string): Promise<void> {
    await this.el.ssoProvider(label).click();
  }

  async errorText(): Promise<string> {
    return (await this.el.error.textContent()) ?? "";
  }
}

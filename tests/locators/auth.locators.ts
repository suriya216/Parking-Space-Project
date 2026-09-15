/**
 * Sign-in / register / forgot-password locators.
 *
 * Note what is NOT here any more: the old suites located the login path
 * via `getByRole("button", { name: /driver.*driver@parkspace\.test/is })`
 * — i.e. by matching the credentials printed on screen. That panel is
 * gone, so authentication now goes through the form like a user's would.
 */

import type { Page } from "@playwright/test";

import { TID } from "@shared/testids";

export const authLocators = (page: Page) => ({
  screen: page.getByTestId(TID.authScreen),
  heading: page.getByTestId(TID.authHeading),

  email: page.getByTestId(TID.authEmail),
  password: page.getByTestId(TID.authPassword),
  name: page.getByTestId(TID.authName),
  submit: page.getByTestId(TID.authSubmit),
  error: page.getByTestId(TID.authError),
  registered: page.getByTestId(TID.authRegistered),

  notice: page.getByTestId(TID.authNotice),
  noticeDismiss: page.getByTestId(TID.authNoticeDismiss),

  forgotLink: page.getByTestId(TID.authForgot),
  switchToRegister: page.getByTestId(TID.authSwitchToRegister),
  switchToLogin: page.getByTestId(TID.authSwitchToLogin),

  roleDriver: page.getByTestId(TID.authRoleDriver),
  roleOwner: page.getByTestId(TID.authRoleOwner),

  /* The whole social block is absent unless the server holds real
     credentials for at least one provider — divider included. */
  ssoDivider: page.getByTestId(TID.authSsoDivider),
  ssoProviders: page.getByTestId(TID.authSsoProvider),
  ssoProvider: (label: string) =>
    page.getByTestId(TID.authSsoProvider).filter({ hasText: new RegExp(label, "i") }),
});

export const forgotPasswordLocators = (page: Page) => ({
  sheet: page.getByTestId(TID.forgotSheet),
  email: page.getByTestId(TID.forgotEmail),
  submit: page.getByTestId(TID.forgotSubmit),
  result: page.getByTestId(TID.forgotResult),
  error: page.getByTestId(TID.forgotError),
});

export type AuthLocators = ReturnType<typeof authLocators>;
export type ForgotPasswordLocators = ReturnType<typeof forgotPasswordLocators>;

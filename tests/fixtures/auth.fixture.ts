/**
 * Authentication helpers for fixtures.
 *
 * Most specs care about what a signed-in user can do, not about the act
 * of signing in. Those get a session injected straight into localStorage
 * after an API login — a few hundred milliseconds instead of a full form
 * round trip per test, and no dependency on the login UI staying put.
 *
 * The specs that ARE about signing in (tests/specs/ui/auth.spec.ts) drive
 * the real form through AuthPage instead. Both paths matter; conflating
 * them is how a suite ends up with 40 tests that all fail when one label
 * on the login screen changes.
 */

import type { Page } from "@playwright/test";

import type { Session } from "@shared/models";

import type { ApiClient } from "./api.fixture";
import { USERS, type UserKey } from "./users.fixture";

/** Must match SESSION_KEY in src/api — where the client persists it. */
export const SESSION_STORAGE_KEY = "parkspace.session";

/**
 * Put a session into the page's localStorage and load the app with it.
 *
 * The origin has to be loaded before localStorage is writable, hence the
 * goto-then-set-then-reload dance.
 */
export const injectSession = async (page: Page, session: Session): Promise<void> => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [SESSION_STORAGE_KEY, JSON.stringify(session)],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const root = document.getElementById("root");
    return Boolean(root && root.childElementCount > 0);
  });
};

/** API-login as a seeded role and hand the page that session. */
export const signInAs = async (
  page: Page,
  api: ApiClient,
  role: UserKey,
): Promise<Session> => {
  const user = USERS[role];
  const session = await api.loginOrThrow(user.email, user.password);
  await injectSession(page, session);
  return session;
};

/** Leave the app signed out, clearing anything a previous test left. */
export const signOutCompletely = async (page: Page): Promise<void> => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
};

/**
 * Registers one real account through the form, then signs in as it.
 *
 * MANUAL ONLY: this lives in the `manual` project, which exists only when
 * MANUAL=1, so `npx playwright test` and the CI pipeline never run it.
 * Use `npm run test:register`.
 *
 * It writes to whichever API is on the API port. With `npm run dev`
 * running that is the dev database, so the account persists.
 *
 *   REG_EMAIL     required
 *   REG_PASSWORD  required (never committed)
 *   REG_NAME      optional, default "Manual User"
 *   REG_ROLE      optional, "driver" (default) or "owner"
 */

import { TID } from "@shared/testids";
import { expect, test } from "@fixtures/index";

const email = process.env.REG_EMAIL;
const password = process.env.REG_PASSWORD;
const role = process.env.REG_ROLE === "owner" ? "owner" : "driver";
const name = process.env.REG_NAME ?? "Manual User";

test("register a new user, then sign in as them", async ({ authPage, page }) => {
  test.skip(!email || !password, "Set REG_EMAIL and REG_PASSWORD (use npm run test:register).");

  await authPage.openSignIn();
  await authPage.register({ name, email: email!, password: password!, role });

  /* A rejected registration (e.g. the address is already in use) leaves
     the form up with an error; surface it rather than a vague timeout. */
  await expect(authPage.el.error).toHaveCount(0);
  await expect(authPage.el.registered).toBeVisible();

  await authPage.signIn({ email: email!, password: password! });
  await expect(
    page.getByTestId(role === "owner" ? TID.ownerDashboard : TID.driverHome),
  ).toBeVisible();
});

/**
 * Test accounts — the replacement for the "Test accounts" panel that used
 * to be rendered into the sign-in screen.
 *
 * These mirror SEED_USERS in server/db.js. They are deliberately the only
 * place in the repo that knows a test password, so a seed change is a
 * one-line edit here instead of a hunt through nine suites.
 *
 * The old panel gave the tests exactly three logins (whatever the seed
 * happened to contain) and only by clicking a button that had to be
 * visible on screen. Moving them here buys the "extensive testing" cases
 * a visible panel could never express: wrong passwords, unknown accounts,
 * malformed input, case variations, registration payloads.
 */

import type { Role } from "@shared/models";

export interface TestUser {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: Role;
}

/** The seeded accounts, keyed by role. Must match server/db.js SEED_USERS. */
export const USERS = {
  admin: {
    name: "Admin User",
    email: "admin@parkspace.test",
    password: "Admin@123",
    role: "admin",
  },
  owner: {
    name: "Lakshmi S.",
    email: "owner@parkspace.test",
    password: "Owner@123",
    role: "owner",
  },
  driver: {
    name: "Rajesh Kumar",
    email: "driver@parkspace.test",
    password: "Driver@123",
    role: "driver",
  },
} as const satisfies Record<Role, TestUser>;

export type UserKey = keyof typeof USERS;

export const ALL_USER_KEYS = Object.keys(USERS) as UserKey[];

export const userFor = (key: UserKey): TestUser => USERS[key];

/* ─── negative-path credentials ────────────────────────────
   The cases the old UI panel could not represent at all. Each carries
   the reason it should fail, so a spec failure names the intent. */

export interface BadCredential {
  readonly label: string;
  readonly email: string;
  readonly password: string;
  /** Expected user-facing outcome. */
  readonly expect: "invalid" | "validation";
}

export const BAD_CREDENTIALS: readonly BadCredential[] = [
  {
    label: "correct email, wrong password",
    email: USERS.driver.email,
    password: "NotThePassword1!",
    expect: "invalid",
  },
  {
    label: "unknown email",
    email: "nobody@parkspace.test",
    password: USERS.driver.password,
    expect: "invalid",
  },
  {
    label: "password of a different seeded user",
    email: USERS.driver.email,
    password: USERS.admin.password,
    expect: "invalid",
  },
  {
    label: "empty email",
    email: "",
    password: USERS.driver.password,
    expect: "validation",
  },
  {
    label: "empty password",
    email: USERS.driver.email,
    password: "",
    expect: "validation",
  },
  {
    label: "both fields empty",
    email: "",
    password: "",
    expect: "validation",
  },
  {
    label: "email with surrounding whitespace",
    email: `  ${USERS.driver.email}  `,
    password: USERS.driver.password,
    expect: "invalid",
  },
  {
    label: "password differing only in case",
    email: USERS.driver.email,
    password: USERS.driver.password.toLowerCase(),
    expect: "invalid",
  },
];

/**
 * Emails are UNIQUE COLLATE NOCASE in the schema, so these must all
 * resolve to the same seeded driver.
 */
export const EMAIL_CASE_VARIANTS: readonly string[] = [
  USERS.driver.email,
  USERS.driver.email.toUpperCase(),
  "Driver@ParkSpace.Test",
];

/* ─── registration payloads ────────────────────────────────
   Unique emails per run so a re-run cannot collide with the UNIQUE
   constraint on users.email. */

export interface NewAccount {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: Extract<Role, "driver" | "owner">;
}

let registrationCounter = 0;

/**
 * A fresh, never-before-seen account. `role` is limited to the two the
 * register form actually offers — admin is not self-serve.
 *
 * The id has three parts and needs all of them. A timestamp plus a
 * counter is NOT enough: Playwright runs each worker as its own process,
 * so the counter restarts at 1 in every worker and two workers hitting
 * the same millisecond generate byte-identical emails. `users.email` is
 * UNIQUE, so the loser gets a 409 and the spec then reads `.email` off
 * an undefined user. Hence the pid and the random block.
 */
export const newAccount = (
  role: NewAccount["role"] = "driver",
  overrides: Partial<NewAccount> = {},
): NewAccount => {
  registrationCounter += 1;
  const stamp = [
    Date.now().toString(36),
    process.pid.toString(36),
    Math.random().toString(36).slice(2, 8),
    registrationCounter,
  ].join("");

  return {
    name: `E2E ${role} ${stamp}`,
    email: `e2e-${role}-${stamp}@parkspace.test`,
    password: "E2ePass@123",
    role,
    ...overrides,
  };
};

/** Registration inputs the form must reject before sending anything. */
export const INVALID_REGISTRATIONS: readonly {
  readonly label: string;
  readonly patch: Partial<NewAccount>;
}[] = [
  { label: "missing name", patch: { name: "" } },
  { label: "missing email", patch: { email: "" } },
  { label: "missing password", patch: { password: "" } },
];

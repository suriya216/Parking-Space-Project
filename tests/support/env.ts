/**
 * Environment resolution for the suite.
 *
 * Kept tiny and dependency-free so playwright.config.ts can import it
 * without pulling in fixtures or page objects.
 */

export const IS_CI = Boolean(process.env.CI);

export const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
export const API_PORT = Number(process.env.API_PORT ?? 3001);

/**
 * The app's own origin. Vite proxies /api/* here to the Express server
 * (see vite.config.js), which is why UI tests only ever need this one.
 */
export const BASE_URL = process.env.BASE_URL ?? `http://localhost:${WEB_PORT}`;

/**
 * The API suites talk to Express directly rather than through the Vite
 * proxy — one less moving part between the assertion and the handler.
 */
export const API_URL = process.env.API_URL ?? `http://localhost:${API_PORT}`;

/** Prefix for API paths. Express mounts everything under /api. */
export const API_PREFIX = "/api";

/**
 * True when pointed at a deployed environment rather than a local dev
 * pair. Specs that mutate or delete data guard on this.
 */
export const IS_REMOTE_TARGET = Boolean(process.env.BASE_URL || process.env.API_URL);

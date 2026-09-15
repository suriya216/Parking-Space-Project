/**
 * Boots the server exactly as production does, for the production specs.
 *
 * Ported from e2e/production.test.mjs: NODE_ENV=production, a real
 * SESSION_SECRET, DEMO_MODE off, and the built dist/ served from the same
 * origin. The specs then attack it — forged tokens, tampered signatures,
 * the demo endpoints, the security headers.
 *
 * Its own port and DATA_DIR, so nothing here touches the dev database.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export const PROD_PORT = 4700;
export const PROD_DATA_DIR = join("server", "prod-test-data");

/** The production suite asserts on the built bundle, so dist/ must exist. */
export const distIsBuilt = (): boolean => existsSync(join("dist", "index.html"));

export interface ProdEnvironment {
  base: string;
  /** The secret the server was started with, for signing test tokens. */
  secret: string;
  request: (
    path: string,
    opts?: {
      method?: string;
      body?: unknown;
      token?: string;
      redirect?: RequestRedirect;
    },
  ) => Promise<Response>;
  json: <T>(
    path: string,
    opts?: { method?: string; body?: unknown; token?: string },
  ) => Promise<{ status: number; headers: Headers; data: T }>;
  stop: () => void;
}

export const startProdServer = async (): Promise<ProdEnvironment> => {
  const secret = randomBytes(48).toString("base64url");
  rmSync(PROD_DATA_DIR, { recursive: true, force: true });

  const server: ChildProcess = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PROD_PORT),
      DATA_DIR: PROD_DATA_DIR,
      SESSION_SECRET: secret,
      DEMO_MODE: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const log: string[] = [];
  server.stdout?.on("data", (d) => log.push(String(d)));
  server.stderr?.on("data", (d) => log.push(String(d)));

  /* 127.0.0.1 rather than localhost: on Windows the latter can resolve to
     ::1 first and miss a server bound to IPv4. */
  const base = `http://127.0.0.1:${PROD_PORT}`;

  const request: ProdEnvironment["request"] = (path, opts = {}) =>
    fetch(base + path, {
      method: opts.method ?? "GET",
      redirect: opts.redirect ?? "follow",
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

  const ready = await (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if ((await request("/api/health")).ok) return true;
      } catch {
        /* still starting */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })();

  if (!ready) {
    server.kill();
    throw new Error(
      `production server never became ready. Log tail:\n${log.join("").slice(-800)}`,
    );
  }

  return {
    base,
    secret,
    request,
    json: async <T>(path: string, opts = {}) => {
      const res = await request(path, opts);
      let data: unknown = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      return { status: res.status, headers: res.headers, data: data as T };
    },
    stop: () => server.kill(),
  };
};

/**
 * Start the server with a deliberately bad config and report how it died.
 * Used to prove an insecure secret is fatal rather than silently
 * tolerated.
 */
export const startWithSecret = (
  port: number,
  sessionSecret: string,
): Promise<{ code: number | null; output: string }> => {
  const child = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: PROD_DATA_DIR,
      SESSION_SECRET: sessionSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (d) => {
    output += d;
  });
  child.stderr?.on("data", (d) => {
    output += d;
  });

  return new Promise((resolve) => {
    child.on("exit", (code) => resolve({ code, output }));
  });
};

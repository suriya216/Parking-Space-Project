/**
 * Fake OIDC provider plus a dedicated app server, for the OAuth specs.
 *
 * Ported from the harness inside e2e/oauth.test.mjs. This is NOT a mock
 * of our own code: it stands up an HTTP server that behaves like Google's
 * authorize/token/userinfo endpoints, points a real app server at it via
 * the *_URL env overrides, and lets the specs drive the whole handshake.
 * Everything except the identity provider is the production path — state,
 * PKCE, token exchange, user upsert, handoff.
 *
 * It runs on its own ports and its own database file because the linking
 * assertions depend on whether a provider identity has been seen before;
 * sharing the main dev database would make them pass or fail according to
 * run order.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";

export const IDP_PORT = 4599;
export const OAUTH_API_PORT = 4600;
export const CLIENT_ID = "test-client-id";
export const CLIENT_SECRET = "test-client-secret";

/** Separate file so a rerun starts from a known-empty provider history. */
const TEST_DB = "server/oauth-test.db";

export interface IdpProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

const DEFAULT_PROFILE: IdpProfile = {
  sub: "fake-sub-12345",
  email: "oauth.tester@example.com",
  email_verified: true,
  name: "OAuth Tester",
  picture: "https://example.com/avatar.png",
};

interface IssuedCode {
  challenge: string | null;
  method: string | null;
  redirect_uri: string | null;
  clientId: string | null;
  scope: string | null;
}

export interface OauthEnvironment {
  apiBase: string;
  idpBase: string;
  /** Swap the profile /userinfo will return for the next sign-in. */
  setProfile: (profile: IdpProfile) => void;
  resetProfile: () => void;
  /** Every request the fake provider has served, as "METHOD /path". */
  idpLog: () => string[];
  stop: () => Promise<void>;
}

export const startOauthEnvironment = async (): Promise<OauthEnvironment> => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(TEST_DB + suffix, { force: true });
  }

  const issued = new Map<string, IssuedCode>();
  const log: string[] = [];
  let profile: IdpProfile = { ...DEFAULT_PROFILE };

  const idp: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${IDP_PORT}`);
    log.push(`${req.method} ${url.pathname}`);

    /* /authorize: a real provider would show a consent screen. Record the
       PKCE challenge and bounce straight back with a code. */
    if (url.pathname === "/authorize") {
      const q = url.searchParams;
      const code = `code-${Math.random().toString(36).slice(2)}`;
      issued.set(code, {
        challenge: q.get("code_challenge"),
        method: q.get("code_challenge_method"),
        redirect_uri: q.get("redirect_uri"),
        clientId: q.get("client_id"),
        scope: q.get("scope"),
      });
      const back = new URL(q.get("redirect_uri") ?? "http://localhost/");
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state") ?? "");
      res.writeHead(302, { Location: back.toString() }).end();
      return;
    }

    /* /token: verify the client secret and the PKCE verifier exactly as a
       real provider would, then issue an access token. */
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const code = params.get("code") ?? "";
        const entry = issued.get(code);
        const reply = (status: number, payload: unknown): void => {
          res
            .writeHead(status, { "Content-Type": "application/json" })
            .end(JSON.stringify(payload));
        };

        if (!entry) {
          reply(400, { error: "invalid_grant", error_description: "unknown code" });
          return;
        }
        issued.delete(code); // codes are single use

        if (
          params.get("client_id") !== CLIENT_ID ||
          params.get("client_secret") !== CLIENT_SECRET
        ) {
          reply(401, { error: "invalid_client" });
          return;
        }

        if (entry.challenge) {
          const verifier = params.get("code_verifier");
          if (!verifier) {
            reply(400, {
              error: "invalid_request",
              error_description: "missing code_verifier",
            });
            return;
          }
          const derived = createHash("sha256").update(verifier).digest("base64url");
          if (derived !== entry.challenge) {
            reply(400, {
              error: "invalid_grant",
              error_description: "PKCE verifier mismatch",
            });
            return;
          }
        }

        reply(200, {
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      });
      return;
    }

    if (url.pathname === "/userinfo") {
      if (req.headers.authorization !== "Bearer fake-access-token") {
        res.writeHead(401).end();
        return;
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(profile));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => idp.listen(IDP_PORT, resolve));

  /* The app server, pointed at the fake provider. APP_PUBLIC_URL is the
     normal Vite origin so the callback redirects somewhere a browser can
     actually load. */
  const api: ChildProcess = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: String(OAUTH_API_PORT),
      PARKSPACE_DB: TEST_DB,
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
      GOOGLE_AUTH_URL: `http://localhost:${IDP_PORT}/authorize`,
      GOOGLE_TOKEN_URL: `http://localhost:${IDP_PORT}/token`,
      GOOGLE_USERINFO_URL: `http://localhost:${IDP_PORT}/userinfo`,
      OAUTH_PUBLIC_URL: `http://localhost:${OAUTH_API_PORT}`,
      APP_PUBLIC_URL: "http://localhost:5173",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const serverLog: string[] = [];
  api.stdout?.on("data", (d) => serverLog.push(String(d)));
  api.stderr?.on("data", (d) => serverLog.push(String(d)));

  const apiBase = `http://localhost:${OAUTH_API_PORT}/api`;

  const ready = await (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const res = await fetch(`${apiBase}/health`);
        if (res.ok) return true;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })();

  if (!ready) {
    api.kill();
    idp.close();
    throw new Error(
      `OAuth app server never became ready. Log tail:\n${serverLog.join("").slice(-800)}`,
    );
  }

  return {
    apiBase,
    idpBase: `http://localhost:${IDP_PORT}`,
    setProfile: (next) => {
      profile = next;
    },
    resetProfile: () => {
      profile = { ...DEFAULT_PROFILE };
    },
    idpLog: () => [...log],
    stop: async () => {
      api.kill();
      await new Promise<void>((resolve) => idp.close(() => resolve()));
    },
  };
};

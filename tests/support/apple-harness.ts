/**
 * Fake Sign in with Apple, plus an app server pointed at it.
 *
 * Apple cannot be exercised with the Google harness: there is no userinfo
 * endpoint, the callback is a form POST, and the profile lives in an
 * RS256-signed `id_token` that the server verifies against a JWKS. So
 * this stands up all three — authorize, token, and /auth/keys — with a
 * real generated RSA keypair, and points the app at them.
 *
 * What that buys: the whole production path runs for real (client-secret
 * JWT minting, PKCE, form_post handling, signature verification, issuer
 * and audience checks) without an Apple Developer account. Only Apple's
 * own servers are substituted.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";

export const APPLE_IDP_PORT = 4610;
export const APPLE_API_PORT = 4611;

/** The Services ID the fake provider expects as client_id / aud. */
export const APPLE_CLIENT_ID = "com.example.parkspace.web";
export const APPLE_TEAM_ID = "TEAM123456";
export const APPLE_KEY_ID = "KEY1234567";
export const APPLE_KID = "test-apple-kid";

/** Apple's real issuer string — the server checks `iss` against it. */
export const APPLE_ISSUER = "https://appleid.apple.com";

const TEST_DB = "server/apple-test.db";

export interface AppleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  /** Override the issuer, to prove the server rejects a wrong one. */
  iss?: string;
  /** Override the audience, to prove the server rejects a wrong one. */
  aud?: string;
  /** Seconds since epoch; defaults to +1h. Set in the past to test expiry. */
  exp?: number;
}

const DEFAULT_CLAIMS: AppleClaims = {
  sub: "001234.fake-apple-sub.0000",
  email: "apple.tester@privaterelay.appleid.com",
  email_verified: true,
  is_private_email: true,
};

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64url");

export interface AppleEnvironment {
  apiBase: string;
  idpBase: string;
  /** The ES256 private key the app signs its client secret with. */
  clientPrivateKeyPem: string;
  /** Claims the next id_token will carry. */
  setClaims: (claims: Partial<AppleClaims>) => void;
  resetClaims: () => void;
  /** The `user` field Apple form-posts on first authorization only. */
  setUserField: (value: string | null) => void;
  /** Sign the id_token with a key NOT in the JWKS, to test rejection. */
  useWrongSigningKey: (wrong: boolean) => void;
  idpLog: () => string[];
  stop: () => Promise<void>;
}

export const startAppleEnvironment = async (): Promise<AppleEnvironment> => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(TEST_DB + suffix, { force: true });
  }

  /* Apple's token-signing keypair (RS256), published via JWKS. */
  const idTokenKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  /* A second keypair never published — for the "unknown key" case. */
  const impostorKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });

  /* The app's own ES256 key, standing in for the downloaded .p8. */
  const clientKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const clientPrivateKeyPem = clientKeys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  /* Node exports a JWK directly from a KeyObject — no `jose` needed. */
  const jwk = idTokenKeys.publicKey.export({ format: "jwk" });

  const log: string[] = [];
  const issued = new Map<string, { challenge: string | null }>();
  let claims: AppleClaims = { ...DEFAULT_CLAIMS };
  let userField: string | null = null;
  let wrongKey = false;

  const signIdToken = (): string => {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", kid: APPLE_KID, typ: "JWT" };
    const payload = {
      iss: claims.iss ?? APPLE_ISSUER,
      aud: claims.aud ?? APPLE_CLIENT_ID,
      exp: claims.exp ?? now + 3600,
      iat: now,
      sub: claims.sub,
      ...(claims.email !== undefined ? { email: claims.email } : {}),
      ...(claims.email_verified !== undefined
        ? { email_verified: claims.email_verified }
        : {}),
      ...(claims.is_private_email !== undefined
        ? { is_private_email: claims.is_private_email }
        : {}),
    };

    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
      JSON.stringify(payload),
    )}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    const key = wrongKey ? impostorKeys.privateKey : idTokenKeys.privateKey;
    return `${signingInput}.${signer.sign(key).toString("base64url")}`;
  };

  const idp: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${APPLE_IDP_PORT}`);
    log.push(`${req.method} ${url.pathname}`);

    /* /auth/keys — the JWKS the server verifies id_tokens against. */
    if (url.pathname === "/auth/keys") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ keys: [{ ...jwk, kid: APPLE_KID, alg: "RS256", use: "sig" }] }));
      return;
    }

    /* /auth/authorize — a real Apple would show a consent screen. This
       records the PKCE challenge and immediately FORM-POSTS back, which
       is what response_mode=form_post means. */
    if (url.pathname === "/auth/authorize") {
      const q = url.searchParams;

      if (q.get("response_mode") !== "form_post") {
        res
          .writeHead(400, { "Content-Type": "text/plain" })
          .end("Apple requires response_mode=form_post for name/email scope");
        return;
      }

      const code = `apple-code-${Math.random().toString(36).slice(2)}`;
      issued.set(code, { challenge: q.get("code_challenge") });

      /* Auto-submitting form, exactly as Apple does it. */
      const fields: Record<string, string> = {
        code,
        state: q.get("state") ?? "",
        ...(userField ? { user: userField } : {}),
      };
      const inputs = Object.entries(fields)
        .map(
          ([k, v]) =>
            `<input type="hidden" name="${k}" value="${v.replace(/"/g, "&quot;")}">`,
        )
        .join("");

      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<html><body><form id="f" method="POST" action="${q.get("redirect_uri")}">` +
          `${inputs}</form><script>document.getElementById("f").submit()</script>` +
          `</body></html>`,
      );
      return;
    }

    /* /auth/token — verifies the client-secret JWT and PKCE, then returns
       an id_token. */
    if (url.pathname === "/auth/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const reply = (status: number, payload: unknown): void => {
          res
            .writeHead(status, { "Content-Type": "application/json" })
            .end(JSON.stringify(payload));
        };

        const code = params.get("code") ?? "";
        const entry = issued.get(code);
        if (!entry) {
          reply(400, { error: "invalid_grant", error_description: "unknown code" });
          return;
        }
        issued.delete(code);

        if (params.get("client_id") !== APPLE_CLIENT_ID) {
          reply(401, { error: "invalid_client" });
          return;
        }

        /* The client secret must be a JWT, not a static string. Check its
           shape and claims the way Apple would — this is what catches a
           swapped iss/sub, the single easiest Apple mistake to make. */
        const secret = params.get("client_secret") ?? "";
        const parts = secret.split(".");
        if (parts.length !== 3) {
          reply(401, {
            error: "invalid_client",
            error_description: "client_secret must be a JWT",
          });
          return;
        }
        const secretClaims = JSON.parse(
          Buffer.from(parts[1]!, "base64url").toString("utf8"),
        ) as { iss?: string; sub?: string; aud?: string };
        if (
          secretClaims.iss !== APPLE_TEAM_ID ||
          secretClaims.sub !== APPLE_CLIENT_ID ||
          secretClaims.aud !== APPLE_ISSUER
        ) {
          reply(401, {
            error: "invalid_client",
            error_description: `bad client_secret claims: ${JSON.stringify(secretClaims)}`,
          });
          return;
        }

        if (entry.challenge) {
          const verifier = params.get("code_verifier");
          if (!verifier) {
            reply(400, { error: "invalid_request", error_description: "missing verifier" });
            return;
          }
          const derived = createHash("sha256").update(verifier).digest("base64url");
          if (derived !== entry.challenge) {
            reply(400, { error: "invalid_grant", error_description: "PKCE mismatch" });
            return;
          }
        }

        reply(200, {
          access_token: "fake-apple-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: signIdToken(),
        });
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => idp.listen(APPLE_IDP_PORT, resolve));

  const api: ChildProcess = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      PORT: String(APPLE_API_PORT),
      PARKSPACE_DB: TEST_DB,
      APPLE_CLIENT_ID,
      APPLE_TEAM_ID,
      APPLE_KEY_ID,
      APPLE_PRIVATE_KEY: clientPrivateKeyPem,
      APPLE_AUTH_URL: `http://localhost:${APPLE_IDP_PORT}/auth/authorize`,
      APPLE_TOKEN_URL: `http://localhost:${APPLE_IDP_PORT}/auth/token`,
      APPLE_JWKS_URL: `http://localhost:${APPLE_IDP_PORT}/auth/keys`,
      OAUTH_PUBLIC_URL: `http://localhost:${APPLE_API_PORT}`,
      APP_PUBLIC_URL: "http://localhost:5173",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const serverLog: string[] = [];
  api.stdout?.on("data", (d) => serverLog.push(String(d)));
  api.stderr?.on("data", (d) => serverLog.push(String(d)));

  const apiBase = `http://localhost:${APPLE_API_PORT}/api`;

  const ready = await (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if ((await fetch(`${apiBase}/health`)).ok) return true;
      } catch {
        /* still starting */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })();

  if (!ready) {
    api.kill();
    idp.close();
    throw new Error(
      `Apple test server never became ready. Log tail:\n${serverLog.join("").slice(-800)}`,
    );
  }

  return {
    apiBase,
    idpBase: `http://localhost:${APPLE_IDP_PORT}`,
    clientPrivateKeyPem,
    setClaims: (next) => {
      claims = { ...claims, ...next };
    },
    resetClaims: () => {
      claims = { ...DEFAULT_CLAIMS };
    },
    setUserField: (value) => {
      userField = value;
    },
    useWrongSigningKey: (wrong) => {
      wrongKey = wrong;
    },
    idpLog: () => [...log],
    stop: async () => {
      api.kill();
      await new Promise<void>((resolve) => idp.close(() => resolve()));
    },
  };
};

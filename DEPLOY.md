# Deploying ParkSpace

Target: **Render** (free web service, Docker runtime). The API serves the
built React app, so the whole thing is one origin — no CORS, no separate
frontend host.

Live URL: https://parking-space-project-1.onrender.com/

---

## Before you start

**Do not deploy with `DEMO_MODE=true` if you don't want the seeded test
accounts exposed.** That flag enables an endpoint publishing the seeded
test passwords and a one-tap sign-in as a real user. Anyone with the URL
can use it.

---

## 1. Generate a session secret

Session tokens are HMAC-signed. Without this the server refuses to start
in production — deliberately, so it can never fall back to a guessable
key.

```powershell
npm run secret
```

Never put it in the Dockerfile or commit it to git.

---

## 2. Create the web service

1. Push the repo to GitHub.
2. On render.com: **New → Web Service**, connect the repo.
3. Runtime: **Docker** (uses the repo's `Dockerfile`). Instance type: **Free**.
4. Under **Environment**, add:

| Key              | Value                                   |
| ---------------- | --------------------------------------- |
| `NODE_ENV`       | `production`                            |
| `PORT`           | `3001`                                  |
| `SESSION_SECRET` | `<value from step 1>`                  |
| `DEMO_MODE`      | `true` (demo accounts) or `false`       |

5. Optionally set the health check path to `/api/health`.
6. **Create Web Service**. Redeploys happen automatically on each push.

Check it:

```
https://parking-space-project-1.onrender.com/api/health
```

---

## 3. Password-reset email (Brevo)

"Forgot password" emails a one-time link (valid 30 minutes). Set these
under **Environment** in Render. Never put them in the repo:

| Key              | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| `EMAIL_API_KEY`  | Brevo API key (SMTP & API → API Keys)                        |
| `EMAIL_FROM`     | a sender you verified in Brevo, e.g. `ParkSpace <you@gmail.com>` |
| `APP_PUBLIC_URL` | `https://parking-space-project-1.onrender.com`               |

`APP_PUBLIC_URL` is what the emailed link points at. Without the key,
production sends nothing and the reset request still reports success.

---

## 4. Optional: Google/GitHub sign-in

See `.env.example` for how to obtain the credentials. Add these as
environment variables in Render:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `OAUTH_PUBLIC_URL` and `APP_PUBLIC_URL` = `https://parking-space-project-1.onrender.com`

Register this redirect URI with the provider:

```
https://parking-space-project-1.onrender.com/api/auth/google/callback
```

Leave them unset and the sign-in screen simply says social sign-in isn't
enabled.

---

## Verifying before you announce it

```powershell
npm run build
npm run test:prod
```

To click through a production build locally:

```powershell
npm run prod:local        # http://localhost:3002
```

---

## Limitations of the free tier

- **Data is not persistent.** The free plan has no disk, so the SQLite
  database and uploaded photos reset on every restart or redeploy.
- **Sleeps when idle.** After ~15 minutes without traffic the service
  spins down; the next request takes 30–60 seconds.
- **Run a single instance.** SQLite is a local file, so a second instance
  would have its own diverging copy.

## Known limitations of the app

Demo-grade by design; each needs real work before handling real money or
real people's data.

- **Payments are simulated.** Card numbers are validated then discarded.
- **Password reset sends no email**, and there is **no email verification**.
- **Sessions cannot be revoked** before they expire (7 days by default;
  lower with `SESSION_TTL_DAYS`).
- **Uploaded photos are not access-controlled.** Anyone with the URL can
  view one.
- **Rate limiting is per-process and in-memory**, so it resets on deploy.
- **`node:sqlite` is still marked experimental** in Node 24.
- **Spot ratings and the owner earnings chart are illustrative.**

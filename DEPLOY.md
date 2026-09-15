# Deploying ParkSpace to your domain

Target: **Fly.io** with a persistent volume. The API serves the built
React app, so the whole thing is one origin — no CORS, no separate
frontend host.

Replace `parkspace.example.com` with your domain and `parkspace` with
your chosen Fly app name throughout.

---

## Before you start

**The app must not be deployed with `DEMO_MODE=true` on a public URL.**
That flag re-enables an endpoint publishing the seeded test passwords and
a one-tap sign-in as a real user. `fly.toml` sets it to `false`.

You need:

- A Fly.io account and `flyctl` (`iwr https://fly.io/install.ps1 -useb | iex`)
- Your domain, with access to its DNS records

---

## 1. Generate a session secret

Session tokens are HMAC-signed. Without this the server refuses to start
in production — deliberately, so it can never fall back to a guessable
key.

```powershell
npm run secret
```

Keep the output for step 3.

---

## 2. Create the app and its volume

```powershell
fly launch --no-deploy      # accept the existing fly.toml; pick a region near your users
fly volumes create parkspace_data --region sin --size 1
```

The volume holds `parkspace.db` and uploaded spot photos at `/data`.
**Without it, every deploy wipes all bookings, accounts and photos** —
Fly machine filesystems are otherwise ephemeral.

`primary_region` in `fly.toml` is `sin` (Singapore, closest to Chennai).
If you change it, create the volume in the same region.

---

## 3. Set secrets

Secrets are encrypted and injected at runtime; they are never in the
image or in git.

```powershell
fly secrets set SESSION_SECRET="<the value from step 1>"
```

Optional, for real Google/GitHub sign-in (see `.env.example` for how to
obtain them):

```powershell
fly secrets set `
  GOOGLE_CLIENT_ID="..." `
  GOOGLE_CLIENT_SECRET="..." `
  OAUTH_PUBLIC_URL="https://parkspace.example.com" `
  APP_PUBLIC_URL="https://parkspace.example.com"
```

Then register this exact redirect URI with the provider:

```
https://parkspace.example.com/api/auth/google/callback
```

Leave the OAuth variables unset and the sign-in screen simply says social
sign-in isn't enabled, rather than offering a button that fails.

---

## 4. Deploy

```powershell
fly deploy
```

The Dockerfile builds the SPA, then ships a runtime image with production
dependencies only. Check it:

```powershell
fly status
fly logs
curl https://parkspace.fly.dev/api/health
```

---

## 5. Point your domain at it

```powershell
fly ips list          # note the IPv4 (A) and IPv6 (AAAA) addresses
```

Add these DNS records at your registrar:

| Type   | Name                        | Value                    |
| ------ | --------------------------- | ------------------------ |
| `A`    | `@` (or `parkspace`)        | the IPv4 from `ips list` |
| `AAAA` | `@` (or `parkspace`)        | the IPv6 from `ips list` |

Then have Fly issue the TLS certificate:

```powershell
fly certs add parkspace.example.com
fly certs show parkspace.example.com     # wait for "Ready"
```

Certificates are issued via Let's Encrypt once DNS resolves, usually
within a few minutes. `force_https` in `fly.toml` redirects HTTP.

If you used an apex domain (`@`), note that some registrars don't allow
`A` records at the apex — use a `parkspace.` subdomain, or a registrar
with ALIAS/ANAME support.

---

## 6. Update the OAuth URLs

If you set up OAuth in step 3 with the `.fly.dev` hostname, point it at
the real domain now and add the new redirect URI at the provider:

```powershell
fly secrets set `
  OAUTH_PUBLIC_URL="https://parkspace.example.com" `
  APP_PUBLIC_URL="https://parkspace.example.com"
```

---

## Verifying before you announce it

```powershell
npm run build
npm run test:prod
```

That boots the server exactly as production runs it and attacks it: it
forges session tokens the old way, tampers with signatures, replays
expired ones, checks the demo endpoints are gone, and asserts the
security headers and rate limiting. 39 checks.

To click through a production build locally:

```powershell
npm run prod:local        # http://localhost:3002
```

---

## Operating it

**Back up the database.** It is a single file on one volume; a lost
volume is lost data.

```powershell
fly ssh console -C "cp /data/parkspace.db /data/backup.db"
fly sftp get /data/backup.db ./parkspace-backup.db
```

**Do not scale past one machine.** SQLite is a local file, so a second
machine gets its own copy and the two silently diverge. `fly.toml` pins
`min_machines_running = 1`. Horizontal scaling needs a shared database
(Postgres) and object storage for photos first.

```powershell
fly logs                       # live logs
fly ssh console                # shell in the machine
fly secrets list               # names only, never values
fly deploy                     # redeploy after changes
```

---

## Known limitations of this deployment

These are all demo-grade by design; each needs real work before the app
handles real money or real people's data.

- **Payments are simulated.** Card numbers are validated then discarded;
  no gateway is connected and no charge is made.
- **Password reset sends no email.** The endpoint reports a simulated
  result; wiring it up needs an email service and a signed, expiring
  reset token.
- **No email verification** on registration.
- **Sessions cannot be revoked** individually before they expire — there
  is no server-side session store, so a stolen token is valid until its
  expiry (7 days by default; lower with `SESSION_TTL_DAYS`).
- **Uploaded photos are served from unguessable paths but are not
  access-controlled.** Anyone with the URL can view one.
- **Rate limiting is per-process and in-memory**, so it resets on deploy
  and doesn't coordinate across machines.
- **`node:sqlite` is still marked experimental** in Node 24. It works,
  but it prints a warning and its API could change across major versions.
- **Spot ratings and the owner earnings chart are illustrative**; the
  revenue total is real, the daily bars are not.

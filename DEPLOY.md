# Hostel + Mess Index — Deploy Guide

Hostel + Mess Index is a zero-dependency Node.js app (native `node:http` +
`node:sqlite` only). There is nothing to install: no `npm install` step,
no build step.

## Requirements

- **Node.js 24+** (`package.json` declares `"engines": { "node": ">=24" }`
  — `node:sqlite` (`DatabaseSync`) requires Node 24).
- No external dependencies, no database server. The SQLite file is
  created and seeded automatically on first run (9 seed listings:
  2 VERIFIED + 4 LISTED + 3 EXAMPLE).

## Start command

```bash
node server.js
# or
npm start
```

Default port is **3034** (env `PORT`).

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ADMIN_CODE` | **Yes — fail-closed** | _(none)_ | Private master code, used as the `X-Master-Code` / `X-Admin-Code` header. The server **exits at startup** with `FATAL: ADMIN_CODE env var is required` unless it is set. There is no default and no master login form. Never put a real code in code, the repo, or logs. |
| `SESSION_SECRET` | Recommended | Random per startup | HMAC secret that signs session cookies. Set it on deploy so sessions survive restarts; without it a random secret is generated at startup and **all sessions end when the server restarts**. |
| `DB_FILE` | No | `data/hostel.sqlite` next to `server.js` | SQLite database file. **On SnapDeploy set `DB_FILE=/tmp/hostel.sqlite`** (see writable-dir note below). |
| `UPLOADS_DIR` | No | `uploads/` next to `server.js` | Manager + review photo storage. **On SnapDeploy set `UPLOADS_DIR=/tmp/hostel-uploads`**. |
| `PORT` | No | `3034` | Port the server listens on. Hosts that assign a port (SnapDeploy) set this themselves — do not hard-code it. |
| `NODE_VERSION` | Host-dependent | — | `24` on hosts that pick the Node version from an env var (SnapDeploy / Render). |
| `LOGIN_LOCK_SECONDS` | No | `900` (15 min) | Lockout after 5 failed logins. |
| `SINGLE_SESSION` | No | Off | Testing-only: `1` makes every login invalidate all other sessions. **Leave off on the deployed site** — a login must never log anyone else out. |
| `UPLOAD_IP_LIMIT_PER_HOUR` | No | `100` | Per-IP photo-upload cap per hour. |

## Writable directory / data storage

The app writes two things at runtime: the SQLite database and uploaded
photos (JPG/PNG/WebP, magic-byte checked, 5 MB max, 8 per hostel).

- On a normal PC/server the app directory is writable, so the database
  and uploads live next to `server.js` exactly as before
  (`data/hostel.sqlite`, `uploads/`).
- **Read-only app directory fallback (already in `server.js`, FoodScope
  pattern):** if the app directory cannot be written (e.g. SnapDeploy's
  `/app`), the database automatically moves to `/tmp/hostel/data/hostel.sqlite`
  and uploads to `/tmp/hostel-uploads`. Explicit `DB_FILE` / `UPLOADS_DIR`
  env vars always win over the fallback. The app logs
  `Hostel data directory (read-only app dir fallback): ...` on startup
  when the fallback is active. No code or env change is needed for this.
- **Warning:** data under `/tmp` is ephemeral — it can disappear on a
  container restart/redeploy, taking the database and uploads with it.
  On a host that offers a persistent disk/volume, mount one and point
  the app directory at it (or keep the app directory itself writable)
  so the database survives restarts. Until then, treat a
  `/tmp`-fallback deploy as demo data only, and keep original photos —
  uploaded photos are lost on redeploy.

## Deploy settings

### SnapDeploy

- Start command: `node server.js` (Node 24 image)
- Env vars:
  - `NODE_VERSION=24`
  - `ADMIN_CODE=<private code>` — required, fail-closed; generate a
    long random code and keep it out of the repo.
  - `SESSION_SECRET=<long random string>` — recommended, so logins
    survive restarts.
  - `DB_FILE=/tmp/hostel.sqlite`
  - `UPLOADS_DIR=/tmp/hostel-uploads`
  - `PORT` is assigned by the host — do not hard-code it.
- The read-only `/app` fallback above applies automatically if the env
  vars are missed; see the `/tmp` ephemerality warning before treating
  the deploy as permanent. No container slot is free as of 2026-11-07
  (4/4 used) — this app is not deployed yet.

## First login after deploy

- **Master (Hashir):** no login form — use the private `ADMIN_CODE` as
  the `X-Master-Code` header on `/admin`. The master approves manager
  accounts, verifies listings (source note required), and can reset a
  password (kills all that account's sessions).
- **Manager:** registers at `/login-manager`, starts **pending**, and
  cannot log in until the master approves them. Managers run only
  their own hostels.
- **Student:** registers at `/login-student` and is active immediately.
  Students write one review per hostel and change their own password
  from the "Your account" card on the home page or a hostel page.
- Passwords are scrypt hashes; sessions are HttpOnly + `Secure` cookies
  (24 h). **The site must be served over HTTPS** — browsers will not
  store a `Secure` cookie over plain HTTP, so a plain-HTTP deploy
  would look like login "works" at the HTTP level but never keeps the
  user signed in. Local plain-HTTP development still works for API
  tests (see below), but real browsers need HTTPS.

## Smoke check after deploy

1. Open the site — the home page lists VERIFIED + LISTED hostels
   (2 verified, 4 listed in the seed); the 3 EXAMPLE rows appear only
   when "Show EXAMPLE demo listings" is ticked.
2. `GET /api/meta` returns 3 cities (Peshawar, Lahore, Islamabad).
3. Registering a student at `/login-student` then logging in keeps the
   session (avatar shows the name; `/api/auth/me` returns the student).
4. A manager account cannot log in until approved from `/admin` with
   the master code.
5. Locally, the full suite covers all of this: `node test.js`
   (509 checks, fresh temp DB on port 3097, exit 0 = all green).

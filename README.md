# Hostel + Mess Index

Structured, verified hostel/PG rents + mess rates + price history by
university area — Peshawar, Lahore, Islamabad. Managers run their own
listings (fees, photos, map, contact, rental period) and students log
in to write reviews, which the hostel manager checks before they go
public. No booking or payment happens here; contact the hostel
directly.

## Roles (exact scoping)

- **Master** (Hashir, via the private `ADMIN_CODE` header — there is
  no master login form): approves / rejects / suspends / reinstates
  manager accounts, verifies listings (source note still required),
  assigns an ownerless legacy listing to a manager, hides or restores
  any listing, sees every review including rejected ones, overturns
  any moderation decision, removes any photo or manager reply, resets
  a password (kills all that account's sessions). Cannot be
  self-registered.
- **Manager** (Gmail + password, master-approved): full CRUD on ONLY
  their own hostel(s) — details, fees, photos, map, contact, rental
  period, availability. Moderates reviews on ONLY their own hostels
  (approve / reject with a reason, public reply). Cannot touch
  another manager's hostel (403), cannot verify their own listing,
  cannot delete a review (only reject with a reason — it stays in the
  database), cannot see student Gmails. One manager may own several
  hostels; one hostel has exactly one manager. A suspended manager's
  sessions die at once; their listings stay visible but are marked
  "manager suspended — contact the site admin", and the manager cannot
  edit until reinstated.
- **Student** (Gmail + password, active right after registering):
  one review per hostel (rating + categories + text + up to 3
  photos), edit it while pending, delete it. Cannot review without
  logging in, cannot review the same hostel twice, cannot approve
  anything, cannot see other students' Gmails.
- **Public (logged out)**: search, filters, calculator, compare,
  listing detail (fees, map, photos, approved reviews, contact),
  reference ranges. Cannot add a listing, review, or upload anything.

Manager accounts start **pending** and cannot log in until the master
approves them. Legacy listings (the 9 seed rows) have no owner; only
the master can assign one to a manager — there is no claim button and
no auto-claim.

## How verification works (the honesty model)

Every listing has exactly one status, enforced server-side:

- **VERIFIED** — an admin confirmed it and recorded a source note.
  Nothing is ever shown as verified without a source note (the API
  returns 400 if the note is empty). VERIFIED rows also carry a
  last-verified date. A manager editing their own hostel never
  verifies it — VERIFIED stays master-only.
- **LISTED** — a manager-submitted claim,
  unverified. It is always labelled "LISTED — unverified manager
  listing" and is never counted as verified.
- **EXAMPLE** — demo listings only (generic names like "Example Boys
  Hostel"). They are excluded from default search and from ALL counts,
  and appear only when the user ticks "show examples".

Manager submissions start LISTED. An admin verifies or hides them
from `/admin` with the master code. Only approved managers add
listings — there is no public submit form.

## Price history

Every rent or mess change (admin edit or manager edit) writes a
history row (old → new + date), including per-room-type rents
(`room_types:<room>`) and every fee field. Prices are never
overwritten silently; the listing detail view shows the full history.

## Fees, amenities, rental period (the "Not available" rule)

Every charge the manager has not set shows as **"Not available"** —
never a guessed number. Each amenity (WiFi, mess, laundry, AC,
generator, geyser, parking, CCTV, security guard, attached bath,
fridge, TV lounge, library, mineral water, daily cleaning, kitchen
access, gym) is **included**, **charged extra** (with a price), or
**not available**. When a manager does not fill in a rental period,
the listing shows **"Rental period not stated"**. Seats are shown
only when the manager states them — a number is never invented.
Mess status is active, not available, or seasonal; "No mess facility
currently active" is a real, showable state.

## Photos (manager uploads + review photos)

- Managers upload JPG, PNG or WebP photos for their own hostels (max
  5 MB each, 8 photos per hostel, 20 uploads per day). Files are
  checked by their **magic bytes**, not just the file extension, and
  are stored under a random name (`photo-<32 hex chars>.jpg/png/webp`)
  — never the upload name.
- Manager photos show immediately (approved on upload); the master
  can remove any photo. Review photos (up to 3 per review) show only
  when the review is approved; if a review is rejected after approval,
  its photos stop being public too. The master can open a pending
  photo with the master code while moderating; anyone else gets a 404.
- Pending photos are never public — only their owner (or the
  hostel's manager, for review photos) can see them.
- **Storage is not permanent:** photos live under `UPLOADS_DIR`
  (default `uploads/` next to the server, `/tmp/hostel-uploads` on
  SnapDeploy). The live host's container disk is lost on redeploy, so
  uploaded photos disappear when the site is redeployed — keep your
  originals. Uploaded files are never committed to the repo.

## Map (no API key)

No Google Maps API key is used or needed. A manager pastes a Google
Maps **share or embed link** — including the short `maps.app.goo.gl`
link the Maps app itself shares; a share link from the app is the one
managers most often have. The server validates it (host must be
`google.com` / `maps.google.com` / `maps.app.goo.gl`, path must be a
Maps embed/share URL) and renders the no-key embed. A short link
cannot be embedded directly, so its embed falls back to the street
address; the saved link still opens in Google Maps from the detail
page. Any other URL is rejected — no arbitrary iframes. Without a
saved link, the page embeds a map search for the street address. Distances are the hostel's own stated text,
labelled "as stated by the hostel" — never computed, never invented.

## Reviews (the honesty model)

- A student submits a review → **pending**, visible only to the
  student, the hostel's manager, and the master. It is invisible to
  the public and does not count in the average.
- The manager **approves** it (public immediately) or **rejects** it
  with a **required reason** from a published list (spam / abusive
  language / personal data / off-topic / fake or staged) plus an
  optional note. A rejected review is **never deleted**: it stays in
  the database, visible to the master, and the listing page shows
  honestly how many reviews were not published ("2 reviews were not
  published after the manager's check").
- The **master can overturn** any decision (approve a rejected review
  or hide an approved one) with a reason; the audit records it. The
  master can also remove a manager's public reply.
- The average rating counts **approved reviews only**, with the count
  shown ("4.2 ★ from 6 student reviews"). Never a manager-set score.
- Every review carries the label: **"Student review — the site has
  not verified this student lived here."** There is no "verified
  resident" badge yet — v1 must not claim verification it cannot
  check.
- Abuse guards: one review per student per hostel (edit instead of a
  second one), 5 reviews/day per student, text ≤ 2000 chars, URLs are
  stripped from review text, phone numbers and CNIC numbers in review
  text are rejected.
- A student's Gmail is **never shown publicly** — reviews show a
  display name only. A manager's phone number **is shown publicly**
  (it is the booking contact) and the manager form says so plainly.

## Security (what is enforced)

- Passwords: scrypt only (per-account salt), constant-time verify.
  No password, session token, or Gmail is ever written to a log.
- Sessions: random 32-byte token, HMAC-SHA256 hash stored in the DB,
  24-hour expiry, HttpOnly `SameSite=Lax` cookie. Logout, suspend,
  reject, and password reset all kill sessions at once. Changing your
  password (manager portal → Your account) kills every session too —
  including the browser you change it from — and hands that browser a
  fresh session cookie, so any other device or browser is signed out
  at once.
- Login: 5 failed attempts → 15-minute lock (account + IP), generic
  "invalid Gmail or password" error on every failure (never says
  whether the account exists), 429 on abuse. Registration is limited
  to 3/hour per IP.
- Every manager/student endpoint re-checks ownership server-side; a
  guessed foreign id returns 403 (listings, photos, reviews, replies
  — all covered by tests).
- Uploads: magic bytes + extension + 5 MB + count caps + random
  names + path guard + `nosniff`; no file is ever served as HTML.
  Uploads are also capped at 100 attempts/hour per IP (both upload
  endpoints) — far above any honest burst, since one manager's whole
  daily allowance is 20.
- XSS: every user string is escaped on render (listing names, review
  text, replies, captions, rules, menus) — including the old
  `app.js` / `admin.js` pages.
- CSRF: `SameSite=Lax` cookies + an Origin check on all
  cookie-authenticated POSTs.
- Input validation on every boundary: enums, ranges, length caps,
  Pakistani phone format (03XX-XXXXXXX), Gmail format; unknown fields
  are rejected with 400.
- Security headers on every response: `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: no-referrer-when-downgrade`,
  `X-Frame-Options: SAMEORIGIN`.
- `ADMIN_CODE` is **fail-closed**: the server exits with a FATAL
  message unless a private code is set. There is no default code —
  the old public demo value is dead and appears nowhere in the code.
- Audit rows are written for: manager approve/reject/suspend/
  reinstate, listing verify/hide/restore/create/update/assign,
  review submit/edit/delete/approve/reject/overturn/reply,
  photo upload/delete, password change/reset.

## Seed data (what is real, what is not)

- **16 market-range reference rows**, each with a source and date
  (UET Lahore official fee breakup Fall 2026; lahorehostel.pk guide
  Jan 2026; houstel.pk 2025 guide; UET Taxila admissions portal
  2025-26; UET Peshawar handbook 2025). Ranges are market ranges,
  never one hostel's rent.
- **2 VERIFIED listings**: UET Lahore hostel dormitory
  Rs 11,644/semester and cubicle Rs 15,846/semester (subsidized),
  from the official Fall 2026 fee breakup. These are per-semester
  prices; the app shows the monthly equivalent (≈ rent ÷ 6) labelled
  as an estimate.
- **4 LISTED listings** (published prices, not verified by us):
  Lahore Hostel Wapda Town Rs 20,000/month with mess;
  Professional Lahore Hostels Model Town from Rs 12,000/month;
  Al Rahman Girls Hostel Hostel City from Rs 20,500/month
  all-inclusive; Bahria Orchard boys hostel shared from
  Rs 9,990/month. Each carries its published source.
- **3 EXAMPLE listings** (generic demo names, excluded everywhere).
- **Zero invented hostels with fake rents.** No other hostel is claimed.

## The 3D dashboard look (what it really is)

The home page looks like a 3D dashboard, and every part of that look
is honest about what it is:

- **The hostel map is pure CSS 3D** — an isometric floor built from
  CSS shapes (rotated floor, back wall, room blocks, sofa, round
  table, plants). There are **no images, no canvas, no CDN, no
  external fonts** anywhere on the site. One room-block per
  VERIFIED or LISTED hostel from the live `/api/listings` data (6 on
  the seed); each block is a real link to that hostel's detail page
  and shows its real name and real rent (semester rows keep their
  per-semester figure). The wall screen is a real bar chart of the
  same monthly rents. A student figure on a block is labelled only
  with the display name of an approved reviewer on that hostel — no
  approved review, no name label, no invented name. **EXAMPLE demo
  listings never appear on the map**, in the stat cards, or in any
  count; they show only in the plain list when the user ticks "Show
  EXAMPLE demo listings".
- **The stat cards are live numbers**, computed in the browser from
  the same `/api/listings` data the page shows: hostels listed
  (VERIFIED + LISTED), rooms (seat numbers only where actually
  stated), student reviews (approved only), cheapest rent (lowest
  monthly-equivalent rent, semester rows at rent ÷ 6, labelled as
  such). Nothing is hardcoded; with no listings the cards say so
  instead of showing a made-up number.
- **"Ask Hostel AI" is not AI.** The panel says so in plain words
  ("Shortcuts — no AI here yet") and holds only four shortcuts that
  filter the real list and the real map: pending reviews (managers
  only, otherwise a login message), vacant rooms, cheapest hostels,
  verified only. A chip and the map always agree — chips operate on
  VERIFIED + LISTED hostels only, so the chip's status line, the
  list and the scene can never disagree about EXAMPLE rows.
- The other four pages (detail, login, manager, admin) use the same
  shell: top pill nav, left icon rail (a bottom bar on phones),
  glass cards, same tokens. A logged-in user gets a Log out pill in
  the nav on every page.

## Features

- Filters: city, area, type (boys / girls / family), room (single /
  double / triple / dorm), mess included vs separate, max rent per
  month; sort by rent ascending / descending. Max rent and sort both
  run on the monthly equivalent — semester rows count at rent ÷ 6, the
  same number the stat cards, the calculator and the cheapest chip
  use — so a "max Rs 5,000/month" search finds the UET semester rows
  (≈ Rs 1,941 and Rs 2,641/month).
- 3D home-page map (pure CSS, no images): one room-block per
  VERIFIED/LISTED hostel linking to its detail page, wall-screen
  rent chart, student figures labelled only with real approved
  reviewers; EXAMPLE rows never on the map.
- Live stat cards (hostels, rooms stated, approved reviews,
  cheapest rent) + an "Ask Hostel AI" panel of four honest shortcuts
  (no AI behind it — the panel says so).
- Monthly total calculator: rent + mess (only when charged
  separately) + user extras.
- Compare up to 3 listings side by side.
- Facilities checkboxes (WiFi, laundry, security, generator,
  attached bath) + meals per day.
- Listing detail page (`/hostel?id=`): full fee breakdown, room
  types, amenities, map embed, photo gallery, rental period +
  availability, rules + timings, mess menu, approved reviews with
  manager replies, price history, and a "Write a review" form for
  logged-in students.
- Manager portal (`/manager`): "My hostels", create/edit form with
  every fee field and amenity, photo upload, reviews queue (pending
  first), and a change-password form in the Your account card. Login is split into two totally separate pages: students use
  `/login-student` (student login + register only) and managers use
  `/login-manager` (manager login + register only); `/login` is only a
  chooser with two links and no form. A page refuses the other role's
  account with a plain message, and shows a "logged in as … — log out
  to log in as …" box instead of the forms when you visit it while
  logged in as the other role.
- Master view (`/admin`): verify / hide / price edit, pending
  managers, rejected reviews with overturn, audit trail.

## Run

```
node server.js            # port 3034 (env PORT)
DB_FILE=/tmp/hostel.sqlite UPLOADS_DIR=/tmp/hostel-uploads ADMIN_CODE=your-private-code node server.js
node test.js              # 491 tests on a throwaway DB
```

`ADMIN_CODE` is **required** — the server exits with a FATAL message
unless a private code is set, and there is no default. Never put a
real code in code, README, or logs. `DB_FILE` defaults to
`data/hostel.sqlite`; `UPLOADS_DIR` defaults to `uploads/` next to
the server. On hosting (e.g. SnapDeploy) set
`DB_FILE=/tmp/hostel.sqlite` because the app directory may be
unwritable, `UPLOADS_DIR=/tmp/hostel-uploads`, and `NODE_VERSION=24`.
On first run against an old database, the server creates the
`users` / `sessions` / `audit` / `photos` / `reviews` tables and all
34 new listing columns automatically; the 9 seed rows are left
unchanged. `SESSION_SECRET` is optional — set it on deploy so
sessions survive restarts; without it a random secret is generated at
startup and all sessions end when the server restarts.

**Testing-only single session:** `SINGLE_SESSION=1` makes every login
invalidate all other sessions, so while testing on one PC, logging in
as one role logs the other role out. It is OFF by default — leave it
off on the deployed site, where a login must never log anyone else
out (real users are separate people on separate devices). Testing on
your PC: `$env:SINGLE_SESSION="1"` before `node server.js`.

## Honest limits (also in the site footer)

- LISTED prices are manager claims, not confirmations.
- Only VERIFIED rows carry an admin source.
- Ranges are market ranges, not one hostel's rent.
- Semester prices are shown with a monthly-equivalent estimate,
  labelled as such — the semester figure is the real one.
- Reviews are student reports, not verified stays.
- Uploaded photos are lost when the site is redeployed.
- No booking or payment happens in the app.
- The 3D map is CSS shapes, not photos or a live map, and the "Ask
  Hostel AI" panel is shortcuts, not AI.
- A real 375px phone visual check is still outstanding (Hashir's PC
  re-test) — the mobile rules (bottom rail bar, stacked forms,
  44px tap targets, no page-level horizontal overflow) are verified
  by CSS inspection + tests only, not by looking at a phone.

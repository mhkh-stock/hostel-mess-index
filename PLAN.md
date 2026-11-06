# Hostel + Mess Index — plan

## v1 (built 2026-11-04, tests 25/25 PASS)
- Listings directory: Peshawar, Lahore, Islamabad + university areas.
- Status model VERIFIED / LISTED / EXAMPLE, server-enforced.
- Price history on every rent/mess change.
- Filters, sort, monthly total calculator, 3-way compare.
- Admin: verify (source note required), hide, price edit.
- Seed: 16 reference rows, 2 VERIFIED official UET rows,
  4 LISTED published prices, 3 EXAMPLE listings, 0 invented hostels.

## v2 (built 2026-11-06, tests 306/306 PASS — manager portal + student reviews)
- Phase 1 — auth + roles: users + sessions tables, scrypt passwords,
  HMAC-SHA256 session tokens, HttpOnly SameSite=Lax cookies (24h),
  5-fail/15-min lockout (account + IP), register/login/logout/me/
  change-password, master approve/reject/suspend/reinstate + password
  reset, ADMIN_CODE fail-closed (no default; old public demo value
  dead), security headers, XSS escape fix on the old pages.
- Phase 2 — manager portal + listing fields: 34 new listing columns
  (contact, address, map URL, 7 fee fields, amenities tri-state,
  room types, rules/timings, rental period, seats, mess), manager CRUD
  scoped to owner_id, price-history extension, login.html +
  manager.html. Manager edits never verify a listing.
- Phase 3 — photos: photos table, multipart upload (magic bytes +
  extension + 5 MB + caps + random names + path guard), UPLOADS_DIR,
  /api/photos/file/:name (approved only; pending visible to owner).
  Manager photos approved on upload; review photos pending.
- Phase 4 — student reviews: reviews table, submit/edit/delete, one
  review per hostel, moderation flow (manager approves/rejects with a
  required reason from a fixed list; rejected reviews never deleted;
  master can overturn; listing shows the unpublished count), manager
  replies, public review list + average of approved only, hostel.html
  detail page with reviews + gallery + map.
- Phase 5 — final review (2026-11-06): full security-checklist
  re-verification against the code; fixed 6 gaps found in the re-check
  (review photos left public when a review was rejected after
  approval; suspended-manager listings not marked; no audit rows for
  the legacy admin verify/hide/edit endpoints; community-submit
  validation gaps; admin edit passed NaN into the DB on bad input;
  photo daily limit returned 400 instead of 429; unknown fields not
  rejected on login/master/admin boundaries; invalid calc/listings
  query params). Migration proven on a copy of the pre-Phase-1 DB:
  all 5 new tables + 34 columns created, 9 seed rows byte-identical.
  Fresh smoke on 3034 all green (29 checks, full E2E). README
  rewritten for the new product. Hosting still deferred (no container
  slot); runs on port 3034.
- Seed still: 16 reference rows, 2 VERIFIED official UET rows,
  4 LISTED published prices, 3 EXAMPLE listings, 0 invented hostels.

## Next (only with a real need)
- More cities (Rawalpindi, Karachi, Faisalabad, Multan) once the
  three launch cities have real verified rows.
- Hostel owners claiming a listing (phone-OTP verification) — only
  if Hashir asks; never auto-verify from a claim alone.
- Mess menu / meal-quality ratings — community reports, always
  labelled unverified unless admin-confirmed.

## Deploy notes
- Port 3034. Zero dependencies, Node 24+ native http + sqlite.
- Env: `DB_FILE=/tmp/hostel.sqlite`, `NODE_VERSION=24`,
  `ADMIN_CODE=<private code, never the demo default>`.
- Never upload `data/*.sqlite` to GitHub.

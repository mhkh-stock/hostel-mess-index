# Hostel + Mess Index — plan

## v1 (built 2026-11-04, tests 25/25 PASS)
- Listings directory: Peshawar, Lahore, Islamabad + university areas.
- Status model VERIFIED / LISTED / EXAMPLE, server-enforced.
- Price history on every rent/mess change.
- Filters, sort, monthly total calculator, 3-way compare.
- Admin: verify (source note required), hide, price edit.
- Seed: 16 reference rows, 2 VERIFIED official UET rows,
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

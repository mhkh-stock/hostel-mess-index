# Hostel + Mess Index

Structured, verified hostel/PG rents + mess rates + price history by
university area — Peshawar, Lahore, Islamabad. No booking or payment
happens here; contact the hostel directly.

## How verification works (the honesty model)

Every listing has exactly one status, enforced server-side:

- **VERIFIED** — an admin confirmed it and recorded a source note.
  Nothing is ever shown as verified without a source note (the API
  returns 400 if the note is empty). VERIFIED rows also carry a
  last-verified date.
- **LISTED** — a community-submitted claim, unverified. It is always
  labelled "LISTED — unverified community claim" and is never counted
  as verified.
- **EXAMPLE** — demo listings only (generic names like "Example Boys
  Hostel"). They are excluded from default search and from ALL counts,
  and appear only when the user ticks "show examples".

Community submissions start LISTED. An admin verifies or hides them
from `/admin` with the master code.

## Price history

Every rent or mess change (admin edit only) writes a history row
(old → new + date). Prices are never overwritten silently; the listing
detail view shows the full history.

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

## Features

- Filters: city, area, type (boys / girls / family), room (single /
  double / triple / dorm), mess included vs separate, max rent;
  sort by rent ascending / descending.
- Monthly total calculator: rent + mess (only when charged
  separately) + user extras.
- Compare up to 3 listings side by side.
- Facilities checkboxes (WiFi, laundry, security, generator,
  attached bath) + meals per day.

## Run

```
node server.js            # port 3034 (env PORT)
DB_FILE=/tmp/hostel.sqlite ADMIN_CODE=your-code node server.js
node test.js              # 25 tests on a throwaway DB
```

Admin code default is `hostel-admin` — a documented demo default.
Set a private `ADMIN_CODE` before real public use. On hosting
(e.g. SnapDeploy) set `DB_FILE=/tmp/hostel.sqlite` because the app
directory may be unwritable, and `NODE_VERSION=24`.

## Honest limits (also in the site footer)

- LISTED prices are community claims, not confirmations.
- Only VERIFIED rows carry an admin source.
- Ranges are market ranges, not one hostel's rent.
- Semester prices are shown with a monthly-equivalent estimate,
  labelled as such — the semester figure is the real one.
- No booking or payment happens in the app.

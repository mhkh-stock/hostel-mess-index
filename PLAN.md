# Hostel + Mess Index — plan

## v1 (built 2026-11-04, tests 25/25 PASS)
- Listings directory: Peshawar, Lahore, Islamabad + university areas.
- Status model VERIFIED / LISTED / EXAMPLE, server-enforced.
- Price history on every rent/mess change.
- Filters, sort, monthly total calculator, 3-way compare.
- Admin: verify (source note required), hide, price edit.
- Seed: 16 reference rows, 2 VERIFIED official UET rows,
  4 LISTED published prices, 3 EXAMPLE listings, 0 invented hostels.

## v2 (built 2026-11-06, tests 384/384 PASS — manager portal + student reviews)
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
  the legacy admin verify/hide/edit endpoints; public-submit
  validation gaps (that endpoint was removed 2026-11-07 — only
  approved managers list now); admin edit passed NaN into the DB on bad input;
  photo daily limit returned 400 instead of 429; unknown fields not
  rejected on login/master/admin boundaries; invalid calc/listings
  query params). Migration proven on a copy of the pre-Phase-1 DB:
  all 5 new tables + 34 columns created, 9 seed rows byte-identical.
  Fresh smoke on 3034 all green (29 checks, full E2E). README
  rewritten for the new product. Hosting still deferred (no container
  slot); runs on port 3034.
- Seed still: 16 reference rows, 2 VERIFIED official UET rows,
  4 LISTED published prices, 3 EXAMPLE listings, 0 invented hostels.

## v3 — 3D-dashboard restyle (built 2026-11-06, tests 404/404 PASS)
### Phase 1 — (built 2026-11-06, shell + design system only)
- Design tokens in public/styles.css mirror the "3D Dashboard With Ai"
  reel: light grey canvas #e8e8ec, white pill nav, left icon rail,
  frosted glass cards (blur 12px, hover lift -5px), orange accent.
  Bright orange #ff6b1a is decorative only (white on it is 2.85:1);
  text and filled buttons use deeper oranges that pass WCAG AA 4.5:1
  (checked by tests that parse the real token values from styles.css).
- index.html restructured into the shell: sticky top pill nav (orange
  logo dot, centre icon pills, search + bell + avatar), left icon rail
  (bottom bar on mobile ≤640px), greeting card (time-of-day + role from
  /api/auth/me; logged out: "Find a hostel near your university"),
  action pills, scene placeholder with a working +/− zoom control
  (CSS transform scale 0.7–1.5). No feature removed: search, filters,
  calculator, compare, market ranges, honest limits all kept.
  (The public submit form listed here was removed 2026-11-07 — only
  approved managers list now; see "Submit removal" below.)
  No fake numbers: the greeting sub-line shows real /api/listings counts.
- Phase 2 (not started): the real 3D hostel scene inside .scene.

### Phase 2 — (built 2026-11-06, the scene is the map)
- public/app.js (BEGIN/END SCENE section) builds the scene inside #sceneInner with pure CSS 3D
  (isometric floor rotateX(60deg)/rotateZ(-45deg), wooden CSS floor,
  back wall with a big screen + clock, black sofa + coffee table, round
  white meeting table + chairs, small green plants). No images, no CDN,
  no canvas, no external anything; all user strings via textContent.
- One room-block per VERIFIED/LISTED hostel from /api/listings (6 on the
  seed: 2 VERIFIED UET rows + 4 LISTED); EXAMPLE rows never render. Each
  block is a real <a> to /hostel?id=N with the hostel's real name + real
  rent (semester rows keep their per-semester figure); VERIFIED blocks
  are green-tinted, LISTED amber-tinted. Blocks grow to a third row if
  a 7th hostel is listed — never capped.
- Wall screen: real bar chart of monthly rent per listed hostel, bars
  scaled to the max rent; semester hostels chart as the monthly
  equivalent (÷6) and the screen says so.
- Student figure per hostel, labelled ONLY with the display name of an
  approved reviewer on that hostel (from /api/listings/:id/reviews);
  no approved review → figure with no name label. No invented names.
- Graceful failure: listings fetch fails → "The hostel map could not
  be loaded"; zero listed hostels → "No hostels listed yet". On mobile
  ≤640px the scene scrolls horizontally inside its container.
- Zoom (+/−, 0.7–1.5 on #sceneInner) still works; search, filters,
  calculator, compare, greeting, bell, nav search untouched.
  The scene rebuilds after an approved manager adds a listing.
- Tests 355/355 PASS (18 new in Phase 2: block count, detail URLs,
  chart values, semester ÷6, student-label rules incl. a live approved
  review, empty state, scene structure, <a> blocks, no raw HTML, layout
  bounds, zoom wiring; 19 new in Phase 3 — see below). No real-browser
  / 375px visual check yet — that is still outstanding (Hashir's PC re-test).

### Phase 3 — (built 2026-11-06, stat cards + Ask Hostel AI panel)
- Four glass stat cards (Phase 1 glass-card component, hover lift)
  in a row above the listing list, responsive (4 → 2 → 1 columns).
  Every number is computed from live API data, never hardcoded:
  Hostels listed = VERIFIED + LISTED count; Rooms = sum of room_types
  seats where a seat number is actually stated (unstated contributes 0,
  card notes "seats stated only"); Student reviews = approved reviews
  across the listed hostels (public reviews endpoints only); Cheapest
  rent = lowest monthly-equivalent rent, semester rows at rent ÷ 6,
  shown as "from Rs X/month". No listed hostels → "—" / "No hostels
  listed yet", never a fake number. On the seed the Rooms card reads 0
  ("seats stated only — none stated yet") because no seed row states
  seat numbers — honest, not a claim of zero rooms.
- "Ask Hostel AI" panel, same look as the reel's Neon panel (slides in
  from the right, header + close button, quick chips at the bottom),
  opened by the "Ask Hostel AI" pill in the action-pills area. The
  panel holds ONLY real shortcuts — no chat, no input pretending to
  answer, no Auto-coach toggle — and says so: "Shortcuts — no AI here
  yet. Each button filters the real list below." Chips: Show pending
  reviews (manager → opens /manager#reviews, the review queue;
  anyone else → "Log in as a manager to see pending reviews" + a
  /login link, never a fake count or list), Show vacant rooms
  (seats_available stated > 0 only), Show cheapest hostels (sorts by
  monthly-equivalent rent ascending), Show verified only. Each chip
  acts on the listing list AND the scene through the same quick-filter
  state the search already uses (no second filtering system), says
  what it did in plain words ("Showing 2 verified hostels"), and
  offers a "Show all" reset. A filter matching nothing shows an honest
  scene empty state ("No hostels match this filter") with a Show-all
  button. The scene + stats refresh after an approved manager adds a
  listing. Search, filters, calculator, compare, scene +
  zoom, greeting, bell, nav search all untouched. server.js untouched;
  no API, auth or data-model change. No real-browser / 375px visual
  check yet — still outstanding (Hashir's PC re-test).
- Tests 355/355 PASS (19 new: live-API stat equality, stated-only
  rooms rule, semester ÷6 cheapest, honest empty state, vacant /
  verified / cheapest chip rules on fake + live rows, pending-reviews
  routing by role, plain-words status lines, honest line + no fake-AI
  text in the panel, panel + stat-card markup, shared filter state,
  submit refresh, live Rooms +1-per-seat and reviews +1-per-approval
  deltas, Phase 3 CSS).

### Phase 4 — (built 2026-11-06, the four remaining pages in the shell)
- hostel.html, login.html, manager.html, admin.html now use the same
  shell as the home page: sticky top pill nav (orange logo dot, centre
  icon pills, search + bell + avatar + log-out when logged in), left
  icon rail (bottom bar on mobile ≤640px), glass cards, same tokens
  and buttons. The old centred header is gone on every page (the
  generic header rule is removed from styles.css). The detail page's
  content sits in a glass card; the two login cards sit side by side
  on desktop (one column on mobile); the manager form's fee / other-
  charge / room-type / amenity groups lay out in a responsive grid.
- No feature lost — restyle only: the detail page keeps the full fee
  breakdown, rooms, amenities, rules + timings, rental period +
  availability, seats, mess menu + status, contact, map embed +
  "Open in Google Maps" + Plus Code + distance text, gallery,
  approved reviews + average + count + "Write a review" (login
  first), price history, "← Back to search", and the honest labels.
  Login keeps both login cards, the register form (phone still
  optional, role select, manager-approval note), and the generic
  login-error behaviour. Manager keeps "My hostels", the create/edit
  form with a "Not available" choice on every charge and amenity,
  photo upload (8/hostel, 5 MB), the reviews queue (pending first,
  approve/reject with reason, reply), and the account status now
  reads "Waiting for master approval" while pending. Admin keeps
  pending managers, rejected reviews + overturn, audit trail, and
  verify (source note still required) / hide / edit with the
  X-Master-Code behaviour. The reviews section keeps id="reviews"
  (Phase 3's chip links to /manager#reviews).
- Rail highlight: Manager on the manager page; Search on the detail
  page (a search result); Log in and Admin get their own rail icon +
  pill on their pages, since no home section matches them. The nav
  search button links to /#find on sub-pages; the bell keeps the
  honest "No new notifications." popover; logged-in users get a
  Log out pill in the nav (POST /api/auth/logout). No admin link was
  added anywhere v2 did not already show one.
- Shell JS lives inside each page's own JS file (hostel.js, login.js,
  manager.js, admin.js) — no new file, because server.js serves a
  fixed per-file allowlist and this phase does not change server.js.
  server.js untouched; no API, auth, or data-model change.
- One tiny wording change: the manager form's Google Maps placeholder
  no longer contains a full https:// URL, so the no-external-asset
  rule holds on every page (the field still asks for a share link
  from google.com/maps).
- Tests 384/384 PASS (29 new: per-page shell + no-external-asset,
  rail/pill highlight, per-page control checklists incl. the optional
  phone and the pending-status wording, shell JS on all four pages,
  Phase 4 CSS + mobile stacking). No real-browser / 375px visual
  check yet — still outstanding (Hashir's PC re-test).

### Phase 5 — (built 2026-11-06, final review)
- Second pass over every page (index, hostel, login, manager,
  admin): layout, contrast, mobile 375px by CSS inspection, dead
  buttons, invented text, leftover v2 styling, broken links.
  Findings + fixes (6):
  1. EXAMPLE/chip inconsistency (known from Phase 3): with "Show
     EXAMPLE demo listings" ticked, the quick-filter chips ran on
     server rows including EXAMPLE rows while the scene always
     excluded them, so the chip's status line and the scene could
     disagree. Rule chosen: chips operate on VERIFIED + LISTED
     hostels only — the same population as the scene and the stat
     cards. One-line fix in applyQuickFilter (drop non-VERIFIED/
     LISTED rows whenever a chip is active; no chip = plain list
     still shows EXAMPLE rows when ticked). Tests prove list, status
     line and scene now agree.
  2. Home page had no Log out pill (the four sub-pages did) — added
     the same pill + wiring in app.js (POST /api/auth/logout).
  3. Calculator did nothing (silently) with no listing selected —
     now says "Pick a listing first — no hostels match the current
     filters."
  4. Tablet overlap: at ~640–1100px the greeting card (340px) + the
     four action pills (~570px) were wider than the main column and
     could paint over the greeting's text. The actions are now capped
     to the space right of the greeting (1100px cap, 980px cap with a
     narrower greeting; no cap once the layout stacks at 640px).
  5. 375px top nav: brand + search + bell + avatar (+ Log out when
     logged in) did not fit one row, so the nav now wraps at ≤640px
     and the brand name ellipsises as a backstop.
  6. Checkbox rows were under the 44px tap target — `.chk` rows are
     now 44px tall.
  Also: the price-history toggle's placeholder href="#" now points
  at the real detail page (/hostel?id=N; the click still toggles the
  history inline, and without JS it navigates somewhere real).
- Checked and clean, no change needed: every id a page's JS looks up
  exists in that page (or the JS injects it); every CSS class defined
  is used and no class contradicts the new system (the two apparent
  unused classes were false positives — `.js` inside CSS comments,
  `is-verified` via string concat in app.js; `cmp` is a JS hook class
  on purpose); no indigo #312e81, no old header rule, no old footer;
  no lorem/TODO/coming-soon/demo-name text anywhere; every href is a
  real route, in-page anchor, or the one Google Maps search URL the
  JS builds (WhatsApp links come from listing data). Contrast tokens
  unchanged and still pass WCAG AA 4.5:1.
- End-to-end flows re-proven in one chain (new tests): manager
  registers pending → cannot log in → master approves → logs in →
  creates a listing → it appears in the scene (block + wall chart)
  and the stats (hostels +1, rooms +8); student registers → logs in
  → reviews (pending, invisible publicly, unpublished 1) → manager
  approves → public, counted in the average and the reviews stat
  (+1), and the scene's student figure carries the student's real
  display name.
- Tests 404/404 PASS (20 new in Phase 5). server.js untouched; no
  API, auth, or data-model change. README rewritten for the 3D look
  (honest: CSS scene, no images, no real AI) and the test count.
- Still unverified: a real 375px phone visual check (Hashir's PC
  re-test) — mobile is verified by CSS inspection + tests only, not
  by looking at a phone. No real-browser check of any page in any
  phase yet.

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

## Submit removal (2026-11-07, Hashir's order: "Remove Submit — only approved managers list")
- Public "Submit a hostel" removed end to end: nav pill + rail icon on all
  5 pages, the #/submit form, its client JS, and `POST /api/listings`
  (now 404). Only approved managers add hostels, via the manager portal.
- Seed rows unchanged (2 VERIFIED + 4 LISTED + 3 EXAMPLE); the master can
  still verify / assign ownerless LISTED rows from /admin.

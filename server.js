// Hostel + Mess Index — structured, verified hostel/PG rents + mess rates
// + price history by university area (Peshawar, Lahore, Islamabad).
// Honesty model: VERIFIED = admin-confirmed with a source note; LISTED =
// manager-submitted, unverified claim; EXAMPLE = demo only, excluded from
// default search and from all counts. Ranges are market ranges, never one
// hostel's rent. No booking or payment happens here.
// Node.js 24+, native node:http + node:sqlite only. No external dependencies.
// Port 3034. Data: data/hostel.sqlite.
// Auth (Phase 1): manager + student accounts (scrypt passwords, HMAC-SHA256
// session tokens, HttpOnly SameSite=Lax cookies, 24h sessions, 5-fail/15-min
// lockout). Managers start PENDING and cannot log in until the master
// approves them; students are active immediately. The master acts only via
// the X-Master-Code header — ADMIN_CODE is fail-closed: the server exits
// without it. There is no default code and no master login form.
// Photos (Phase 3): manager uploads (JPG/PNG/WebP by magic bytes, 5 MB,
// 8 per hostel, 20/day) are approved on upload and served from UPLOADS_DIR
// (default ./uploads, /tmp/hostel-uploads on SnapDeploy — lost on redeploy).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3034);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'hostel.sqlite');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_CODE = process.env.ADMIN_CODE;
if (!ADMIN_CODE) { console.error('FATAL: ADMIN_CODE env var is required — set a private code, there is no default.'); process.exit(1); }
// Session secret: set SESSION_SECRET on deploy so sessions survive
// restarts. Without it a random secret is generated at startup and all
// sessions end when the server restarts (safe default, documented).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_SECONDS = 86400; // 24h
const LOGIN_LOCK_SECONDS = Number(process.env.LOGIN_LOCK_SECONDS || 900); // 15 min
// Testing-only single session: SINGLE_SESSION=1 makes every login
// invalidate ALL other sessions (any user, any browser), so while
// testing on one PC, logging in as one role logs the other role out.
// DEFAULT OFF: on the deployed site a login never touches anyone
// else's session — real users are separate people on separate devices.
const SINGLE_SESSION = process.env.SINGLE_SESSION === '1';
const MAX_FAILED_LOGINS = 5;
const REGISTER_PER_HOUR = 3;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;

const CITIES = ['Peshawar', 'Lahore', 'Islamabad'];
const AREAS = {
  Peshawar: ['UET Road', 'University Road', 'Hayatabad'],
  Lahore: ['Johar Town', 'Gulberg', 'Model Town', 'Wapda Town', 'Raiwind Road', 'UET Campus Area'],
  Islamabad: ['Hostel City / Park Road', 'H-8', 'I-8'],
};
const TYPES = ['boys', 'girls', 'family'];
const ROOMS = ['single', 'double', 'triple', 'dorm'];
const FACILITIES = ['WiFi', 'laundry', 'security', 'generator', 'attached bath'];
const MAX_RENT = 500000;
// ---- Phase 3: photos ----
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, 'uploads'));
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_PHOTOS_PER_HOSTEL = 8;
const MAX_PHOTOS_PER_REVIEW = 3; // enforced in Phase 4 (review photos)
const MAX_UPLOADS_PER_DAY = 20; // per manager
const PHOTO_KINDS = ['hostel', 'location', 'room', 'mess', 'review'];
// ---- Phase 4: reviews ----
const REVIEW_CATEGORIES = ['cleanliness', 'food', 'security', 'location', 'value'];
const REJECT_REASONS = ['spam', 'abusive language', 'personal data', 'off-topic', 'fake or staged'];
const REVIEW_HONEST_LABEL = 'Student review — the site has not verified this student lived here.';
const MAX_REVIEWS_PER_DAY = 5;
const MAX_REVIEW_BODY = 2000;
const MAX_REVIEW_TITLE = 120;
const MAX_REPLY = 1000;
// ---- Phase 2: listing fields ----
const AMENITIES = ['wifi', 'mess', 'laundry', 'ac', 'generator', 'geyser', 'parking',
  'cctv', 'security_guard', 'attached_bath', 'fridge', 'tv_lounge', 'library',
  'mineral_water', 'daily_cleaning', 'kitchen_access', 'gym'];
const AMENITY_STATES = ['included', 'charged', 'not_available'];
const AMENITY_LABELS = { wifi: 'WiFi', mess: 'Mess', laundry: 'Laundry', ac: 'AC',
  generator: 'Generator / UPS', geyser: 'Geyser', parking: 'Parking', cctv: 'CCTV',
  security_guard: 'Security guard', attached_bath: 'Attached bath', fridge: 'Fridge',
  tv_lounge: 'TV lounge', library: 'Library', mineral_water: 'Mineral water',
  daily_cleaning: 'Daily cleaning', kitchen_access: 'Kitchen access', gym: 'Gym' };
// Old facilities names derived from amenities on read (only these map).
const AMENITY_TO_FACILITY = { wifi: 'WiFi', laundry: 'laundry', generator: 'generator',
  attached_bath: 'attached bath', security_guard: 'security', cctv: 'security' };
const RENTAL_PERIODS = ['academic_year', 'semester', 'monthly', 'daily', 'mixed'];
const RENTAL_PERIOD_LABELS = { academic_year: 'Academic year', semester: 'Semester',
  monthly: 'Monthly', daily: 'Daily', mixed: 'Mixed (daily + monthly)' };
const MESS_STATUSES = ['active', 'not_available', 'seasonal'];
const FEE_FIELDS = ['security_deposit_pkr', 'advance_pkr', 'admission_fee_pkr',
  'wifi_pkr', 'laundry_pkr', 'ac_pkr', 'electricity_pkr'];

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, city TEXT NOT NULL, area TEXT NOT NULL,
  near_university TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
  room TEXT NOT NULL, rent_pkr INTEGER NOT NULL, price_basis TEXT NOT NULL DEFAULT 'month',
  mess_included INTEGER NOT NULL DEFAULT 0, mess_pkr INTEGER NOT NULL DEFAULT 0,
  meals_per_day INTEGER NOT NULL DEFAULT 0, facilities TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'LISTED',
  last_verified TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL REFERENCES listings(id),
  field TEXT NOT NULL, old_value INTEGER NOT NULL, new_value INTEGER NOT NULL,
  changed_date TEXT NOT NULL DEFAULT (date('now'))
);
CREATE TABLE IF NOT EXISTS "references" (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, figure TEXT NOT NULL,
  source TEXT NOT NULL, date_label TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('master','manager','student')),
  status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','active','suspended','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER, actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '', target_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  categories TEXT NOT NULL DEFAULT '{}',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','approved','rejected','hidden')),
  manager_reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by INTEGER, decided_at TEXT, decide_reason TEXT NOT NULL DEFAULT '',
  UNIQUE(listing_id, student_id)
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('hostel','location','room','mess','review')),
  filename TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by INTEGER, decided_at TEXT, decide_reason TEXT NOT NULL DEFAULT ''
);
`);

// ---- Phase 2: listings ADD COLUMN migrations (old rows keep working;
// every new column defaults to empty/null = "Not available" until a real
// manager fills it). The rental_period / mess_status CHECKs include ''
// (unset) so existing rows pass; the enum itself is enforced in JS too.
const LISTING_COLUMNS = [
  ['owner_id', 'INTEGER REFERENCES users(id)'],
  ['contact_gmail', "TEXT DEFAULT ''"],
  ['contact_phone', "TEXT DEFAULT ''"],
  ['whatsapp', "TEXT DEFAULT ''"],
  ['address', "TEXT DEFAULT ''"],
  ['maps_url', "TEXT DEFAULT ''"],
  ['maps_lat', 'REAL'],
  ['maps_lng', 'REAL'],
  ['plus_code', "TEXT DEFAULT ''"],
  ['distance_text', "TEXT DEFAULT ''"],
  ['security_deposit_pkr', 'INTEGER'],
  ['advance_pkr', 'INTEGER'],
  ['admission_fee_pkr', 'INTEGER'],
  ['wifi_pkr', 'INTEGER'],
  ['laundry_pkr', 'INTEGER'],
  ['ac_pkr', 'INTEGER'],
  ['electricity_pkr', 'INTEGER'],
  ['other_charges', "TEXT DEFAULT '[]'"],
  ['amenities', "TEXT DEFAULT '{}'"],
  ['room_types', "TEXT DEFAULT '[]'"],
  ['rules', "TEXT DEFAULT ''"],
  ['gate_open', "TEXT DEFAULT ''"],
  ['gate_close', "TEXT DEFAULT ''"],
  ['visit_hours', "TEXT DEFAULT ''"],
  ['rental_period', "TEXT DEFAULT '' CHECK(rental_period IN ('','academic_year','semester','monthly','daily','mixed'))"],
  ['available_from', "TEXT DEFAULT ''"],
  ['available_until', "TEXT DEFAULT ''"],
  ['min_stay', "TEXT DEFAULT ''"],
  ['deposit_refund_note', "TEXT DEFAULT ''"],
  ['season_note', "TEXT DEFAULT ''"],
  ['seats_total', 'INTEGER'],
  ['seats_available', 'INTEGER'],
  ['mess_menu', "TEXT DEFAULT ''"],
  ['mess_status', "TEXT DEFAULT '' CHECK(mess_status IN ('','active','not_available','seasonal'))"],
];
function migrateListings() {
  const existing = new Set(db.prepare('PRAGMA table_info(listings)').all().map(c => c.name));
  for (const [name, def] of LISTING_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${def}`);
  }
}
migrateListings();

function today() { return new Date().toISOString().slice(0, 10); }

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM listings').get().c === 0) {
    const ins = db.prepare(`INSERT INTO listings
      (name, city, area, near_university, type, room, rent_pkr, price_basis,
       mess_included, mess_pkr, meals_per_day, facilities, source, status, last_verified)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    // VERIFIED official rows (fee-structure rows, not monthly market rents).
    ins.run('UET Lahore Hostel — Dormitory (subsidized)', 'Lahore', 'UET Campus Area',
      'UET Lahore', 'boys', 'dorm', 11644, 'semester', 0, 0, 0, '[]',
      'Official UET Lahore fee breakup, Fall 2026', 'VERIFIED', '2026-11-04');
    ins.run('UET Lahore Hostel — Cubicle (subsidized)', 'Lahore', 'UET Campus Area',
      'UET Lahore', 'boys', 'single', 15846, 'semester', 0, 0, 0, '[]',
      'Official UET Lahore fee breakup, Fall 2026', 'VERIFIED', '2026-11-04');
    // LISTED named published prices (claims from published pages, not verified by us).
    ins.run('Lahore Hostel (Wapda Town)', 'Lahore', 'Wapda Town', 'PU / UCP area', 'boys',
      'double', 20000, 'month', 1, 0, 3, '["WiFi","security"]',
      'lahorehostel.com — rent with mess Rs 20,000/month', 'LISTED', '');
    ins.run('Professional Lahore Hostels (Model Town)', 'Lahore', 'Model Town', '', 'boys',
      'single', 12000, 'month', 0, 0, 0, '["WiFi","security"]',
      'professionallahorehostels.com — from Rs 12,000/month', 'LISTED', '');
    ins.run('Al Rahman Girls Hostel (Hostel City)', 'Islamabad', 'Hostel City / Park Road', '',
      'girls', 'double', 20500, 'month', 1, 0, 3, '["WiFi","laundry","security"]',
      'alrahmanhostels.com — from Rs 20,500/month all-inclusive', 'LISTED', '');
    ins.run('Boys Hostel near Bahria Orchard', 'Lahore', 'Raiwind Road', 'UOL / PU area', 'boys',
      'triple', 9990, 'month', 0, 0, 0, '["WiFi","security"]',
      'lahorehostel.pk — shared rooms from Rs 9,990/month', 'LISTED', '');
    // EXAMPLE listings (demo only — excluded from default search and all counts).
    ins.run('Example Boys Hostel', 'Peshawar', 'University Road', 'University of Peshawar',
      'boys', 'double', 15000, 'month', 0, 8000, 3, '["WiFi","laundry","security"]',
      'EXAMPLE — demo listing, not a real hostel', 'EXAMPLE', '');
    ins.run('Example Girls Hostel', 'Lahore', 'Johar Town', 'UCP', 'girls', 'triple',
      13000, 'month', 1, 0, 3, '["WiFi","security"]',
      'EXAMPLE — demo listing, not a real hostel', 'EXAMPLE', '');
    ins.run('Example Family Hostel', 'Islamabad', 'H-8', 'NUST', 'family', 'single',
      28000, 'month', 0, 9000, 2, '["WiFi","generator"]',
      'EXAMPLE — demo listing, not a real hostel', 'EXAMPLE', '');
  }
  if (db.prepare('SELECT COUNT(*) c FROM "references"').get().c === 0) {
    const refs = [
      ['Lahore private hostels — budget range', 'PKR 10,000–15,000/month (basic shared rooms)',
       'lahorehostel.pk guide', 'Jan 2026', 'Market range, not one hostel\'s rent.'],
      ['Lahore private hostels — mid-range', 'PKR 16,000–25,000/month (food, WiFi, security)',
       'lahorehostel.pk guide', 'Jan 2026', 'Market range, not one hostel\'s rent.'],
      ['Lahore private hostels — luxury', 'PKR 26,000–45,000/month (private furnished, AC)',
       'lahorehostel.pk guide', 'Jan 2026', 'Market range, not one hostel\'s rent.'],
      ['Islamabad hostels — sharing (3–4 persons)', 'PKR 13,000–18,000/month',
       'houstel.pk 2025 guide', '2025', 'Market range, not one hostel\'s rent.'],
      ['Islamabad hostels — twin sharing', 'PKR 20,000–28,000/month',
       'houstel.pk 2025 guide', '2025', 'Market range, not one hostel\'s rent.'],
      ['Islamabad hostels — single room', 'PKR 30,000–45,000/month',
       'houstel.pk 2025 guide', '2025', 'Market range, not one hostel\'s rent.'],
      ['Islamabad hostels — executive / luxury single', 'PKR 55,000–80,000/month',
       'houstel.pk 2025 guide', '2025', 'Market range, not one hostel\'s rent.'],
      ['Islamabad girls hostels — single', 'PKR 18,000–22,000/month (some branches 21,000–30,000)',
       'xmarla.com Islamabad girls-hostel guide', '2026', 'Market range, not one hostel\'s rent.'],
      ['Islamabad girls hostels — double', 'PKR 14,000–18,000/month (some branches 17,000–22,000)',
       'xmarla.com Islamabad girls-hostel guide', '2026', 'Market range, not one hostel\'s rent.'],
      ['Islamabad girls hostels — triple', 'PKR 12,000–15,000/month (some branches 14,000–17,000)',
       'xmarla.com Islamabad girls-hostel guide', '2026', 'Market range, not one hostel\'s rent.'],
      ['UET Lahore hostel — dormitory (subsidized)', 'Rs 11,644 per semester',
       'Official UET Lahore fee breakup', 'Fall 2026', 'Per semester, not per month. Non-subsidized dormitory: Rs 14,512/semester.'],
      ['UET Lahore hostel — cubicle (subsidized)', 'Rs 15,846 per semester',
       'Official UET Lahore fee breakup', 'Fall 2026', 'Per semester, not per month. Non-subsidized cubicle: Rs 21,582/semester.'],
      ['UET Taxila hostel — first semester', 'About Rs 36,000–40,000 (first semester)',
       'UET Taxila admissions portal', '2025-26', 'First-semester figure, not a monthly rent.'],
      ['UET Peshawar MS Research Hostel', 'Rs 30,000 per year per head (two-seater)',
       'User-reported listing (worldorgs)', 'undated', 'Weaker evidence — a user report, not an official fee page.'],
      ['UET Peshawar hostel mess', 'Runs on a no-profit no-loss basis',
       'UET Peshawar Students Handbook', '2025', 'Mess policy, not a price.'],
      ['Lahore private hostels — top areas', 'Gulberg, Johar Town, Garden Town, Barkat Market are top areas',
       'lahorehostel.pk guide', 'Jan 2026', 'Area note, not a price.'],
    ];
    const r = db.prepare('INSERT INTO "references"(scope, figure, source, date_label, note) VALUES(?,?,?,?,?)');
    for (const row of refs) r.run(...row);
  }
}
seed();

function safeJsonObj(s) { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
function safeJsonArr(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
// Old facilities array, derived from amenities on read: an amenity that is
// included/charged adds its old facility name; one set to not_available
// removes it. Legacy rows (amenities '{}') keep their stored facilities.
function deriveFacilities(stored, amenities) {
  const out = new Set(Array.isArray(stored) ? stored : []);
  for (const [key, val] of Object.entries(amenities || {})) {
    const f = AMENITY_TO_FACILITY[key];
    if (!f || !val || typeof val !== 'object') continue;
    if (val.state === 'not_available') out.delete(f);
    else if (val.state === 'included' || val.state === 'charged') out.add(f);
  }
  return [...out];
}
// No-key Google Maps embed: an embed URL is used as-is; a share URL (or a
// bare address) becomes a maps?q=…&output=embed URL. Never an arbitrary URL.
// A short link (maps.app.goo.gl) cannot be embedded directly — the saved
// link still opens in Google Maps from the detail page, and the embed
// falls back to the street-address search below.
function mapsEmbedUrl(row) {
  const url = (row.maps_url || '').trim();
  if (url) {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/maps/embed')) return url;
      const q = u.searchParams.get('q') || u.searchParams.get('query');
      if (q) return 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed&z=15';
      // Place URLs carry coordinates as /@lat,lng,zoom — embed those.
      const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (at) return 'https://maps.google.com/maps?q=' + at[1] + ',' + at[2] + '&output=embed&z=15';
    } catch { return ''; }
  }
  const addr = (row.address || '').trim();
  if (addr) return 'https://maps.google.com/maps?q=' + encodeURIComponent(addr) + '&output=embed&z=15';
  return '';
}
function publicListing(row) {
  const amenities = safeJsonObj(row.amenities);
  const roomTypes = safeJsonArr(row.room_types);
  const otherCharges = safeJsonArr(row.other_charges);
  const facilities = deriveFacilities(safeJsonArr(row.facilities), amenities);
  // Fee breakdown: every unset charge reads "Not available", never invented.
  const fees = {};
  for (const f of FEE_FIELDS) fees[f] = row[f] === null || row[f] === undefined ? 'Not available' : row[f];
  const phone = (row.whatsapp || row.contact_phone || '').replace(/[\s-]/g, '');
  // A suspended manager's listings stay visible (students still need the
  // information) but are marked honestly — plan Roles rule.
  let managerSuspended = false;
  if (row.owner_id !== null && row.owner_id !== undefined) {
    const owner = db.prepare('SELECT status FROM users WHERE id=?').get(row.owner_id);
    managerSuspended = !!owner && owner.status === 'suspended';
  }
  return {
    ...row,
    facilities, amenities, room_types: roomTypes, other_charges: otherCharges,
    mess_included: row.mess_included === 1, hidden: row.hidden === 1,
    manager_suspended: managerSuspended,
    monthly_rent_equivalent: row.price_basis === 'semester' ? Math.round(row.rent_pkr / 6) : row.rent_pkr,
    fees,
    maps_embed_url: mapsEmbedUrl(row),
    rental_period_display: row.rental_period
      ? (RENTAL_PERIOD_LABELS[row.rental_period] || row.rental_period)
      : 'Rental period not stated',
    whatsapp_url: /^03\d{9}$/.test(phone) ? 'https://wa.me/92' + phone.slice(1) : '',
  };
}
// Monthly total: rent (semester rows converted at /6, labelled as an estimate)
// + mess only when it is charged separately + user extras.
function monthlyTotal(listing, extras) {
  const rent = listing.price_basis === 'semester' ? listing.rent_pkr / 6 : listing.rent_pkr;
  const mess = listing.mess_included ? 0 : listing.mess_pkr;
  return Math.round(rent + mess + (extras || 0));
}

// ---- security headers (every response) ----
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer-when-downgrade',
  'X-Frame-Options': 'SAMEORIGIN',
};
function send(res, code, obj, extra) {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...(extra || {}) });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } });
    req.on('error', reject);
  });
}
// ---- Phase 3: multipart upload (native Node, no dependency — Mandi pattern) ----
// Minimal multipart/form-data parser: text fields as strings, file parts as
// Buffers. Rejects bodies over maxBytes instead of buffering forever.
function parseMultipartBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const ct = req.headers['content-type'] || '';
    const m = ct.match(/multipart\/form-data;\s*boundary=(.+)$/);
    if (!m) return reject(new Error('not multipart'));
    const boundary = Buffer.from('--' + m[1].trim().replace(/^"|"$/g, ''));
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); return fail(new Error('upload too large')); }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const body = Buffer.concat(chunks);
        const fields = {};
        const files = [];
        let start = 0;
        for (;;) {
          const bIdx = body.indexOf(boundary, start);
          if (bIdx === -1) break;
          const partStart = bIdx + boundary.length;
          if (body[partStart] === 45 && body[partStart + 1] === 45) break; // closing --boundary--
          const headEnd = body.indexOf('\r\n\r\n', partStart);
          if (headEnd === -1) break;
          const head = body.slice(partStart, headEnd).toString('utf8');
          const nextB = body.indexOf(boundary, headEnd + 4);
          if (nextB === -1) break;
          const data = body.slice(headEnd + 4, nextB - 2); // strip trailing CRLF
          const nameM = head.match(/name="([^"]*)"/);
          const fileM = head.match(/filename="([^"]*)"/);
          if (nameM && fileM && fileM[1]) {
            const typeM = head.match(/Content-Type:\s*([^\r\n]+)/i);
            files.push({ name: nameM[1], filename: fileM[1], contentType: (typeM ? typeM[1] : '').trim().toLowerCase(), data });
          } else if (nameM) {
            fields[nameM[1]] = data.toString('utf8');
          }
          start = nextB;
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
    req.on('error', fail);
  });
}
// File type by MAGIC BYTES, never by the file name or the claimed MIME
// (vault proof.js pattern, extended with WebP):
// JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP RIFF....WEBP.
function detectImageKind(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
    && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'png';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
    && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  return null;
}
const PHOTO_EXT = { jpeg: '.jpg', png: '.png', webp: '.webp' };
const PHOTO_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
function publicPhoto(row) {
  if (!row) return null;
  return { id: row.id, listing_id: row.listing_id, uploader_id: row.uploader_id,
    kind: row.kind, filename: row.filename, caption: row.caption, status: row.status,
    url: '/api/photos/file/' + row.filename, created_at: row.created_at };
}
// ---- Phase 4: review helpers ----
// Review photos have no review_id column by design (plan): one review per
// student per hostel means (listing_id, uploader_id=student, kind='review')
// identifies a review's photos exactly.
function reviewPhotos(listingId, studentId, onlyApproved) {
  const rows = db.prepare("SELECT * FROM photos WHERE listing_id=? AND uploader_id=? AND kind='review' ORDER BY id")
    .all(listingId, studentId);
  const kept = onlyApproved ? rows.filter(r => r.status === 'approved') : rows;
  return kept.map(publicPhoto);
}
function publicReview(row) {
  const who = row.student_id ? db.prepare('SELECT display_name FROM users WHERE id=?').get(row.student_id) : null;
  const listing = row.listing_id ? db.prepare('SELECT name FROM listings WHERE id=?').get(row.listing_id) : null;
  return { id: row.id, listing_id: row.listing_id,
    listing_name: listing ? listing.name : '',
    reviewer_name: who ? who.display_name : 'Student',
    rating: row.rating, categories: safeJsonObj(row.categories),
    title: row.title, body: row.body, status: row.status,
    manager_reply: row.manager_reply, created_at: row.created_at,
    decided_by: row.decided_by ?? null, decided_at: row.decided_at ?? null,
    decide_reason: row.decide_reason || '',
    photos: reviewPhotos(row.listing_id, row.student_id, true),
    honest_label: REVIEW_HONEST_LABEL };
}
// Average of APPROVED reviews only; unpublished = pending + rejected
// (hidden reviews are the master's own removal, not a moderation count).
function reviewSummary(listingId) {
  const approved = db.prepare("SELECT rating FROM reviews WHERE listing_id=? AND status='approved'").all(listingId);
  const unpublished = db.prepare("SELECT COUNT(*) c FROM reviews WHERE listing_id=? AND status IN ('pending','rejected')").get(listingId).c;
  const avg = approved.length
    ? Math.round((approved.reduce((a, r) => a + r.rating, 0) / approved.length) * 10) / 10
    : null;
  return { average_rating: avg, review_count: approved.length,
    unpublished_review_count: unpublished, honest_label: REVIEW_HONEST_LABEL };
}
// URLs in review text are STRIPPED (never stored as links).
function stripUrls(text) {
  return String(text || '').replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '')
    .replace(/\s{2,}/g, ' ').trim();
}
// Phone numbers / CNIC patterns in review text are rejected outright.
// Pakistani mobile 03XX-XXXXXXX (with optional separators / +92 prefix)
// and CNIC 12345-1234567-1 (dashed or 13 digits together).
function containsPersonalData(text) {
  const s = String(text || '');
  return /(?:\+?92[\s-]?|0)3\d{2}[\s-]?\d{7}\b/.test(s)
    || /\b\d{5}-\d{7}-\d\b/.test(s)
    || /\b\d{13}\b/.test(s);
}
function parseReviewCategories(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: {} };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'invalid categories' };
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (!REVIEW_CATEGORIES.includes(k)) return { ok: false, error: 'unknown category: ' + k };
    const n = toInt(val);
    if (n === null || n < 1 || n > 5) return { ok: false, error: 'category ' + k + ' must be 1–5' };
    out[k] = n;
  }
  return { ok: true, value: out };
}
// Validates review text fields; returns { error } or { error:null, title, body }.
function parseReviewText(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'invalid JSON' };
  const title = b.title === undefined || b.title === null ? '' : b.title;
  if (typeof title !== 'string' || title.length > MAX_REVIEW_TITLE) return { error: 'title too long (max 120 characters)' };
  if (typeof b.body !== 'string' || !b.body.trim()) return { error: 'review text required' };
  if (b.body.length > MAX_REVIEW_BODY) return { error: 'review text too long (max 2000 characters)' };
  if (containsPersonalData(b.body)) return { error: 'review text must not contain a phone number or CNIC number' };
  const body = stripUrls(b.body);
  if (!body) return { error: 'review text required' };
  return { error: null, title: title.trim(), body };
}
// Sets every pending photo of a review to `status`; used when a review is
// approved (photos go public with it), rejected (photos rejected too) or
// hidden (photos go back to pending so they are not served publicly — the
// photos table has no 'hidden' status).
function setReviewPhotosStatus(review, status, reason) {
  if (status === 'pending') {
    // Hiding a review: its approved photos go back to pending so they are
    // not served publicly (the photos table has no 'hidden' status).
    db.prepare("UPDATE photos SET status='pending', decide_reason=? WHERE listing_id=? AND uploader_id=? AND kind='review' AND status='approved'")
      .run(reason || '', review.listing_id, review.student_id);
    return;
  }
  db.prepare("UPDATE photos SET status=?, decide_reason=? WHERE listing_id=? AND uploader_id=? AND kind='review' AND status='pending'")
    .run(status, reason || '', review.listing_id, review.student_id);
  if (status === 'approved') {
    db.prepare("UPDATE photos SET status='approved', decide_reason=? WHERE listing_id=? AND uploader_id=? AND kind='review' AND status='rejected'")
      .run(reason || '', review.listing_id, review.student_id);
  }
  if (status === 'rejected') {
    // A review rejected AFTER approval (manager changed their mind, or the
    // master hid it first): its already-approved photos must stop being
    // public too — otherwise the photos would keep showing in the gallery
    // with no review attached.
    db.prepare("UPDATE photos SET status='rejected', decide_reason=? WHERE listing_id=? AND uploader_id=? AND kind='review' AND status='approved'")
      .run(reason || '', review.listing_id, review.student_id);
  }
}
// Deletes the stored file for a photo row. The path guard (basename +
// startsWith) means a hostile filename can never escape the uploads dir.
function deletePhotoFile(filename) {
  try {
    const full = path.join(UPLOADS_DIR, path.basename(String(filename || '')));
    if (full.startsWith(UPLOADS_DIR + path.sep)) fs.unlinkSync(full);
  } catch { /* already gone — the row delete still proceeds */ }
}
function isAdmin(req) { return req.headers['x-admin-code'] === ADMIN_CODE; }
function isMaster(req) { return req.headers['x-master-code'] === ADMIN_CODE; }
function serveFile(res, file, type) {
  const p = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(p)) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type });
  fs.createReadStream(p).pipe(res);
}

// ---- crypto helpers (Bijli pattern) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const hash = Buffer.from(parts[2], 'hex');
    const test = crypto.scryptSync(password, salt, 64);
    return hash.length === test.length && crypto.timingSafeEqual(hash, test);
  } catch { return false; }
}
function hmacHex(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
function signToken(token) {
  return token + '.' + hmacHex(token, SESSION_SECRET);
}
function verifySignedToken(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const token = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expect = hmacHex(token, SESSION_SECRET);
  if (sig.length !== expect.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch { return null; }
  return token;
}

// ---- sessions / cookies ----
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const token = verifySignedToken(parseCookies(req).hostel_session);
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hmacHex(token, SESSION_SECRET));
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hmacHex(token, SESSION_SECRET));
    return null;
  }
  const user = db.prepare('SELECT id, gmail, display_name, phone, role, status, created_at FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}
function setSessionCookie(res, user) {
  const token = newSessionToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  // Drop long-dead sessions so the table does not grow forever.
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES(?,?,?)')
    .run(user.id, hmacHex(token, SESSION_SECRET), expiresAt);
  return 'hostel_session=' + signToken(token) + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + SESSION_TTL_SECONDS;
}
function clearSessionCookie(req, res) {
  const token = verifySignedToken(parseCookies(req).hostel_session);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hmacHex(token, SESSION_SECRET));
  return 'hostel_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';
}
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, display_name: u.display_name, role: u.role, status: u.status };
}

// ---- validation ----
function validGmail(g) {
  return typeof g === 'string' && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(g.trim());
}
// Unknown JSON fields are rejected on every boundary (plan security
// checklist). Returns the error string, or null when the body is clean.
function unknownField(b, allowed) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'invalid JSON';
  for (const k of Object.keys(b)) if (!allowed.includes(k)) return 'unknown field: ' + k;
  return null;
}
function normalizePhone(raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^03\d{9}$/.test(digits)) return null;
  return digits;
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}
// CSRF: SameSite=Lax cookies are the main defence; on cookie-authenticated
// POSTs, a present Origin that does not match this host is rejected.
// Requests with no Origin (curl, tests, same-origin navigations) pass.
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers.host || '';
    return o.host === host;
  } catch { return false; }
}

// ---- login rate limiting (in-memory per IP, Bijli pattern) ----
const ipFails = new Map(); // ip -> { count, firstAt, blockedUntil }
function ipBlocked(ip) {
  const rec = ipFails.get(ip);
  if (!rec) return false;
  const now = Date.now();
  if (rec.blockedUntil && now < rec.blockedUntil) return true;
  if (now - rec.firstAt > 10 * 60 * 1000) ipFails.delete(ip);
  return false;
}
function ipFail(ip) {
  const now = Date.now();
  const rec = ipFails.get(ip) || { count: 0, firstAt: now, blockedUntil: 0 };
  if (now - rec.firstAt > 10 * 60 * 1000) { rec.count = 0; rec.firstAt = now; rec.blockedUntil = 0; }
  rec.count++;
  if (rec.count >= MAX_FAILED_LOGINS) rec.blockedUntil = now + LOGIN_LOCK_SECONDS * 1000;
  ipFails.set(ip, rec);
}
function ipReset(ip) { ipFails.delete(ip); }

// ---- registration rate limiting: 3 attempts/hour per IP ----
const regAttempts = new Map(); // ip -> { count, firstAt }
function registerBlocked(ip) {
  const rec = regAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > REGISTER_WINDOW_MS) { regAttempts.delete(ip); return false; }
  return rec.count >= REGISTER_PER_HOUR;
}
function registerHit(ip) {
  const now = Date.now();
  const rec = regAttempts.get(ip) || { count: 0, firstAt: now };
  if (now - rec.firstAt > REGISTER_WINDOW_MS) { rec.count = 0; rec.firstAt = now; }
  rec.count++;
  regAttempts.set(ip, rec);
}

// ---- upload rate limiting: 100 attempts/hour per IP (both upload
// endpoints) ----
// Per-account caps already bound uploads (20/day per manager, 3 per
// review), but one IP could still drive many approved accounts at once.
// 100/hour is far above any honest burst — a manager's whole daily
// allowance is 20 — yet it stops a single network flooding the disk
// with 5 MB files. Shared university/hostel WiFi stays well under it.
// Env-overridable so tests can prove the 429 with a small limit.
const UPLOAD_IP_LIMIT_PER_HOUR = Number(process.env.UPLOAD_IP_LIMIT_PER_HOUR || 100);
const uploadIpHits = new Map(); // ip -> { count, firstAt }
function uploadIpBlocked(ip) {
  const rec = uploadIpHits.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > 60 * 60 * 1000) { uploadIpHits.delete(ip); return false; }
  return rec.count >= UPLOAD_IP_LIMIT_PER_HOUR;
}
function uploadIpHit(ip) {
  const now = Date.now();
  const rec = uploadIpHits.get(ip) || { count: 0, firstAt: now };
  if (now - rec.firstAt > 60 * 60 * 1000) { rec.count = 0; rec.firstAt = now; }
  rec.count++;
  uploadIpHits.set(ip, rec);
}
function uploadIpCheck(req, res) {
  const ip = clientIp(req);
  if (uploadIpBlocked(ip)) {
    send(res, 429, { error: 'too many uploads from this network — try again later' });
    return false;
  }
  uploadIpHit(ip);
  return true;
}

// ---- audit ----
function audit(action, actorId, actorRole, targetType, targetId, detail) {
  db.prepare('INSERT INTO audit(actor_id, actor_role, action, target_type, target_id, detail) VALUES(?,?,?,?,?,?)')
    .run(actorId ?? null, actorRole || '', action, targetType || '', targetId ?? null, detail || '');
}

// ---- Phase 2: listing-field validation (manager + master-assign) ----
const LISTING_EDITABLE = ['name', 'city', 'area', 'near_university', 'type', 'room', 'rent_pkr',
  'price_basis', 'mess_included', 'mess_pkr', 'meals_per_day', 'facilities', 'source',
  'contact_gmail', 'contact_phone', 'whatsapp', 'address', 'maps_url', 'maps_lat', 'maps_lng',
  'plus_code', 'distance_text', 'security_deposit_pkr', 'advance_pkr', 'admission_fee_pkr',
  'wifi_pkr', 'laundry_pkr', 'ac_pkr', 'electricity_pkr', 'other_charges', 'amenities',
  'room_types', 'rules', 'gate_open', 'gate_close', 'visit_hours', 'rental_period',
  'available_from', 'available_until', 'min_stay', 'deposit_refund_note', 'season_note',
  'seats_total', 'seats_available', 'mess_menu', 'mess_status'];
// Price-history fields: every manager price edit writes a row for each of
// these that changed, plus per-room-type rent as `room_types:<room>`.
const TRACKED_FEE_FIELDS = ['rent_pkr', 'mess_pkr', 'security_deposit_pkr', 'advance_pkr',
  'admission_fee_pkr', 'wifi_pkr', 'laundry_pkr', 'ac_pkr', 'electricity_pkr'];

// Map URL validation: host must be google.com / www.google.com /
// maps.google.com / maps.app.goo.gl (the short link the Google Maps
// app itself shares) AND the path must be a Maps embed/share URL.
// Anything else is rejected — no arbitrary iframes in any visitor's
// page.
function validMapsUrl(raw) {
  if (raw === '' || raw === null || raw === undefined) return true;
  if (typeof raw !== 'string') return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host !== 'google.com' && host !== 'www.google.com' && host !== 'maps.google.com'
    && host !== 'maps.app.goo.gl') return false;
  if (host === 'maps.app.goo.gl') return true; // short share link, any path
  return u.pathname === '/maps' || u.pathname.startsWith('/maps/');
}
function validDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}
// ''/null/undefined -> null (clear the field); anything else must be an
// integer inside [min, max].
function optInt(v, min, max) {
  if (v === '' || v === null || v === undefined) return { ok: true, value: null };
  const n = toInt(v);
  if (n === null || n < min || n > max) return { ok: false };
  return { ok: true, value: n };
}
// Validates a manager create (existing=null) or edit (existing=row).
// Returns { error } or { error: null, updates } where updates maps DB
// column -> value for only the fields the caller sent.
function parseListingInput(b, existing) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'invalid JSON' };
  for (const k of Object.keys(b)) {
    if (!LISTING_EDITABLE.includes(k)) return { error: 'unknown field: ' + k };
  }
  const isCreate = !existing;
  const has = k => b[k] !== undefined;
  const updates = {};
  const err = m => ({ error: m });

  if (isCreate || has('name')) {
    if (typeof b.name !== 'string' || b.name.trim().length < 3 || b.name.trim().length > 100)
      return err('name required (3–100 characters)');
    updates.name = b.name.trim();
  }
  const effCity = has('city') ? b.city : (existing ? existing.city : null);
  if (isCreate || has('city')) {
    if (!CITIES.includes(b.city)) return err('invalid city');
    updates.city = b.city;
  }
  if (isCreate || has('area')) {
    if (typeof b.area !== 'string' || !effCity || !AREAS[effCity] || !AREAS[effCity].includes(b.area))
      return err('invalid area for city');
    updates.area = b.area;
  }
  // City-only edit: the listing's existing area must belong to the new
  // city, or the row ends up claiming e.g. a Lahore area in Islamabad.
  if (has('city') && !has('area') && existing && existing.area) {
    if (!AREAS[b.city] || !AREAS[b.city].includes(existing.area))
      return err('area does not belong to city — send area too');
  }
  if (has('near_university')) {
    if (typeof b.near_university !== 'string' || b.near_university.length > 200) return err('near_university too long (max 200)');
    updates.near_university = b.near_university;
  }
  if (isCreate || has('type')) {
    if (!TYPES.includes(b.type)) return err('invalid type');
    updates.type = b.type;
  }
  if (isCreate || has('room')) {
    if (!ROOMS.includes(b.room)) return err('invalid room');
    updates.room = b.room;
  }
  if (has('price_basis')) {
    if (b.price_basis !== 'month' && b.price_basis !== 'semester') return err('invalid price_basis');
    updates.price_basis = b.price_basis;
  }
  if (isCreate || has('rent_pkr')) {
    const n = toInt(b.rent_pkr);
    if (n === null || n <= 0 || n >= MAX_RENT) return err('invalid rent');
    updates.rent_pkr = n;
  }
  if (has('mess_pkr')) {
    const r = optInt(b.mess_pkr, 0, MAX_RENT - 1);
    if (!r.ok) return err('invalid mess price');
    updates.mess_pkr = r.value === null ? 0 : r.value;
  }
  if (has('meals_per_day')) {
    const r = optInt(b.meals_per_day, 0, 10);
    if (!r.ok) return err('invalid meals_per_day');
    updates.meals_per_day = r.value === null ? 0 : r.value;
  }
  if (has('mess_included')) {
    if (typeof b.mess_included !== 'boolean' && b.mess_included !== 0 && b.mess_included !== 1) return err('invalid mess_included');
    updates.mess_included = b.mess_included ? 1 : 0;
  }
  if (has('facilities')) {
    if (!Array.isArray(b.facilities) || b.facilities.length > 10 || b.facilities.some(f => !FACILITIES.includes(f))) return err('invalid facilities');
    updates.facilities = JSON.stringify(b.facilities);
  }
  if (has('source')) {
    if (typeof b.source !== 'string' || b.source.length > 500) return err('source too long (max 500)');
    updates.source = b.source;
  }
  // Contact: Gmail format; phones are Pakistani mobiles (03XX-XXXXXXX).
  if (has('contact_gmail')) {
    if (typeof b.contact_gmail !== 'string' || b.contact_gmail.length > 200) return err('invalid contact Gmail');
    const g = b.contact_gmail.trim();
    if (g !== '' && !validGmail(g)) return err('invalid contact Gmail');
    updates.contact_gmail = g.toLowerCase();
  }
  for (const key of ['contact_phone', 'whatsapp']) {
    if (has(key)) {
      if (typeof b[key] !== 'string') return err('invalid ' + key);
      const ph = normalizePhone(b[key]);
      if (ph === null) return err('invalid ' + key + ' — Pakistani mobile, 03XX-XXXXXXX');
      updates[key] = ph;
    }
  }
  if (has('address')) {
    if (typeof b.address !== 'string' || b.address.length > 500) return err('address too long (max 500)');
    updates.address = b.address;
  }
  if (has('maps_url')) {
    if (typeof b.maps_url !== 'string' || b.maps_url.length > 2000 || !validMapsUrl(b.maps_url)) return err('invalid maps URL — paste a Google Maps share or embed link');
    updates.maps_url = b.maps_url;
  }
  if (has('maps_lat')) {
    const v = b.maps_lat;
    if (v === '' || v === null || v === undefined) updates.maps_lat = null;
    else { const n = Number(v); if (!Number.isFinite(n) || n < -90 || n > 90) return err('invalid maps_lat'); updates.maps_lat = n; }
  }
  if (has('maps_lng')) {
    const v = b.maps_lng;
    if (v === '' || v === null || v === undefined) updates.maps_lng = null;
    else { const n = Number(v); if (!Number.isFinite(n) || n < -180 || n > 180) return err('invalid maps_lng'); updates.maps_lng = n; }
  }
  if (has('plus_code')) {
    if (typeof b.plus_code !== 'string' || b.plus_code.length > 20) return err('plus_code too long (max 20)');
    updates.plus_code = b.plus_code;
  }
  if (has('distance_text')) {
    if (typeof b.distance_text !== 'string' || b.distance_text.length > 120) return err('distance_text too long (max 120)');
    updates.distance_text = b.distance_text;
  }
  // Fee fields: null = "Not available" until the manager sets a number.
  for (const f of FEE_FIELDS) {
    if (has(f)) {
      const r = optInt(b[f], 0, MAX_RENT - 1);
      if (!r.ok) return err('invalid ' + f);
      updates[f] = r.value;
    }
  }
  if (has('other_charges')) {
    if (!Array.isArray(b.other_charges) || b.other_charges.length > 10) return err('invalid other_charges');
    for (const it of b.other_charges) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) return err('invalid other_charges');
      if (Object.keys(it).some(k => !['label', 'amount_pkr'].includes(k))) return err('unknown field in other_charges');
      if (typeof it.label !== 'string' || !it.label.trim() || it.label.trim().length > 60) return err('other charge label required (max 60)');
      const n = toInt(it.amount_pkr);
      if (n === null || n < 0 || n >= MAX_RENT) return err('invalid other charge amount');
    }
    updates.other_charges = JSON.stringify(b.other_charges.map(it => ({ label: it.label.trim(), amount_pkr: toInt(it.amount_pkr) })));
  }
  if (has('amenities')) {
    if (!b.amenities || typeof b.amenities !== 'object' || Array.isArray(b.amenities)) return err('invalid amenities');
    const norm = {};
    for (const [k, v] of Object.entries(b.amenities)) {
      if (!AMENITIES.includes(k)) return err('unknown amenity: ' + k);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return err('invalid amenity: ' + k);
      if (Object.keys(v).some(x => !['state', 'price'].includes(x))) return err('unknown field in amenity: ' + k);
      if (!AMENITY_STATES.includes(v.state)) return err('invalid amenity state: ' + k);
      let price = null;
      if (v.state === 'charged') {
        const r = optInt(v.price, 0, MAX_RENT - 1);
        if (!r.ok) return err('invalid amenity price: ' + k);
        price = r.value;
      }
      norm[k] = { state: v.state, price };
    }
    updates.amenities = JSON.stringify(norm);
  }
  if (has('room_types')) {
    if (!Array.isArray(b.room_types) || b.room_types.length > 10) return err('invalid room_types');
    const norm = [];
    for (const it of b.room_types) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) return err('invalid room_types');
      if (Object.keys(it).some(k => !['room', 'rent_pkr', 'seats', 'mess_included', 'mess_pkr'].includes(k))) return err('unknown field in room_types');
      if (!ROOMS.includes(it.room)) return err('invalid room in room_types');
      const rent = toInt(it.rent_pkr);
      if (rent === null || rent <= 0 || rent >= MAX_RENT) return err('invalid rent in room_types');
      const seats = it.seats === undefined ? null : optInt(it.seats, 0, 1000);
      if (seats && !seats.ok) return err('invalid seats in room_types');
      const mess = it.mess_pkr === undefined ? null : optInt(it.mess_pkr, 0, MAX_RENT - 1);
      if (mess && !mess.ok) return err('invalid mess price in room_types');
      norm.push({ room: it.room, rent_pkr: rent, seats: seats ? seats.value : null,
        mess_included: it.mess_included ? true : false, mess_pkr: mess ? mess.value : null });
    }
    updates.room_types = JSON.stringify(norm);
  }
  if (has('rules')) {
    if (typeof b.rules !== 'string' || b.rules.length > 2000) return err('rules too long (max 2000)');
    updates.rules = b.rules;
  }
  for (const key of ['gate_open', 'gate_close']) {
    if (has(key)) {
      if (typeof b[key] !== 'string' || (b[key] !== '' && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(b[key]))) return err('invalid ' + key + ' — use HH:MM');
      updates[key] = b[key];
    }
  }
  if (has('visit_hours')) {
    if (typeof b.visit_hours !== 'string' || b.visit_hours.length > 200) return err('visit_hours too long (max 200)');
    updates.visit_hours = b.visit_hours;
  }
  if (has('rental_period')) {
    if (typeof b.rental_period !== 'string' || (b.rental_period !== '' && !RENTAL_PERIODS.includes(b.rental_period))) return err('invalid rental_period');
    updates.rental_period = b.rental_period;
  }
  const effFrom = has('available_from') ? b.available_from : (existing ? existing.available_from : '');
  const effUntil = has('available_until') ? b.available_until : (existing ? existing.available_until : '');
  for (const key of ['available_from', 'available_until']) {
    if (has(key)) {
      if (typeof b[key] !== 'string' || (b[key] !== '' && !validDateStr(b[key]))) return err('invalid ' + key + ' — use YYYY-MM-DD');
      updates[key] = b[key];
    }
  }
  if (effFrom && effUntil && effFrom > effUntil) return err('available_from must be on or before available_until');
  if (has('min_stay')) {
    if (typeof b.min_stay !== 'string' || b.min_stay.length > 100) return err('min_stay too long (max 100)');
    updates.min_stay = b.min_stay;
  }
  if (has('deposit_refund_note')) {
    if (typeof b.deposit_refund_note !== 'string' || b.deposit_refund_note.length > 500) return err('deposit_refund_note too long (max 500)');
    updates.deposit_refund_note = b.deposit_refund_note;
  }
  if (has('season_note')) {
    if (typeof b.season_note !== 'string' || b.season_note.length > 500) return err('season_note too long (max 500)');
    updates.season_note = b.season_note;
  }
  const effTotal = has('seats_total') ? b.seats_total : (existing ? existing.seats_total : null);
  const effAvail = has('seats_available') ? b.seats_available : (existing ? existing.seats_available : null);
  for (const key of ['seats_total', 'seats_available']) {
    if (has(key)) {
      const r = optInt(b[key], 0, 10000);
      if (!r.ok) return err('invalid ' + key);
      updates[key] = r.value;
    }
  }
  const totN = effTotal === '' || effTotal === null || effTotal === undefined ? null : toInt(effTotal);
  const avN = effAvail === '' || effAvail === null || effAvail === undefined ? null : toInt(effAvail);
  if (totN !== null && avN !== null && avN > totN) return err('seats_available cannot exceed seats_total');
  if (has('mess_menu')) {
    if (typeof b.mess_menu !== 'string' || b.mess_menu.length > 2000) return err('mess_menu too long (max 2000)');
    updates.mess_menu = b.mess_menu;
  }
  if (has('mess_status')) {
    if (typeof b.mess_status !== 'string' || (b.mess_status !== '' && !MESS_STATUSES.includes(b.mess_status))) return err('invalid mess_status');
    updates.mess_status = b.mess_status;
  }
  return { error: null, updates };
}

function requireManager(req, res) {
  const user = sessionUser(req);
  if (!user) { send(res, 401, { error: 'not logged in' }); return null; }
  if (user.role !== 'manager') { send(res, 403, { error: 'managers only' }); return null; }
  return user;
}
function requireStudent(req, res) {
  const user = sessionUser(req);
  if (!user) { send(res, 401, { error: 'not logged in' }); return null; }
  if (user.role !== 'student') { send(res, 403, { error: 'students only' }); return null; }
  return user;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'GET' && p === '/') return serveFile(res, 'index.html', 'text/html');
  if (req.method === 'GET' && p === '/admin') return serveFile(res, 'admin.html', 'text/html');
  if (req.method === 'GET' && p === '/login') return serveFile(res, 'login.html', 'text/html');
  if (req.method === 'GET' && p === '/login-student') return serveFile(res, 'login-student.html', 'text/html');
  if (req.method === 'GET' && p === '/login-manager') return serveFile(res, 'login-manager.html', 'text/html');
  if (req.method === 'GET' && p === '/manager') return serveFile(res, 'manager.html', 'text/html');
  if (req.method === 'GET' && p === '/hostel') return serveFile(res, 'hostel.html', 'text/html');
  if (req.method === 'GET' && p === '/hostel.js') return serveFile(res, 'hostel.js', 'text/javascript');
  if (req.method === 'GET' && p === '/app.js') return serveFile(res, 'app.js', 'text/javascript');
  if (req.method === 'GET' && p === '/admin.js') return serveFile(res, 'admin.js', 'text/javascript');
  if (req.method === 'GET' && p === '/login-student.js') return serveFile(res, 'login-student.js', 'text/javascript');
  if (req.method === 'GET' && p === '/login-manager.js') return serveFile(res, 'login-manager.js', 'text/javascript');
  if (req.method === 'GET' && p === '/shell.js') return serveFile(res, 'shell.js', 'text/javascript');
  if (req.method === 'GET' && p === '/manager.js') return serveFile(res, 'manager.js', 'text/javascript');
  if (req.method === 'GET' && p === '/styles.css') return serveFile(res, 'styles.css', 'text/css');
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });

  if (req.method === 'GET' && p === '/api/meta') {
    return send(res, 200, { cities: CITIES, areas: AREAS, types: TYPES, rooms: ROOMS, facilities: FACILITIES,
      amenities: AMENITIES, amenity_labels: AMENITY_LABELS, amenity_states: AMENITY_STATES,
      rental_periods: RENTAL_PERIODS, rental_period_labels: RENTAL_PERIOD_LABELS,
      mess_statuses: MESS_STATUSES, fee_fields: FEE_FIELDS });
  }
  if (req.method === 'GET' && p === '/api/reference') {
    return send(res, 200, { references: db.prepare('SELECT * FROM "references" ORDER BY id').all() });
  }

  // ---- auth ----
  if (req.method === 'POST' && p === '/api/auth/register') {
    const ip = clientIp(req);
    if (registerBlocked(ip)) return send(res, 429, { error: 'too many registrations — try again later' });
    registerHit(ip);
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const allowed = ['gmail', 'password', 'display_name', 'phone', 'role'];
    if (Object.keys(b).some(k => !allowed.includes(k))) return send(res, 400, { error: 'unknown field' });
    if (!validGmail(b.gmail)) return send(res, 400, { error: 'invalid Gmail' });
    const gmail = b.gmail.trim().toLowerCase();
    if (typeof b.password !== 'string' || b.password.length < 8) return send(res, 400, { error: 'password must be at least 8 characters' });
    if (typeof b.display_name !== 'string' || !b.display_name.trim() || b.display_name.trim().length > 100) return send(res, 400, { error: 'display name required (max 100 characters)' });
    if (b.role !== 'manager' && b.role !== 'student') return send(res, 400, { error: 'role must be manager or student' });
    const phone = normalizePhone(b.phone);
    if (phone === null) return send(res, 400, { error: 'invalid phone — Pakistani mobile, 03XX-XXXXXXX' });
    if (db.prepare('SELECT id FROM users WHERE gmail=?').get(gmail)) return send(res, 409, { error: 'Gmail already registered' });
    const status = b.role === 'manager' ? 'pending' : 'active';
    const info = db.prepare(`INSERT INTO users(gmail, password_hash, display_name, phone, role, status)
      VALUES(?,?,?,?,?,?)`).run(gmail, hashPassword(b.password), b.display_name.trim(), phone, b.role, status);
    const id = Number(info.lastInsertRowid);
    audit('user.registered', id, b.role, 'user', id, 'role=' + b.role + ',status=' + status);
    return send(res, 201, { id, display_name: b.display_name.trim(), role: b.role, status });
  }

  if (req.method === 'POST' && p === '/api/auth/login') {
    const ip = clientIp(req);
    if (ipBlocked(ip)) return send(res, 429, { error: 'too many failed attempts — try again later' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['gmail', 'password']);
    if (uf) return send(res, 400, { error: uf });
    const gmail = typeof b.gmail === 'string' ? b.gmail.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const nowSec = Math.floor(Date.now() / 1000);
    const user = db.prepare('SELECT * FROM users WHERE gmail=?').get(gmail);
    // Generic error on every failure — never say whether the account exists.
    if (!user) { ipFail(ip); return send(res, 401, { error: 'invalid Gmail or password' }); }
    if (user.status !== 'active') return send(res, 401, { error: 'invalid Gmail or password' });
    if (user.locked_until && user.locked_until > nowSec) return send(res, 429, { error: 'account temporarily locked after too many failed attempts — try again later' });
    if (!verifyPassword(password, user.password_hash)) {
      const attempts = (user.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= MAX_FAILED_LOGINS ? nowSec + LOGIN_LOCK_SECONDS : 0;
      db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?').run(attempts, lockedUntil, user.id);
      ipFail(ip);
      return send(res, 401, { error: 'invalid Gmail or password' });
    }
    db.prepare('UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=?').run(user.id);
    ipReset(ip);
    // Testing-only single session (SINGLE_SESSION=1): one login at a
    // time — every other session dies here, so logging in as one role
    // logs the other role out while testing on one PC. The new session
    // is created after this delete, so it always survives.
    if (SINGLE_SESSION) db.prepare('DELETE FROM sessions').run();
    const cookie = setSessionCookie(res, user);
    return send(res, 200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': cookie });
  }

  if (req.method === 'POST' && p === '/api/auth/logout') {
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const cookie = clearSessionCookie(req, res);
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (req.method === 'GET' && p === '/api/auth/me') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'not logged in' });
    return send(res, 200, { id: user.id, display_name: user.display_name, role: user.role, status: user.status });
  }

  if (req.method === 'POST' && p === '/api/auth/change-password') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'not logged in' });
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['old_password', 'new_password']);
    if (uf) return send(res, 400, { error: uf });
    if (typeof b.old_password !== 'string' || typeof b.new_password !== 'string') return send(res, 400, { error: 'old and new password required' });
    if (b.new_password.length < 8) return send(res, 400, { error: 'new password must be at least 8 characters' });
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!row || !verifyPassword(b.old_password, row.password_hash)) return send(res, 401, { error: 'invalid Gmail or password' });
    db.prepare('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=0 WHERE id=?')
      .run(hashPassword(b.new_password), user.id);
    // A password change means the old password may be compromised, so
    // EVERY session dies — including this browser's — and the changing
    // browser gets a fresh session cookie back (Bijli pattern). Any
    // other device or browser is signed out at once.
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    const cookie = setSessionCookie(res, user);
    audit('user.password_changed', user.id, user.role, 'user', user.id, '');
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  // ---- master (X-Master-Code header, fail-closed) ----
  if (req.method === 'GET' && p === '/api/master/managers') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const status = u.searchParams.get('status') || 'pending';
    const cols = 'id, gmail, display_name, phone, role, status, created_at';
    if (status === 'all') {
      return send(res, 200, { managers: db.prepare(`SELECT ${cols} FROM users WHERE role='manager' ORDER BY id`).all() });
    }
    if (!['pending', 'active', 'suspended', 'rejected'].includes(status)) return send(res, 400, { error: 'invalid status' });
    return send(res, 200, { managers: db.prepare(`SELECT ${cols} FROM users WHERE role=? AND status=? ORDER BY id`).all('manager', status) });
  }

  if (req.method === 'POST' && p === '/api/master/managers/decide') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b || (b.decision !== 'approve' && b.decision !== 'reject')) return send(res, 400, { error: 'decision must be approve or reject' });
    const uf = unknownField(b, ['user_id', 'decision', 'reason']);
    if (uf) return send(res, 400, { error: uf });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b.user_id));
    if (!user) return send(res, 404, { error: 'not found' });
    if (user.role !== 'manager') return send(res, 400, { error: 'not a manager account' });
    if (user.status === 'rejected' && b.decision === 'approve') return send(res, 400, { error: 'rejected decision is final' });
    const reason = typeof b.reason === 'string' ? b.reason.slice(0, 500) : '';
    if (b.decision === 'approve') {
      db.prepare("UPDATE users SET status='active', failed_attempts=0, locked_until=0 WHERE id=?").run(user.id);
      audit('manager.approved', null, 'master', 'user', user.id, reason);
      return send(res, 200, { ok: true, status: 'active' });
    }
    db.prepare("UPDATE users SET status='rejected' WHERE id=?").run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    audit('manager.rejected', null, 'master', 'user', user.id, reason);
    return send(res, 200, { ok: true, status: 'rejected' });
  }

  if (req.method === 'POST' && p === '/api/master/managers/suspend') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['user_id']);
    if (uf) return send(res, 400, { error: uf });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b && b.user_id));
    if (!user) return send(res, 404, { error: 'not found' });
    if (user.role !== 'manager') return send(res, 400, { error: 'not a manager account' });
    db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    audit('manager.suspended', null, 'master', 'user', user.id, '');
    return send(res, 200, { ok: true, status: 'suspended' });
  }

  if (req.method === 'POST' && p === '/api/master/managers/reinstate') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['user_id']);
    if (uf) return send(res, 400, { error: uf });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b && b.user_id));
    if (!user) return send(res, 404, { error: 'not found' });
    if (user.role !== 'manager') return send(res, 400, { error: 'not a manager account' });
    if (user.status === 'rejected') return send(res, 400, { error: 'rejected decision is final' });
    db.prepare("UPDATE users SET status='active', failed_attempts=0, locked_until=0 WHERE id=?").run(user.id);
    audit('manager.reinstated', null, 'master', 'user', user.id, '');
    return send(res, 200, { ok: true, status: 'active' });
  }

  if (req.method === 'POST' && p === '/api/master/password-reset') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b || typeof b.new_password !== 'string' || b.new_password.length < 8) return send(res, 400, { error: 'new password must be at least 8 characters' });
    const uf = unknownField(b, ['user_id', 'new_password']);
    if (uf) return send(res, 400, { error: uf });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b.user_id));
    if (!user) return send(res, 404, { error: 'not found' });
    db.prepare('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=0 WHERE id=?')
      .run(hashPassword(b.new_password), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    audit('user.password_reset', null, 'master', 'user', user.id, '');
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/master/audit') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const rows = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all();
    return send(res, 200, { audit: rows });
  }

  // Master assigns an ownerless legacy listing to an active manager.
  // 400 if the listing already has an owner, or the user is not an
  // active manager. No claim button exists — the master assigns.
  if (req.method === 'POST' && p === '/api/master/listings/assign') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const ufAssign = unknownField(b, ['listing_id', 'manager_id']);
    if (ufAssign) return send(res, 400, { error: ufAssign });
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(Number(b.listing_id));
    if (!listing) return send(res, 404, { error: 'not found' });
    if (listing.owner_id !== null && listing.owner_id !== undefined) return send(res, 400, { error: 'listing already has a manager' });
    const mgr = db.prepare('SELECT * FROM users WHERE id=?').get(Number(b.manager_id));
    if (!mgr) return send(res, 404, { error: 'not found' });
    if (mgr.role !== 'manager') return send(res, 400, { error: 'not a manager account' });
    if (mgr.status !== 'active') return send(res, 400, { error: 'manager is not active' });
    db.prepare('UPDATE listings SET owner_id=? WHERE id=?').run(mgr.id, listing.id);
    audit('listing.assigned', null, 'master', 'listing', listing.id, 'manager_id=' + mgr.id);
    return send(res, 200, { ok: true, listing_id: listing.id, manager_id: mgr.id });
  }

  // Master restores a hidden listing (e.g. one a manager hid by mistake).
  if (req.method === 'POST' && p === '/api/master/listings/restore') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const ufRestore = unknownField(b, ['listing_id']);
    if (ufRestore) return send(res, 400, { error: ufRestore });
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(Number(b.listing_id));
    if (!listing) return send(res, 404, { error: 'not found' });
    db.prepare('UPDATE listings SET hidden=0 WHERE id=?').run(listing.id);
    audit('listing.restored', null, 'master', 'listing', listing.id, '');
    return send(res, 200, { ok: true });
  }

  // ---- Phase 4: student reviews ----
  if (req.method === 'POST' && p === '/api/reviews') {
    const user = requireStudent(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const allowed = ['listing_id', 'rating', 'categories', 'title', 'body'];
    if (Object.keys(b).some(k => !allowed.includes(k))) return send(res, 400, { error: 'unknown field' });
    const listingId = toInt(b.listing_id);
    if (listingId === null || listingId <= 0) return send(res, 400, { error: 'listing_id required' });
    const listing = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0').get(listingId);
    if (!listing) return send(res, 404, { error: 'not found' });
    const rating = toInt(b.rating);
    if (rating === null || rating < 1 || rating > 5) return send(res, 400, { error: 'rating must be 1–5' });
    const cats = parseReviewCategories(b.categories);
    if (!cats.ok) return send(res, 400, { error: cats.error });
    const text = parseReviewText(b);
    if (text.error) return send(res, 400, { error: text.error });
    const existing = db.prepare('SELECT id FROM reviews WHERE listing_id=? AND student_id=?').get(listingId, user.id);
    if (existing) return send(res, 409, { error: 'you already reviewed this hostel — edit instead' });
    const todayCount = db.prepare("SELECT COUNT(*) c FROM reviews WHERE student_id=? AND date(created_at)=date('now')").get(user.id).c;
    if (todayCount >= MAX_REVIEWS_PER_DAY) return send(res, 429, { error: 'daily review limit reached (5 reviews per day)' });
    const info = db.prepare(`INSERT INTO reviews(listing_id, student_id, rating, categories, title, body, status)
      VALUES(?,?,?,?,?,?,'pending')`).run(listingId, user.id, rating, JSON.stringify(cats.value), text.title, text.body);
    const id = Number(info.lastInsertRowid);
    audit('review.submitted', user.id, 'student', 'review', id, 'listing_id=' + listingId);
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(id);
    return send(res, 201, { review: publicReview(row) });
  }

  const revPut = req.method === 'PUT' && p.match(/^\/api\/reviews\/(\d+)$/);
  if (revPut) {
    const user = requireStudent(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(revPut[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    if (row.student_id !== user.id) return send(res, 403, { error: 'not your review' });
    if (row.status === 'rejected' || row.status === 'hidden') return send(res, 400, { error: 'cannot edit a rejected or hidden review' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const allowed = ['rating', 'categories', 'title', 'body'];
    if (Object.keys(b).some(k => !allowed.includes(k))) return send(res, 400, { error: 'unknown field' });
    const updates = {};
    if (b.rating !== undefined) {
      const rating = toInt(b.rating);
      if (rating === null || rating < 1 || rating > 5) return send(res, 400, { error: 'rating must be 1–5' });
      updates.rating = rating;
    }
    if (b.categories !== undefined) {
      const cats = parseReviewCategories(b.categories);
      if (!cats.ok) return send(res, 400, { error: cats.error });
      updates.categories = JSON.stringify(cats.value);
    }
    if (b.title !== undefined || b.body !== undefined) {
      const text = parseReviewText({ title: b.title !== undefined ? b.title : row.title,
        body: b.body !== undefined ? b.body : row.body });
      if (text.error) return send(res, 400, { error: text.error });
      updates.title = text.title;
      updates.body = text.body;
    }
    if (Object.keys(updates).length === 0) return send(res, 400, { error: 'nothing to update' });
    // An edit after approval sends the review back to pending for
    // re-moderation; its approved photos go back to pending too.
    const wasApproved = row.status === 'approved';
    updates.status = 'pending';
    updates.decided_by = null;
    updates.decided_at = null;
    updates.decide_reason = '';
    const keys = Object.keys(updates);
    db.prepare(`UPDATE reviews SET ${keys.map(k => k + '=?').join(', ')} WHERE id=?`)
      .run(...keys.map(k => updates[k]), row.id);
    if (wasApproved) setReviewPhotosStatus(row, 'pending', '');
    audit('review.edited', user.id, 'student', 'review', row.id, wasApproved ? 're-moderated' : '');
    const fresh = db.prepare('SELECT * FROM reviews WHERE id=?').get(row.id);
    return send(res, 200, { ok: true, review: publicReview(fresh) });
  }

  const revDel = req.method === 'POST' && p.match(/^\/api\/reviews\/(\d+)\/delete$/);
  if (revDel) {
    const user = requireStudent(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(revDel[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    if (row.student_id !== user.id) return send(res, 403, { error: 'not your review' });
    const photos = db.prepare("SELECT * FROM photos WHERE listing_id=? AND uploader_id=? AND kind='review'").all(row.listing_id, row.student_id);
    for (const ph of photos) deletePhotoFile(ph.filename);
    db.prepare("DELETE FROM photos WHERE listing_id=? AND uploader_id=? AND kind='review'").run(row.listing_id, row.student_id);
    db.prepare('DELETE FROM reviews WHERE id=?').run(row.id);
    audit('review.deleted', user.id, 'student', 'review', row.id, 'listing_id=' + row.listing_id);
    return send(res, 200, { ok: true });
  }

  const revPhoto = req.method === 'POST' && p.match(/^\/api\/reviews\/(\d+)\/photo$/);
  if (revPhoto) {
    const user = requireStudent(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(revPhoto[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    if (row.student_id !== user.id) return send(res, 403, { error: 'not your review' });
    if (!uploadIpCheck(req, res)) return;
    let parsed;
    try {
      parsed = await parseMultipartBody(req, PHOTO_MAX_BYTES + 256 * 1024);
    } catch (e) {
      if (e && e.message === 'upload too large') return send(res, 413, { error: 'upload too large — max 5 MB per photo' });
      return send(res, 400, { error: 'invalid upload — expected a multipart form with a photo file' });
    }
    const fields = parsed.fields || {};
    const files = parsed.files || [];
    const caption = fields.caption || '';
    if (typeof caption !== 'string' || caption.length > 120) return send(res, 400, { error: 'caption too long (max 120 characters)' });
    const file = files.find(f => f.name === 'photo');
    if (!file) return send(res, 400, { error: 'photo file required' });
    if (file.data.length === 0) return send(res, 400, { error: 'photo file is empty' });
    if (file.data.length > PHOTO_MAX_BYTES) return send(res, 413, { error: 'photo too large — max 5 MB' });
    const detected = detectImageKind(file.data);
    if (!detected) return send(res, 400, { error: 'photo must be a JPG, PNG or WebP image' });
    const ext = path.extname(file.filename || '').toLowerCase();
    const allowedExt = detected === 'jpeg' ? ['.jpg', '.jpeg'] : [PHOTO_EXT[detected]];
    if (!allowedExt.includes(ext)) return send(res, 400, { error: 'file extension does not match the image type' });
    const count = db.prepare("SELECT COUNT(*) c FROM photos WHERE listing_id=? AND uploader_id=? AND kind='review'").get(row.listing_id, row.student_id).c;
    if (count >= MAX_PHOTOS_PER_REVIEW) return send(res, 400, { error: 'this review already has 3 photos' });
    const filename = 'photo-' + crypto.randomBytes(16).toString('hex') + PHOTO_EXT[detected];
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.data);
    // Review photos stay pending with the review — they show only when
    // the review is approved.
    const info = db.prepare(`INSERT INTO photos(listing_id, uploader_id, kind, filename, caption, status)
      VALUES(?,?,?,?,?,'pending')`).run(row.listing_id, user.id, 'review', filename, caption);
    const id = Number(info.lastInsertRowid);
    audit('review.photo_uploaded', user.id, 'student', 'photo', id, 'review_id=' + row.id);
    const photoRow = db.prepare('SELECT * FROM photos WHERE id=?').get(id);
    return send(res, 200, { ok: true, photo: publicPhoto(photoRow) });
  }

  if (req.method === 'GET' && p === '/api/student/reviews') {
    const user = requireStudent(req, res);
    if (!user) return;
    const rows = db.prepare('SELECT * FROM reviews WHERE student_id=? ORDER BY id DESC').all(user.id);
    const reviews = rows.map(r => {
      const v = publicReview(r);
      v.photos = reviewPhotos(r.listing_id, r.student_id, false);
      return v;
    });
    return send(res, 200, { reviews });
  }

  // ---- Phase 4: manager review moderation ----
  if (req.method === 'GET' && p === '/api/manager/reviews') {
    const user = requireManager(req, res);
    if (!user) return;
    const listingId = u.searchParams.get('listing_id');
    const status = u.searchParams.get('status') || '';
    if (status && !['pending', 'approved', 'rejected', 'hidden'].includes(status)) return send(res, 400, { error: 'invalid status' });
    let listingIds;
    if (listingId) {
      const lid = Number(listingId);
      if (!Number.isInteger(lid) || lid <= 0) return send(res, 400, { error: 'invalid listing_id' });
      const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(lid);
      if (!listing) return send(res, 404, { error: 'not found' });
      if (listing.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
      listingIds = [lid];
    } else {
      listingIds = db.prepare('SELECT id FROM listings WHERE owner_id=?').all(user.id).map(r => r.id);
    }
    if (!listingIds.length) return send(res, 200, { reviews: [] });
    const where = [`listing_id IN (${listingIds.map(() => '?').join(',')})`];
    const args = [...listingIds];
    if (status) { where.push('status=?'); args.push(status); }
    const rows = db.prepare(`SELECT * FROM reviews WHERE ${where.join(' AND ')}
      ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, id DESC`).all(...args);
    const reviews = rows.map(r => {
      const v = publicReview(r);
      v.photos = reviewPhotos(r.listing_id, r.student_id, false);
      return v;
    });
    return send(res, 200, { reviews });
  }

  if (req.method === 'POST' && p === '/api/manager/reviews/decide') {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const b = await readBody(req);
    if (!b || (b.decision !== 'approve' && b.decision !== 'reject')) return send(res, 400, { error: 'decision must be approve or reject' });
    const uf = unknownField(b, ['review_id', 'decision', 'reason', 'note']);
    if (uf) return send(res, 400, { error: uf });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(Number(b.review_id));
    if (!row) return send(res, 404, { error: 'not found' });
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(row.listing_id);
    if (!listing || listing.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
    // Reject reason: a fixed list value, plus an optional note. Accept
    // {reason:'spam'} or {reason:'spam', note:'…'} or {reason:{reason:'spam', note:'…'}}.
    let reasonValue = '';
    let note = '';
    if (typeof b.note === 'string') note = b.note.trim().slice(0, 500);
    if (typeof b.reason === 'string') reasonValue = b.reason.trim();
    else if (b.reason && typeof b.reason === 'object') {
      if (typeof b.reason.reason === 'string') reasonValue = b.reason.reason.trim();
      if (typeof b.reason.note === 'string') note = b.reason.note.trim().slice(0, 500);
    }
    if (b.decision === 'reject') {
      if (!REJECT_REASONS.includes(reasonValue)) return send(res, 400, { error: 'reject needs a reason from the list: ' + REJECT_REASONS.join(', ') });
    } else if (reasonValue && !REJECT_REASONS.includes(reasonValue)) {
      return send(res, 400, { error: 'reason must be one of: ' + REJECT_REASONS.join(', ') });
    }
    const decideReason = reasonValue + (note ? ' — ' + note : '');
    const now = new Date().toISOString();
    if (b.decision === 'approve') {
      db.prepare("UPDATE reviews SET status='approved', decided_by=?, decided_at=?, decide_reason=? WHERE id=?")
        .run(user.id, now, decideReason, row.id);
      setReviewPhotosStatus(row, 'approved', decideReason);
      audit('review.approved', user.id, 'manager', 'review', row.id, decideReason);
    } else {
      // Rejected reviews are NOT deleted — they stay in the DB with the
      // reason, visible to the master, counted honestly on the listing.
      db.prepare("UPDATE reviews SET status='rejected', decided_by=?, decided_at=?, decide_reason=? WHERE id=?")
        .run(user.id, now, decideReason, row.id);
      setReviewPhotosStatus(row, 'rejected', decideReason);
      audit('review.rejected', user.id, 'manager', 'review', row.id, decideReason);
    }
    const fresh = db.prepare('SELECT * FROM reviews WHERE id=?').get(row.id);
    return send(res, 200, { ok: true, review: publicReview(fresh) });
  }

  if (req.method === 'POST' && p === '/api/manager/reviews/reply') {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['review_id', 'reply']);
    if (uf) return send(res, 400, { error: uf });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(Number(b.review_id));
    if (!row) return send(res, 404, { error: 'not found' });
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(row.listing_id);
    if (!listing || listing.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
    if (typeof b.reply !== 'string' || !b.reply.trim()) return send(res, 400, { error: 'reply required' });
    if (b.reply.length > MAX_REPLY) return send(res, 400, { error: 'reply too long (max 1000 characters)' });
    db.prepare('UPDATE reviews SET manager_reply=? WHERE id=?').run(b.reply.trim(), row.id);
    audit('review.replied', user.id, 'manager', 'review', row.id, '');
    return send(res, 200, { ok: true });
  }

  // ---- Phase 4: master review overturn ----
  if (req.method === 'GET' && p === '/api/master/reviews') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const status = u.searchParams.get('status') || 'rejected';
    if (status !== 'all' && !['pending', 'approved', 'rejected', 'hidden'].includes(status)) return send(res, 400, { error: 'invalid status' });
    const rows = status === 'all'
      ? db.prepare('SELECT * FROM reviews ORDER BY id DESC').all()
      : db.prepare('SELECT * FROM reviews WHERE status=? ORDER BY id DESC').all(status);
    const reviews = rows.map(r => {
      const v = publicReview(r);
      v.photos = reviewPhotos(r.listing_id, r.student_id, false);
      return v;
    });
    return send(res, 200, { reviews });
  }

  if (req.method === 'POST' && p === '/api/master/reviews/overturn') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b || (b.decision !== 'approve' && b.decision !== 'hide')) return send(res, 400, { error: 'decision must be approve or hide' });
    const uf = unknownField(b, ['review_id', 'decision', 'reason']);
    if (uf) return send(res, 400, { error: uf });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(Number(b.review_id));
    if (!row) return send(res, 404, { error: 'not found' });
    const reason = typeof b.reason === 'string' ? b.reason.slice(0, 500) : '';
    const now = new Date().toISOString();
    if (b.decision === 'approve') {
      db.prepare("UPDATE reviews SET status='approved', decided_by=NULL, decided_at=?, decide_reason=? WHERE id=?")
        .run(now, reason, row.id);
      setReviewPhotosStatus(row, 'approved', reason);
      audit('review.overturned', null, 'master', 'review', row.id, 'approve: ' + reason);
    } else {
      db.prepare("UPDATE reviews SET status='hidden', decided_by=NULL, decided_at=?, decide_reason=? WHERE id=?")
        .run(now, reason, row.id);
      setReviewPhotosStatus(row, 'pending', reason);
      audit('review.overturned', null, 'master', 'review', row.id, 'hide: ' + reason);
    }
    const fresh = db.prepare('SELECT * FROM reviews WHERE id=?').get(row.id);
    return send(res, 200, { ok: true, review: publicReview(fresh) });
  }

  if (req.method === 'POST' && p === '/api/master/reviews/reply/delete') {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['review_id']);
    if (uf) return send(res, 400, { error: uf });
    const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(Number(b && b.review_id));
    if (!row) return send(res, 404, { error: 'not found' });
    db.prepare("UPDATE reviews SET manager_reply='' WHERE id=?").run(row.id);
    audit('review.reply_deleted', null, 'master', 'review', row.id, '');
    return send(res, 200, { ok: true });
  }

  // ---- manager (cookie session; every endpoint re-checks owner_id) ----
  if (req.method === 'GET' && p === '/api/manager/listings') {
    const user = requireManager(req, res);
    if (!user) return;
    const rows = db.prepare('SELECT * FROM listings WHERE owner_id=? ORDER BY id').all(user.id);
    return send(res, 200, { listings: rows.map(publicListing) });
  }

  if (req.method === 'POST' && p === '/api/manager/listings') {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const b = await readBody(req);
    const parsed = parseListingInput(b, null);
    if (parsed.error) return send(res, 400, { error: parsed.error });
    const updates = parsed.updates;
    if (updates.source === undefined) updates.source = 'Manager submission (unverified)';
    if (updates.amenities !== undefined && updates.facilities === undefined) {
      updates.facilities = JSON.stringify(deriveFacilities([], JSON.parse(updates.amenities)));
    }
    const cols = ['owner_id', 'status', ...Object.keys(updates)];
    const vals = [user.id, 'LISTED', ...Object.values(updates)];
    // A manager create starts LISTED and never VERIFIED.
    const info = db.prepare(`INSERT INTO listings(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...vals);
    const id = Number(info.lastInsertRowid);
    audit('listing.created', user.id, 'manager', 'listing', id, '');
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
    return send(res, 201, { listing: publicListing(row) });
  }

  const mgrPut = req.method === 'PUT' && p.match(/^\/api\/manager\/listings\/(\d+)$/);
  if (mgrPut) {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(mgrPut[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    if (row.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
    const b = await readBody(req);
    const parsed = parseListingInput(b, row);
    if (parsed.error) return send(res, 400, { error: parsed.error });
    const updates = parsed.updates;
    if (updates.amenities !== undefined && updates.facilities === undefined) {
      updates.facilities = JSON.stringify(deriveFacilities(safeJsonArr(row.facilities), JSON.parse(updates.amenities)));
    }
    // Headline rent/room follow the cheapest room type unless the manager
    // set rent_pkr / room directly in this same edit.
    if (updates.room_types !== undefined && updates.rent_pkr === undefined && updates.room === undefined) {
      const rt = JSON.parse(updates.room_types);
      if (rt.length) {
        const cheapest = rt.reduce((a, c) => (c.rent_pkr < a.rent_pkr ? c : a));
        updates.rent_pkr = cheapest.rent_pkr;
        updates.room = cheapest.room;
      }
    }
    // Price history: one row per fee field that changed, plus one per
    // room type whose rent changed (field `room_types:<room>`). A manager
    // edit NEVER changes the listing status — VERIFIED stays master-only.
    const hist = db.prepare('INSERT INTO price_history(listing_id, field, old_value, new_value, changed_date) VALUES(?,?,?,?,?)');
    for (const f of TRACKED_FEE_FIELDS) {
      if (updates[f] !== undefined) {
        const oldV = row[f] === null || row[f] === undefined ? 0 : row[f];
        const newV = updates[f] === null ? 0 : updates[f];
        if (oldV !== newV) hist.run(row.id, f, oldV, newV, today());
      }
    }
    if (updates.room_types !== undefined) {
      const oldMap = new Map(safeJsonArr(row.room_types).map(r => [r.room, r.rent_pkr]));
      for (const r of JSON.parse(updates.room_types)) {
        if (oldMap.has(r.room)) {
          if (oldMap.get(r.room) !== r.rent_pkr) hist.run(row.id, 'room_types:' + r.room, oldMap.get(r.room), r.rent_pkr, today());
        } else {
          hist.run(row.id, 'room_types:' + r.room, 0, r.rent_pkr, today());
        }
      }
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE listings SET ${keys.map(k => k + '=?').join(', ')} WHERE id=?`)
        .run(...keys.map(k => updates[k]), row.id);
    }
    audit('listing.updated', user.id, 'manager', 'listing', row.id, '');
    const fresh = db.prepare('SELECT * FROM listings WHERE id=?').get(row.id);
    return send(res, 200, { ok: true, listing: publicListing(fresh) });
  }

  const mgrDel = req.method === 'POST' && p.match(/^\/api\/manager\/listings\/(\d+)\/delete$/);
  if (mgrDel) {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(mgrDel[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    if (row.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
    // Hide only — nothing is hard-deleted; the master can restore it.
    db.prepare('UPDATE listings SET hidden=1 WHERE id=?').run(row.id);
    audit('listing.hidden', user.id, 'manager', 'listing', row.id, '');
    return send(res, 200, { ok: true, hidden: true });
  }

  // ---- Phase 3: photos ----
  if (req.method === 'POST' && p === '/api/manager/photos') {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    if (!uploadIpCheck(req, res)) return;
    let parsed;
    try {
      parsed = await parseMultipartBody(req, PHOTO_MAX_BYTES + 256 * 1024);
    } catch (e) {
      if (e && e.message === 'upload too large') return send(res, 413, { error: 'upload too large — max 5 MB per photo' });
      return send(res, 400, { error: 'invalid upload — expected a multipart form with a photo file' });
    }
    const fields = parsed.fields || {};
    const files = parsed.files || [];
    const listingId = Number(fields.listing_id);
    if (!Number.isInteger(listingId) || listingId <= 0) return send(res, 400, { error: 'listing_id required' });
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
    if (!listing) return send(res, 404, { error: 'not found' });
    if (listing.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
    const kind = (fields.kind || '').trim();
    // Review photos come in Phase 4 (POST /api/reviews/:id/photo) — the
    // manager endpoint only takes hostel/location/room/mess kinds.
    if (!PHOTO_KINDS.includes(kind) || kind === 'review') return send(res, 400, { error: 'kind must be hostel, location, room or mess' });
    const caption = fields.caption || '';
    if (typeof caption !== 'string' || caption.length > 120) return send(res, 400, { error: 'caption too long (max 120 characters)' });
    const file = files.find(f => f.name === 'photo');
    if (!file) return send(res, 400, { error: 'photo file required' });
    if (file.data.length === 0) return send(res, 400, { error: 'photo file is empty' });
    if (file.data.length > PHOTO_MAX_BYTES) return send(res, 413, { error: 'photo too large — max 5 MB' });
    // Magic bytes first, extension allowlist second. A file whose magic
    // bytes do not match its claimed type is rejected, never stored.
    const detected = detectImageKind(file.data);
    if (!detected) return send(res, 400, { error: 'photo must be a JPG, PNG or WebP image' });
    const ext = path.extname(file.filename || '').toLowerCase();
    const allowedExt = detected === 'jpeg' ? ['.jpg', '.jpeg'] : [PHOTO_EXT[detected]];
    if (!allowedExt.includes(ext)) return send(res, 400, { error: 'file extension does not match the image type' });
    const count = db.prepare("SELECT COUNT(*) c FROM photos WHERE listing_id=? AND kind != 'review'").get(listingId).c;
    if (count >= MAX_PHOTOS_PER_HOSTEL) return send(res, 400, { error: 'this hostel already has 8 photos — delete one before uploading another' });
    const todayCount = db.prepare("SELECT COUNT(*) c FROM photos WHERE uploader_id=? AND date(created_at)=date('now')").get(user.id).c;
    if (todayCount >= MAX_UPLOADS_PER_DAY) return send(res, 429, { error: 'daily upload limit reached (20 photos per day)' });
    // Random stored name, never the upload name.
    const filename = 'photo-' + crypto.randomBytes(16).toString('hex') + PHOTO_EXT[detected];
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), file.data);
    // Manager photos show immediately (approved on upload, per the approved
    // decision); the master can remove any photo.
    const info = db.prepare(`INSERT INTO photos(listing_id, uploader_id, kind, filename, caption, status)
      VALUES(?,?,?,?,?,'approved')`).run(listingId, user.id, kind, filename, caption);
    const id = Number(info.lastInsertRowid);
    audit('photo.uploaded', user.id, 'manager', 'photo', id, 'listing_id=' + listingId + ',kind=' + kind);
    const row = db.prepare('SELECT * FROM photos WHERE id=?').get(id);
    return send(res, 200, { ok: true, photo: publicPhoto(row) });
  }

  if (req.method === 'GET' && p === '/api/manager/photos') {
    const user = requireManager(req, res);
    if (!user) return;
    const listingId = Number(u.searchParams.get('listing_id'));
    if (!Number.isInteger(listingId) || listingId <= 0) return send(res, 400, { error: 'listing_id required' });
    const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
    if (!listing) return send(res, 404, { error: 'not found' });
    if (listing.owner_id !== user.id) return send(res, 403, { error: 'not your hostel' });
    const rows = db.prepare('SELECT * FROM photos WHERE listing_id=? AND uploader_id=? ORDER BY id').all(listingId, user.id);
    return send(res, 200, { photos: rows.map(publicPhoto) });
  }

  const mgrPhotoDel = req.method === 'POST' && p.match(/^\/api\/manager\/photos\/(\d+)\/delete$/);
  if (mgrPhotoDel) {
    const user = requireManager(req, res);
    if (!user) return;
    if (!originOk(req)) return send(res, 403, { error: 'bad origin' });
    const photo = db.prepare('SELECT * FROM photos WHERE id=?').get(mgrPhotoDel[1]);
    if (!photo) return send(res, 404, { error: 'not found' });
    if (photo.uploader_id !== user.id) return send(res, 403, { error: 'not your photo' });
    deletePhotoFile(photo.filename);
    db.prepare('DELETE FROM photos WHERE id=?').run(photo.id);
    audit('photo.deleted', user.id, 'manager', 'photo', photo.id, 'listing_id=' + photo.listing_id);
    return send(res, 200, { ok: true });
  }

  const masterPhotoDel = req.method === 'POST' && p.match(/^\/api\/master\/photos\/(\d+)\/delete$/);
  if (masterPhotoDel) {
    if (!isMaster(req)) return send(res, 403, { error: 'wrong master code' });
    const photo = db.prepare('SELECT * FROM photos WHERE id=?').get(masterPhotoDel[1]);
    if (!photo) return send(res, 404, { error: 'not found' });
    deletePhotoFile(photo.filename);
    db.prepare('DELETE FROM photos WHERE id=?').run(photo.id);
    audit('photo.deleted', null, 'master', 'photo', photo.id, 'listing_id=' + photo.listing_id);
    return send(res, 200, { ok: true });
  }

  // Serves an APPROVED photo to anyone. A pending/rejected photo is never
  // public — only its owning manager can see it (404 to everyone else, so
  // the file's existence is not revealed). Never served as text/html.
  const fileMatch = req.method === 'GET' && p.match(/^\/api\/photos\/file\/(.+)$/);
  if (fileMatch) {
    let rawName;
    try { rawName = decodeURIComponent(fileMatch[1]); } catch { return send(res, 400, { error: 'invalid filename' }); }
    if (!rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('\0')
      || rawName !== path.basename(rawName)) return send(res, 400, { error: 'invalid filename' });
    const photo = db.prepare('SELECT * FROM photos WHERE filename=?').get(rawName);
    if (!photo) return send(res, 404, { error: 'not found' });
    if (photo.status !== 'approved') {
      const user = sessionUser(req);
      let allowed = user && user.id === photo.uploader_id;
      if (!allowed && user && user.role === 'manager') {
        const listing = db.prepare('SELECT owner_id FROM listings WHERE id=?').get(photo.listing_id);
        allowed = !!listing && listing.owner_id === user.id;
      }
      // The master moderates from the header-auth admin view (no cookie
      // session), so the master code also opens a pending photo — the
      // master has to see a review's photos to judge the review.
      if (!allowed && isMaster(req)) allowed = true;
      if (!allowed) return send(res, 404, { error: 'not found' });
    }
    const full = path.join(UPLOADS_DIR, path.basename(photo.filename));
    if (!full.startsWith(UPLOADS_DIR + path.sep)) return send(res, 400, { error: 'invalid filename' });
    if (!fs.existsSync(full)) return send(res, 404, { error: 'not found' });
    const ext = path.extname(photo.filename).toLowerCase();
    const mime = ext === '.png' ? PHOTO_MIME.png : ext === '.webp' ? PHOTO_MIME.webp : PHOTO_MIME.jpeg;
    const data = fs.readFileSync(full);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': mime, 'Content-Length': data.length });
    return res.end(data);
  }

  if (req.method === 'GET' && p === '/api/listings') {
    const city = u.searchParams.get('city') || '';
    const area = u.searchParams.get('area') || '';
    const type = u.searchParams.get('type') || '';
    const room = u.searchParams.get('room') || '';
    const mess = u.searchParams.get('mess') || ''; // 'included' | 'separate'
    const maxRent = u.searchParams.get('max_rent');
    const sort = u.searchParams.get('sort') === 'desc' ? 'DESC' : 'ASC';
    const showExamples = u.searchParams.get('show_examples') === '1';
    if (maxRent !== null && maxRent !== '') {
      const mr = Number(maxRent);
      if (!Number.isFinite(mr) || mr < 0) return send(res, 400, { error: 'invalid max_rent' });
    }
    const where = ['hidden=0'];
    const args = [];
    if (!showExamples) where.push("status != 'EXAMPLE'");
    if (city) { where.push('city=?'); args.push(city); }
    if (area) { where.push('area=?'); args.push(area); }
    if (type) { where.push('type=?'); args.push(type); }
    if (room) { where.push('room=?'); args.push(room); }
    if (mess === 'included') where.push('mess_included=1');
    if (mess === 'separate') where.push('mess_included=0');
    const rows = db.prepare(`SELECT * FROM listings WHERE ${where.join(' AND ')}`).all(...args);
    // Max rent and sort both run on the MONTHLY equivalent (semester
    // rows at rent / 6) — the same number the cards, the calculator
    // and the cheapest chip use. Filtering on the raw rent hid the
    // UET semester rows from any "max Rs 5,000/month" search even
    // though they cost ~Rs 1,941–2,641/month.
    let pubs = rows.map(publicListing);
    if (maxRent !== null && maxRent !== '') {
      const mr = Number(maxRent);
      pubs = pubs.filter(l => l.monthly_rent_equivalent <= mr);
    }
    pubs.sort((a, b) => sort === 'DESC'
      ? b.monthly_rent_equivalent - a.monthly_rent_equivalent
      : a.monthly_rent_equivalent - b.monthly_rent_equivalent);
    // Counts always exclude EXAMPLE rows, even when examples are shown.
    const counted = showExamples ? pubs.filter(r => r.status !== 'EXAMPLE') : pubs;
    const counts = {
      verified: counted.filter(r => r.status === 'VERIFIED').length,
      listed: counted.filter(r => r.status === 'LISTED').length,
      total: counted.length,
    };
    return send(res, 200, { listings: pubs, counts });
  }

  // Public: approved reviews only, newest first, with approved review
  // photos and manager replies. Reviewer display name only — never Gmail.
  const revList = p.match(/^\/api\/listings\/(\d+)\/reviews$/);
  if (req.method === 'GET' && revList) {
    const row = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0').get(revList[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    const rows = db.prepare("SELECT * FROM reviews WHERE listing_id=? AND status='approved' ORDER BY id DESC").all(row.id);
    return send(res, 200, { reviews: rows.map(publicReview), summary: reviewSummary(row.id) });
  }

  const detail = p.match(/^\/api\/listings\/(\d+)$/);
  if (req.method === 'GET' && detail) {
    const row = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0').get(detail[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    const history = db.prepare('SELECT * FROM price_history WHERE listing_id=? ORDER BY id DESC').all(row.id);
    // Approved photos only — pending/rejected photos are never public.
    const photos = db.prepare("SELECT * FROM photos WHERE listing_id=? AND status='approved' ORDER BY id").all(row.id).map(publicPhoto);
    const approvedReviews = db.prepare("SELECT * FROM reviews WHERE listing_id=? AND status='approved' ORDER BY id DESC").all(row.id);
    return send(res, 200, { listing: publicListing(row), history, photos,
      review_summary: reviewSummary(row.id), reviews: approvedReviews.map(publicReview) });
  }

  if (req.method === 'GET' && p === '/api/compare') {
    const ids = [...new Set((u.searchParams.get('ids') || '').split(',').map(s => Number(s)).filter(n => n > 0))];
    const showExamples = u.searchParams.get('show_examples') === '1';
    if (ids.length < 2 || ids.length > 3) return send(res, 400, { error: 'compare needs 2 or 3 different ids' });
    const rows = db.prepare(`SELECT * FROM listings WHERE id IN (${ids.map(() => '?').join(',')}) AND hidden=0`).all(...ids);
    const visible = showExamples ? rows : rows.filter(r => r.status !== 'EXAMPLE');
    return send(res, 200, { listings: visible.map(publicListing) });
  }

  if (req.method === 'GET' && p === '/api/calc') {
    const row = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0').get(u.searchParams.get('listing_id'));
    if (!row) return send(res, 404, { error: 'not found' });
    const extras = Number(u.searchParams.get('extras') || 0);
    if (!Number.isFinite(extras) || extras < 0 || extras >= MAX_RENT) return send(res, 400, { error: 'invalid extras' });
    const pub = publicListing(row);
    return send(res, 200, {
      listing_id: pub.id, rent: pub.monthly_rent_equivalent,
      rent_basis: pub.price_basis === 'semester' ? 'semester price / 6 (estimate)' : 'per month',
      mess: pub.mess_included ? 0 : pub.mess_pkr, extras,
      total: monthlyTotal(pub, extras),
    });
  }

  if (req.method === 'POST' && p === '/api/admin/verify') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const b = await readBody(req);
    if (!b || !b.source_note || !String(b.source_note).trim()) return send(res, 400, { error: 'source note required — nothing is verified without a source' });
    const uf = unknownField(b, ['id', 'source_note']);
    if (uf) return send(res, 400, { error: uf });
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(b.id);
    if (!row) return send(res, 404, { error: 'not found' });
    db.prepare("UPDATE listings SET status='VERIFIED', source=?, last_verified=? WHERE id=?")
      .run(String(b.source_note).trim(), today(), b.id);
    audit('listing.verified', null, 'master', 'listing', row.id, String(b.source_note).trim().slice(0, 500));
    return send(res, 200, { ok: true, status: 'VERIFIED' });
  }
  if (req.method === 'POST' && p === '/api/admin/hide') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['id']);
    if (uf) return send(res, 400, { error: uf });
    const id = toInt(b.id);
    if (id === null || id <= 0) return send(res, 400, { error: 'id required' });
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
    if (!row) return send(res, 404, { error: 'not found' });
    db.prepare('UPDATE listings SET hidden=1 WHERE id=?').run(id);
    audit('listing.hidden', null, 'master', 'listing', id, '');
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/admin/edit') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const uf = unknownField(b, ['id', 'rent_pkr', 'mess_pkr']);
    if (uf) return send(res, 400, { error: uf });
    const id = toInt(b.id);
    if (id === null || id <= 0) return send(res, 400, { error: 'id required' });
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
    if (!row) return send(res, 404, { error: 'not found' });
    // Both prices must be integers in range — the old code passed
    // Number('abc') = NaN straight into the DB bind, which throws.
    let newRent = null;
    let newMess = null;
    if (b.rent_pkr !== undefined) {
      newRent = toInt(b.rent_pkr);
      if (newRent === null || newRent <= 0 || newRent >= MAX_RENT) return send(res, 400, { error: 'invalid rent' });
    }
    if (b.mess_pkr !== undefined) {
      newMess = toInt(b.mess_pkr);
      if (newMess === null || newMess < 0 || newMess >= MAX_RENT) return send(res, 400, { error: 'invalid mess price' });
    }
    const hist = db.prepare('INSERT INTO price_history(listing_id, field, old_value, new_value, changed_date) VALUES(?,?,?,?,?)');
    let changed = false;
    if (newRent !== null && newRent !== row.rent_pkr) {
      hist.run(row.id, 'rent_pkr', row.rent_pkr, newRent, today());
      db.prepare('UPDATE listings SET rent_pkr=? WHERE id=?').run(newRent, row.id);
      changed = true;
    }
    if (newMess !== null && newMess !== row.mess_pkr) {
      hist.run(row.id, 'mess_pkr', row.mess_pkr, newMess, today());
      db.prepare('UPDATE listings SET mess_pkr=? WHERE id=?').run(newMess, row.id);
      changed = true;
    }
    if (changed) audit('listing.updated', null, 'master', 'listing', row.id, '');
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/api/admin/listings') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const rows = db.prepare('SELECT * FROM listings ORDER BY id').all();
    return send(res, 200, { listings: rows.map(publicListing) });
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`Hostel + Mess Index on http://127.0.0.1:${PORT}`));

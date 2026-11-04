// Hostel + Mess Index — structured, verified hostel/PG rents + mess rates
// + price history by university area (Peshawar, Lahore, Islamabad).
// Honesty model: VERIFIED = admin-confirmed with a source note; LISTED =
// community-submitted, unverified claim; EXAMPLE = demo only, excluded from
// default search and from all counts. Ranges are market ranges, never one
// hostel's rent. No booking or payment happens here.
// Node.js 24+, native node:http + node:sqlite only. No external dependencies.
// Port 3034. Data: data/hostel.sqlite. Admin gate is a simple shared code
// (env ADMIN_CODE, default 'hostel-admin') — demo-grade, documented in README.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3034);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'hostel.sqlite');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_CODE = process.env.ADMIN_CODE || 'hostel-admin';

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

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
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
`);

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

function publicListing(row) {
  return {
    ...row,
    facilities: JSON.parse(row.facilities || '[]'),
    mess_included: row.mess_included === 1, hidden: row.hidden === 1,
    monthly_rent_equivalent: row.price_basis === 'semester' ? Math.round(row.rent_pkr / 6) : row.rent_pkr,
  };
}
// Monthly total: rent (semester rows converted at /6, labelled as an estimate)
// + mess only when it is charged separately + user extras.
function monthlyTotal(listing, extras) {
  const rent = listing.price_basis === 'semester' ? listing.rent_pkr / 6 : listing.rent_pkr;
  const mess = listing.mess_included ? 0 : listing.mess_pkr;
  return Math.round(rent + mess + (extras || 0));
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
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
function isAdmin(req) { return req.headers['x-admin-code'] === ADMIN_CODE; }
function serveFile(res, file, type) {
  const p = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(p)) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(p).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'GET' && p === '/') return serveFile(res, 'index.html', 'text/html');
  if (req.method === 'GET' && p === '/admin') return serveFile(res, 'admin.html', 'text/html');
  if (req.method === 'GET' && p === '/app.js') return serveFile(res, 'app.js', 'text/javascript');
  if (req.method === 'GET' && p === '/admin.js') return serveFile(res, 'admin.js', 'text/javascript');
  if (req.method === 'GET' && p === '/styles.css') return serveFile(res, 'styles.css', 'text/css');

  if (req.method === 'GET' && p === '/api/meta') {
    return send(res, 200, { cities: CITIES, areas: AREAS, types: TYPES, rooms: ROOMS, facilities: FACILITIES });
  }
  if (req.method === 'GET' && p === '/api/reference') {
    return send(res, 200, { references: db.prepare('SELECT * FROM "references" ORDER BY id').all() });
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
    const where = ['hidden=0'];
    const args = [];
    if (!showExamples) where.push("status != 'EXAMPLE'");
    if (city) { where.push('city=?'); args.push(city); }
    if (area) { where.push('area=?'); args.push(area); }
    if (type) { where.push('type=?'); args.push(type); }
    if (room) { where.push('room=?'); args.push(room); }
    if (mess === 'included') where.push('mess_included=1');
    if (mess === 'separate') where.push('mess_included=0');
    if (maxRent !== null && maxRent !== '') { where.push('rent_pkr<=?'); args.push(Number(maxRent)); }
    const rows = db.prepare(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY rent_pkr ${sort}`).all(...args);
    // Counts always exclude EXAMPLE rows, even when examples are shown.
    const counted = showExamples ? rows.filter(r => r.status !== 'EXAMPLE') : rows;
    const counts = {
      verified: counted.filter(r => r.status === 'VERIFIED').length,
      listed: counted.filter(r => r.status === 'LISTED').length,
      total: counted.length,
    };
    return send(res, 200, { listings: rows.map(publicListing), counts });
  }

  const detail = p.match(/^\/api\/listings\/(\d+)$/);
  if (req.method === 'GET' && detail) {
    const row = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0').get(detail[1]);
    if (!row) return send(res, 404, { error: 'not found' });
    const history = db.prepare('SELECT * FROM price_history WHERE listing_id=? ORDER BY id DESC').all(row.id);
    return send(res, 200, { listing: publicListing(row), history });
  }

  if (req.method === 'GET' && p === '/api/compare') {
    const ids = (u.searchParams.get('ids') || '').split(',').map(s => Number(s)).filter(n => n > 0);
    const showExamples = u.searchParams.get('show_examples') === '1';
    if (ids.length < 2 || ids.length > 3) return send(res, 400, { error: 'compare needs 2 or 3 ids' });
    const rows = db.prepare(`SELECT * FROM listings WHERE id IN (${ids.map(() => '?').join(',')}) AND hidden=0`).all(...ids);
    const visible = showExamples ? rows : rows.filter(r => r.status !== 'EXAMPLE');
    return send(res, 200, { listings: visible.map(publicListing) });
  }

  if (req.method === 'GET' && p === '/api/calc') {
    const row = db.prepare('SELECT * FROM listings WHERE id=? AND hidden=0').get(u.searchParams.get('listing_id'));
    if (!row) return send(res, 404, { error: 'not found' });
    const extras = Number(u.searchParams.get('extras') || 0);
    const pub = publicListing(row);
    return send(res, 200, {
      listing_id: pub.id, rent: pub.monthly_rent_equivalent,
      rent_basis: pub.price_basis === 'semester' ? 'semester price / 6 (estimate)' : 'per month',
      mess: pub.mess_included ? 0 : pub.mess_pkr, extras,
      total: monthlyTotal(pub, extras),
    });
  }

  if (req.method === 'POST' && p === '/api/listings') {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    if (!CITIES.includes(b.city)) return send(res, 400, { error: 'invalid city' });
    if (!AREAS[b.city].includes(b.area)) return send(res, 400, { error: 'invalid area for city' });
    if (!TYPES.includes(b.type)) return send(res, 400, { error: 'invalid type' });
    if (!ROOMS.includes(b.room)) return send(res, 400, { error: 'invalid room' });
    const rent = Number(b.rent_pkr);
    if (!Number.isFinite(rent) || rent <= 0 || rent >= MAX_RENT) return send(res, 400, { error: 'invalid rent' });
    const mess = Number(b.mess_pkr || 0);
    if (!Number.isFinite(mess) || mess < 0) return send(res, 400, { error: 'invalid mess price' });
    if (!b.name || typeof b.name !== 'string' || b.name.trim().length < 3) return send(res, 400, { error: 'name required' });
    const facs = Array.isArray(b.facilities) ? b.facilities.filter(f => FACILITIES.includes(f)) : [];
    const info = db.prepare(`INSERT INTO listings
      (name, city, area, near_university, type, room, rent_pkr, price_basis, mess_included,
       mess_pkr, meals_per_day, facilities, source, status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, 'LISTED')`).run(
      b.name.trim(), b.city, b.area, b.near_university || '', b.type, b.room, rent, 'month',
      b.mess_included ? 1 : 0, b.mess_included ? 0 : mess, Number(b.meals_per_day || 0),
      JSON.stringify(facs), b.source || 'Community submission (unverified)');
    return send(res, 201, { id: Number(info.lastInsertRowid), status: 'LISTED' });
  }

  if (req.method === 'POST' && p === '/api/admin/verify') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const b = await readBody(req);
    if (!b || !b.source_note || !String(b.source_note).trim()) return send(res, 400, { error: 'source note required — nothing is verified without a source' });
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(b.id);
    if (!row) return send(res, 404, { error: 'not found' });
    db.prepare("UPDATE listings SET status='VERIFIED', source=?, last_verified=? WHERE id=?")
      .run(String(b.source_note).trim(), today(), b.id);
    return send(res, 200, { ok: true, status: 'VERIFIED' });
  }
  if (req.method === 'POST' && p === '/api/admin/hide') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const b = await readBody(req);
    db.prepare('UPDATE listings SET hidden=1 WHERE id=?').run(b.id);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/admin/edit') {
    if (!isAdmin(req)) return send(res, 403, { error: 'wrong admin code' });
    const b = await readBody(req);
    const row = db.prepare('SELECT * FROM listings WHERE id=?').get(b.id);
    if (!row) return send(res, 404, { error: 'not found' });
    const hist = db.prepare('INSERT INTO price_history(listing_id, field, old_value, new_value, changed_date) VALUES(?,?,?,?,?)');
    if (b.rent_pkr !== undefined && Number(b.rent_pkr) !== row.rent_pkr) {
      hist.run(row.id, 'rent_pkr', row.rent_pkr, Number(b.rent_pkr), today());
      db.prepare('UPDATE listings SET rent_pkr=? WHERE id=?').run(Number(b.rent_pkr), row.id);
    }
    if (b.mess_pkr !== undefined && Number(b.mess_pkr) !== row.mess_pkr) {
      hist.run(row.id, 'mess_pkr', row.mess_pkr, Number(b.mess_pkr), today());
      db.prepare('UPDATE listings SET mess_pkr=? WHERE id=?').run(Number(b.mess_pkr), row.id);
    }
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

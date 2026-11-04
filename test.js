// Tests for Hostel + Mess Index. Runs the server on a throwaway DB,
// asserts the honesty rules, then kills the server and deletes the DB.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3097;
const DB = '/tmp/hostel-test-' + process.pid + '.sqlite';
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
const H = code => ({ 'Content-Type': 'application/json', 'X-Admin-Code': code });

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, ADMIN_CODE: 'test-admin' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    const get = async p => (await fetch(BASE + p)).json();
    const post = async (p, body, code) => {
      const r = await fetch(BASE + p, { method: 'POST', headers: code ? H(code) : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, d: await r.json() };
    };

    // 1. Seed counts.
    const meta = await get('/api/meta');
    ok('meta lists 3 cities', meta.cities.length === 3);
    const refs = await get('/api/reference');
    ok('reference panel has 16 rows', refs.references.length === 16, refs.references.length);
    const all = await get('/api/listings');
    ok('default search excludes examples', all.listings.every(l => l.status !== 'EXAMPLE'));
    ok('seed counts: 2 verified + 4 listed', all.counts.verified === 2 && all.counts.listed === 4, all.counts);
    const withEx = await get('/api/listings?show_examples=1');
    ok('examples appear only when ticked', withEx.listings.length === all.listings.length + 3, withEx.listings.length);
    ok('counts still exclude examples when shown', withEx.counts.total === all.counts.total, withEx.counts);

    // 2. Community submission starts LISTED, never verified.
    const sub = await post('/api/listings', { name: 'Test Community Hostel', city: 'Peshawar', area: 'Hayatabad',
      near_university: 'UET Peshawar', type: 'boys', room: 'double', rent_pkr: 15000,
      mess_included: false, mess_pkr: 8000, meals_per_day: 3, facilities: ['WiFi'], source: 'test' });
    ok('community submit returns 201 LISTED', sub.status === 201 && sub.d.status === 'LISTED', sub);
    const afterSub = await get('/api/listings?city=Peshawar');
    const mine = afterSub.listings.find(l => l.id === sub.d.id);
    ok('submitted listing shows as LISTED, not verified', mine && mine.status === 'LISTED');
    ok('verified count unchanged by a LISTED submission',
      (await get('/api/listings')).counts.verified === 2);

    // 3. Admin verify needs the code AND a source note.
    const wrongCode = await post('/api/admin/verify', { id: sub.d.id, source_note: 'x' }, 'nope');
    ok('verify with wrong code is 403', wrongCode.status === 403, wrongCode.status);
    const noNote = await post('/api/admin/verify', { id: sub.d.id, source_note: '' }, 'test-admin');
    ok('verify without a source note is 400', noNote.status === 400, noNote.status);
    const ver = await post('/api/admin/verify', { id: sub.d.id, source_note: 'Test source, 2026-11-04' }, 'test-admin');
    ok('verify with code + source note succeeds', ver.status === 200 && ver.d.status === 'VERIFIED', ver);
    const det = await get('/api/listings/' + sub.d.id);
    ok('verified listing carries source note + date', det.listing.status === 'VERIFIED' && !!det.listing.last_verified && det.listing.source.includes('Test source'));

    // 4. Price edit writes exactly one history row; new price shows.
    const edit = await post('/api/admin/edit', { id: sub.d.id, rent_pkr: 16000 }, 'test-admin');
    ok('admin edit ok', edit.status === 200);
    const det2 = await get('/api/listings/' + sub.d.id);
    ok('new rent shows after edit', det2.listing.rent_pkr === 16000, det2.listing.rent_pkr);
    ok('exactly one history row for the rent change',
      det2.history.length === 1 && det2.history[0].field === 'rent_pkr' && det2.history[0].old_value === 15000 && det2.history[0].new_value === 16000, det2.history);

    // 5. Filters narrow correctly (city + max rent).
    const filt = await get('/api/listings?city=Lahore&max_rent=13000');
    ok('Lahore + max 13000 returns only cheap Lahore rows',
      filt.listings.length >= 1 && filt.listings.every(l => l.city === 'Lahore' && l.rent_pkr <= 13000), filt.listings.map(l => l.name));

    // 6. Monthly total maths: rent 15000 + mess 8000 = 23000 (fresh listing, no edits).
    const sub2 = await post('/api/listings', { name: 'Calc Test Hostel', city: 'Islamabad', area: 'H-8',
      type: 'boys', room: 'single', rent_pkr: 15000, mess_included: false, mess_pkr: 8000 });
    const calc = await get(`/api/calc?listing_id=${sub2.d.id}&extras=0`);
    ok('monthly total 15000 + 8000 = 23000', calc.total === 23000, calc);

    // 7. Admin wrong code 403 on hide/edit; invalid city/room 400.
    const hideWrong = await post('/api/admin/hide', { id: sub2.d.id }, 'nope');
    ok('hide with wrong code is 403', hideWrong.status === 403);
    const badCity = await post('/api/listings', { name: 'Bad Hostel', city: 'Karachi', area: 'Gulshan', type: 'boys', room: 'single', rent_pkr: 10000 });
    ok('invalid city rejected 400', badCity.status === 400, badCity.status);
    const badRoom = await post('/api/listings', { name: 'Bad Hostel', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'penthouse', rent_pkr: 10000 });
    ok('invalid room rejected 400', badRoom.status === 400, badRoom.status);
    const badRent = await post('/api/listings', { name: 'Bad Hostel', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 999999 });
    ok('rent over cap rejected 400', badRent.status === 400, badRent.status);

    // 8. Compare needs 2–3 ids.
    const cmp1 = await get('/api/compare?ids=1');
    ok('compare with 1 id is 400', cmp1.error && cmp1.error.includes('2 or 3'));
    const cmp = await get('/api/compare?ids=1,2,3');
    ok('compare returns 3 listings', cmp.listings.length === 3, cmp.listings.length);

    // 9. Hidden listings disappear from search.
    await post('/api/admin/hide', { id: sub2.d.id }, 'test-admin');
    const afterHide = await get('/api/listings?city=Islamabad');
    ok('hidden listing absent from search', !afterHide.listings.find(l => l.id === sub2.d.id));

    console.log(`\n${pass} passed, ${fail} failed.`);
    if (fail) process.exitCode = 1; else console.log('ALL TESTS PASS');
  } finally {
    srv.kill();
    try { fs.unlinkSync(DB); fs.unlinkSync(DB + '-wal'); fs.unlinkSync(DB + '-shm'); } catch {}
  }
}
main();

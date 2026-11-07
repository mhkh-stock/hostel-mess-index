// Tests for Hostel + Mess Index. Runs the server on a throwaway DB,
// asserts the honesty rules + the Phase 1 auth/roles rules + the Phase 2
// manager portal / listing-fields rules + the Phase 3 photo rules + the
// Phase 4 student-review rules + the Phase 5 final-review fixes + the
// 3D-dashboard Phase 1 shell + the Phase 2 3D scene + the Phase 3 stat
// cards + Ask Hostel AI panel, then kills the server and deletes the DB.
'use strict';
const { spawn } = require('node:child_process');
const httpMod = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = 3097;
const DB = '/tmp/hostel-test-' + process.pid + '.sqlite';
const UPLOADS = '/tmp/hostel-test-uploads-' + process.pid;
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
const H = code => ({ 'Content-Type': 'application/json', 'X-Admin-Code': code });

// Raw HTTP helper (fetch forbids setting the Cookie header, so cookie
// tests go through node:http directly).
function req(method, p, opts = {}) {
  return new Promise((resolve, reject) => {
    const r = httpMod.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }, res => {
      let s = '';
      res.on('data', c => { s += c; });
      res.on('end', () => {
        let d; try { d = JSON.parse(s); } catch { d = s; }
        const sc = res.headers['set-cookie'];
        resolve({ status: res.statusCode, d, headers: res.headers,
          setCookie: Array.isArray(sc) ? sc.join('; ') : (sc || ''),
          cookie: Array.isArray(sc) && sc[0] ? sc[0].split(';')[0] : (sc ? sc.split(';')[0] : null) });
      });
    });
    r.on('error', reject);
    if (opts.body !== undefined) r.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    r.end();
  });
}
let ipN = 10;
const nextIp = () => '10.0.0.' + (ipN++);
const MASTER = 'test-admin-code';
const reg = (gmail, role, pw, ip) => req('POST', '/api/auth/register',
  { body: { gmail, password: pw || 'password123', display_name: gmail.split('@')[0], phone: '03001234567', role }, headers: ip ? { 'X-Forwarded-For': ip } : {} });
const login = (gmail, pw, ip) => req('POST', '/api/auth/login',
  { body: { gmail, password: pw }, headers: ip ? { 'X-Forwarded-For': ip } : {} });
const me = cookie => req('GET', '/api/auth/me', { headers: cookie ? { Cookie: cookie } : {} });
const masterGet = (p, code) => req('GET', p, { headers: code ? { 'X-Master-Code': code } : {} });
const masterPost = (p, body, code) => req('POST', p, { body, headers: code ? { 'X-Master-Code': code } : {} });

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, UPLOADS_DIR: UPLOADS, ADMIN_CODE: 'test-admin-code', LOGIN_LOCK_SECONDS: '2' },
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
    // Manager helpers live here (not in section 11) because the early
    // sections need an approved manager to create listings: since the
    // public submit endpoint was removed, ONLY approved managers add
    // hostels, so every test listing comes from one.
    const mgrPost = (cookie, body) => req('POST', '/api/manager/listings', { body, headers: cookie ? { Cookie: cookie } : {} });
    const mgrPut = (cookie, id, body) => req('PUT', '/api/manager/listings/' + id, { body, headers: cookie ? { Cookie: cookie } : {} });
    const mgrDel = (cookie, id) => req('POST', '/api/manager/listings/' + id + '/delete', { headers: cookie ? { Cookie: cookie } : {} });
    const mgrGet = cookie => req('GET', '/api/manager/listings', { headers: cookie ? { Cookie: cookie } : {} });
    const makeManager = async gmail => {
      const r = await reg(gmail, 'manager', 'mgrpass99', nextIp());
      await masterPost('/api/master/managers/decide', { user_id: r.d.id, decision: 'approve' }, MASTER);
      const l = await login(gmail, 'mgrpass99', nextIp());
      return { id: r.d.id, cookie: l.cookie };
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

    // 2. Public submission is gone: only approved managers add hostels.
    // POST /api/listings used to accept community submissions; now it 404s.
    const gone1 = await post('/api/listings', { name: 'Gone Hostel', city: 'Peshawar', area: 'Hayatabad',
      type: 'boys', room: 'double', rent_pkr: 15000 });
    ok('POST /api/listings (public submit) is 404', gone1.status === 404, gone1);
    const gone2 = await post('/api/listings', { name: 'x' });
    ok('POST /api/listings with a bad body is also 404', gone2.status === 404, gone2.status);
    // The listing for the verify/edit tests below comes from an approved
    // manager instead — the only way a hostel gets added now.
    const mgr0 = await makeManager('early-mgr@example.com');
    const sub = await mgrPost(mgr0.cookie, { name: 'Test Manager Hostel', city: 'Peshawar', area: 'Hayatabad',
      near_university: 'UET Peshawar', type: 'boys', room: 'double', rent_pkr: 15000,
      mess_included: false, mess_pkr: 8000, meals_per_day: 3, facilities: ['WiFi'], source: 'test' });
    ok('manager create returns 201 LISTED', sub.status === 201 && sub.d.listing.status === 'LISTED', sub);
    const subId = sub.d.listing.id;
    const afterSub = await get('/api/listings?city=Peshawar');
    const mine = afterSub.listings.find(l => l.id === subId);
    ok('manager listing shows as LISTED, not verified', mine && mine.status === 'LISTED');
    ok('verified count unchanged by a LISTED submission',
      (await get('/api/listings')).counts.verified === 2);

    // 3. Admin verify needs the code AND a source note.
    const wrongCode = await post('/api/admin/verify', { id: subId, source_note: 'x' }, 'nope');
    ok('verify with wrong code is 403', wrongCode.status === 403, wrongCode.status);
    const noNote = await post('/api/admin/verify', { id: subId, source_note: '' }, 'test-admin-code');
    ok('verify without a source note is 400', noNote.status === 400, noNote.status);
    const ver = await post('/api/admin/verify', { id: subId, source_note: 'Test source, 2026-11-04' }, 'test-admin-code');
    ok('verify with code + source note succeeds', ver.status === 200 && ver.d.status === 'VERIFIED', ver);
    const det = await get('/api/listings/' + subId);
    ok('verified listing carries source note + date', det.listing.status === 'VERIFIED' && !!det.listing.last_verified && det.listing.source.includes('Test source'));

    // 4. Price edit writes exactly one history row; new price shows.
    const edit = await post('/api/admin/edit', { id: subId, rent_pkr: 16000 }, 'test-admin-code');
    ok('admin edit ok', edit.status === 200);
    const det2 = await get('/api/listings/' + subId);
    ok('new rent shows after edit', det2.listing.rent_pkr === 16000, det2.listing.rent_pkr);
    ok('exactly one history row for the rent change',
      det2.history.length === 1 && det2.history[0].field === 'rent_pkr' && det2.history[0].old_value === 15000 && det2.history[0].new_value === 16000, det2.history);

    // 5. Filters narrow correctly (city + max rent, on the MONTHLY
    // equivalent: semester rows count at rent / 6, like the cards and
    // the calculator — so the UET cubicle at Rs 15,846/semester
    // (~Rs 2,641/month) is inside a Rs 13,000/month cap).
    const filt = await get('/api/listings?city=Lahore&max_rent=13000');
    ok('Lahore + max 13000 returns only cheap Lahore rows (monthly equivalent)',
      filt.listings.length >= 1 && filt.listings.every(l => l.city === 'Lahore' && l.monthly_rent_equivalent <= 13000)
      && filt.listings.some(l => l.name.includes('Cubicle')), filt.listings.map(l => l.name));
    const filt5k = await get('/api/listings?max_rent=5000');
    ok('max 5000/month keeps the semester rows (equiv 1941 + 2641) and drops monthly 9990+',
      filt5k.listings.some(l => l.name.includes('Dormitory')) && filt5k.listings.some(l => l.name.includes('Cubicle'))
      && filt5k.listings.every(l => l.monthly_rent_equivalent <= 5000), filt5k.listings.map(l => l.monthly_rent_equivalent));
    const sortAsc = await get('/api/listings?sort=asc');
    ok('sort asc orders by monthly equivalent (semester rows first at 1941, 2641)',
      sortAsc.listings[0].monthly_rent_equivalent === 1941 && sortAsc.listings[1].monthly_rent_equivalent === 2641
      && sortAsc.listings.every((l, i) => i === 0 || l.monthly_rent_equivalent >= sortAsc.listings[i - 1].monthly_rent_equivalent),
      sortAsc.listings.map(l => l.monthly_rent_equivalent));

    // 6. Monthly total maths: rent 15000 + mess 8000 = 23000 (fresh listing, no edits).
    const sub2 = await mgrPost(mgr0.cookie, { name: 'Calc Test Hostel', city: 'Islamabad', area: 'H-8',
      type: 'boys', room: 'single', rent_pkr: 15000, mess_included: false, mess_pkr: 8000 });
    const calc = await get(`/api/calc?listing_id=${sub2.d.listing.id}&extras=0`);
    ok('monthly total 15000 + 8000 = 23000', calc.total === 23000, calc);

    // 7. Admin wrong code 403 on hide/edit; invalid city/room 400.
    const hideWrong = await post('/api/admin/hide', { id: sub2.d.listing.id }, 'nope');
    ok('hide with wrong code is 403', hideWrong.status === 403);
    const badCity = await mgrPost(mgr0.cookie, { name: 'Bad Hostel', city: 'Karachi', area: 'Gulshan', type: 'boys', room: 'single', rent_pkr: 10000 });
    ok('invalid city rejected 400', badCity.status === 400, badCity.status);
    const badRoom = await mgrPost(mgr0.cookie, { name: 'Bad Hostel', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'penthouse', rent_pkr: 10000 });
    ok('invalid room rejected 400', badRoom.status === 400, badRoom.status);
    const badRent = await mgrPost(mgr0.cookie, { name: 'Bad Hostel', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 999999 });
    ok('rent over cap rejected 400', badRent.status === 400, badRent.status);

    // 8. Compare needs 2–3 ids.
    const cmp1 = await get('/api/compare?ids=1');
    ok('compare with 1 id is 400', cmp1.error && cmp1.error.includes('2 or 3'));
    const cmp = await get('/api/compare?ids=1,2,3');
    ok('compare returns 3 listings', cmp.listings.length === 3, cmp.listings.length);

    // 9. Hidden listings disappear from search.
    await post('/api/admin/hide', { id: sub2.d.listing.id }, 'test-admin-code');
    const afterHide = await get('/api/listings?city=Islamabad');
    ok('hidden listing absent from search', !afterHide.listings.find(l => l.id === sub2.d.listing.id));

    // ---- 10. Phase 1 auth + roles ----
    // 10a. Manager registers pending, cannot log in, shows in pending list.
    const mgrA = await reg('mgr-a@example.com', 'manager', 'mgrpass11', nextIp());
    ok('register manager returns 201 pending', mgrA.status === 201 && mgrA.d.status === 'pending' && mgrA.d.role === 'manager', mgrA);
    const mgrALoginPending = await login('mgr-a@example.com', 'mgrpass11', nextIp());
    ok('pending manager cannot log in (401 generic)', mgrALoginPending.status === 401 && mgrALoginPending.d.error === 'invalid Gmail or password', mgrALoginPending);
    const pendList = await masterGet('/api/master/managers?status=pending', MASTER);
    ok('master pending list contains the new manager',
      pendList.status === 200 && pendList.d.managers.some(m => m.gmail === 'mgr-a@example.com' && m.status === 'pending'), pendList.d);
    // 10b. Master approve activates; manager can log in; me returns role/status.
    const approveA = await masterPost('/api/master/managers/decide', { user_id: mgrA.d.id, decision: 'approve', reason: 'ok' }, MASTER);
    ok('master approve returns active', approveA.status === 200 && approveA.d.status === 'active', approveA);
    const mgrALogin = await login('mgr-a@example.com', 'mgrpass11', nextIp());
    ok('approved manager can log in', mgrALogin.status === 200 && mgrALogin.d.user.role === 'manager', mgrALogin);
    const meA = await me(mgrALogin.cookie);
    ok('me returns id/display_name/role/status, no Gmail',
      meA.status === 200 && meA.d.role === 'manager' && meA.d.status === 'active' && meA.d.gmail === undefined, meA.d);

    // 10c. Student registers active, logs in, session cookie is HttpOnly + SameSite=Lax 24h.
    const stuA = await reg('stu-a@example.com', 'student', 'stuapass1', nextIp());
    ok('register student returns 201 active', stuA.status === 201 && stuA.d.status === 'active', stuA);
    const stuALogin = await login('stu-a@example.com', 'stuapass1', nextIp());
    ok('student can log in', stuALogin.status === 200 && stuALogin.d.user.role === 'student', stuALogin);
    ok('login sets HttpOnly SameSite=Lax 24h cookie',
      stuALogin.setCookie.includes('HttpOnly') && stuALogin.setCookie.includes('SameSite=Lax') && stuALogin.setCookie.includes('Max-Age=86400'), stuALogin.setCookie);
    const meNoCookie = await me(null);
    ok('me without a cookie is 401', meNoCookie.status === 401, meNoCookie.status);
    const meTampered = await me('hostel_session=deadbeef.invalidsig');
    ok('me with a tampered cookie is 401', meTampered.status === 401, meTampered.status);

    // 10d. Wrong password / unknown Gmail: 401 with the exact generic error.
    const wrongPw = await login('stu-a@example.com', 'wrongpass1', nextIp());
    ok('login with wrong password is 401 generic', wrongPw.status === 401 && wrongPw.d.error === 'invalid Gmail or password', wrongPw);
    const unknown = await login('nobody@example.com', 'whatever12', nextIp());
    ok('login with unknown Gmail is 401 with the same generic error', unknown.status === 401 && unknown.d.error === 'invalid Gmail or password', unknown);

    // 10e. Lockout: 5 fails -> 429 on the next attempt; login works after expiry.
    const stuC = await reg('stu-c@example.com', 'student', 'stupass99', nextIp());
    ok('lockout test account registers active', stuC.status === 201 && stuC.d.status === 'active', stuC);
    const lockIp = nextIp();
    let fails401 = 0;
    for (let i = 0; i < 5; i++) {
      const f = await login('stu-c@example.com', 'wrongpass1', lockIp);
      if (f.status === 401) fails401++;
    }
    ok('5 failed logins each return 401', fails401 === 5, fails401);
    const locked = await login('stu-c@example.com', 'stupass99', lockIp);
    ok('6th login while locked is 429 even with the right password', locked.status === 429, locked);
    await new Promise(r => setTimeout(r, 2500)); // LOGIN_LOCK_SECONDS=2 in this run
    const afterLock = await login('stu-c@example.com', 'stupass99', nextIp());
    ok('login works after the lock expires', afterLock.status === 200, afterLock);

    // 10f. Logout deletes the session: me -> 401 after.
    const stuALogin2 = await login('stu-a@example.com', 'stuapass1', nextIp());
    const logout = await req('POST', '/api/auth/logout', { headers: { Cookie: stuALogin2.cookie } });
    ok('logout returns ok and clears the cookie', logout.status === 200 && logout.setCookie.includes('Max-Age=0'), logout);
    const meAfterLogout = await me(stuALogin2.cookie);
    ok('me is 401 after logout (session deleted)', meAfterLogout.status === 401, meAfterLogout.status);

    // 10g. Change password: works, old password stops, wrong old password fails.
    const stuALogin3 = await login('stu-a@example.com', 'stuapass1', nextIp());
    const chg = await req('POST', '/api/auth/change-password',
      { body: { old_password: 'stuapass1', new_password: 'stuapass2' }, headers: { Cookie: stuALogin3.cookie } });
    ok('change-password succeeds', chg.status === 200 && chg.d.ok === true, chg);
    const oldPwLogin = await login('stu-a@example.com', 'stuapass1', nextIp());
    ok('old password stops working after change', oldPwLogin.status === 401, oldPwLogin.status);
    const newPwLogin = await login('stu-a@example.com', 'stuapass2', nextIp());
    ok('new password logs in', newPwLogin.status === 200, newPwLogin.status);
    const chgWrongOld = await req('POST', '/api/auth/change-password',
      { body: { old_password: 'nope-nope1', new_password: 'stuapass3' }, headers: { Cookie: newPwLogin.cookie } });
    ok('change-password with wrong old password is 401', chgWrongOld.status === 401, chgWrongOld.status);

    // 10h. Change password rotates the session (Bijli pattern): EVERY
    // old session dies — the other one AND this browser's — and the
    // response carries a fresh cookie that works.
    const stuD = await reg('stu-d@example.com', 'student', 'studpass1', nextIp());
    const dLogin1 = await login('stu-d@example.com', 'studpass1', nextIp());
    const dLogin2 = await login('stu-d@example.com', 'studpass1', nextIp());
    ok('second login creates a second session', dLogin1.cookie && dLogin2.cookie && dLogin1.cookie !== dLogin2.cookie);
    const chgD = await req('POST', '/api/auth/change-password',
      { body: { old_password: 'studpass1', new_password: 'studpass2' }, headers: { Cookie: dLogin1.cookie } });
    ok('change-password returns a fresh session cookie', chgD.status === 200 && !!chgD.cookie && chgD.cookie !== dLogin1.cookie, chgD.setCookie);
    const meOther = await me(dLogin2.cookie);
    ok('other session is dead after change-password', meOther.status === 401, meOther.status);
    const meCurrent = await me(dLogin1.cookie);
    ok('old current session is dead after change-password (rotated)', meCurrent.status === 401, meCurrent.status);
    const meFresh = await me(chgD.cookie);
    ok('fresh cookie from change-password works', meFresh.status === 200, meFresh.status);

    // 10i. Master reject is final.
    const mgrB = await reg('mgr-b@example.com', 'manager', 'mgrpass22', nextIp());
    const rejectB = await masterPost('/api/master/managers/decide', { user_id: mgrB.d.id, decision: 'reject', reason: 'not a real hostel' }, MASTER);
    ok('master reject returns rejected', rejectB.status === 200 && rejectB.d.status === 'rejected', rejectB);
    const mgrBLogin = await login('mgr-b@example.com', 'mgrpass22', nextIp());
    ok('rejected manager still cannot log in', mgrBLogin.status === 401, mgrBLogin.status);
    const approveAfterReject = await masterPost('/api/master/managers/decide', { user_id: mgrB.d.id, decision: 'approve' }, MASTER);
    ok('approve after reject is refused (reject is final)', approveAfterReject.status === 400, approveAfterReject.status);

    // 10j. Suspend kills sessions immediately and blocks login; reinstate restores.
    const mgrC = await reg('mgr-c@example.com', 'manager', 'mgrpass33', nextIp());
    await masterPost('/api/master/managers/decide', { user_id: mgrC.d.id, decision: 'approve' }, MASTER);
    const mgrCLogin = await login('mgr-c@example.com', 'mgrpass33', nextIp());
    ok('suspend test manager logs in first', mgrCLogin.status === 200, mgrCLogin.status);
    const susp = await masterPost('/api/master/managers/suspend', { user_id: mgrC.d.id }, MASTER);
    ok('master suspend returns suspended', susp.status === 200 && susp.d.status === 'suspended', susp);
    const meSuspended = await me(mgrCLogin.cookie);
    ok('suspend kills the session immediately (me -> 401)', meSuspended.status === 401, meSuspended.status);
    const loginSuspended = await login('mgr-c@example.com', 'mgrpass33', nextIp());
    ok('suspended manager cannot log in', loginSuspended.status === 401, loginSuspended.status);
    const reinst = await masterPost('/api/master/managers/reinstate', { user_id: mgrC.d.id }, MASTER);
    ok('master reinstate returns active', reinst.status === 200 && reinst.d.status === 'active', reinst);
    const loginReinstated = await login('mgr-c@example.com', 'mgrpass33', nextIp());
    ok('reinstated manager can log in again', loginReinstated.status === 200, loginReinstated.status);

    // 10k. Master password-reset kills sessions; new password works, old fails.
    const stuE = await reg('stu-e@example.com', 'student', 'stupass55', nextIp());
    const stuELogin = await login('stu-e@example.com', 'stupass55', nextIp());
    const reset = await masterPost('/api/master/password-reset', { user_id: stuE.d.id, new_password: 'newpass999' }, MASTER);
    ok('master password-reset returns ok', reset.status === 200 && reset.d.ok === true, reset);
    const meAfterReset = await me(stuELogin.cookie);
    ok('password-reset kills the session (me -> 401)', meAfterReset.status === 401, meAfterReset.status);
    const oldAfterReset = await login('stu-e@example.com', 'stupass55', nextIp());
    ok('old password fails after reset', oldAfterReset.status === 401, oldAfterReset.status);
    const newAfterReset = await login('stu-e@example.com', 'newpass999', nextIp());
    ok('new password works after reset', newAfterReset.status === 200, newAfterReset.status);

    // 10l. Master endpoints need the code.
    const noCodeManagers = await masterGet('/api/master/managers?status=pending');
    ok('master managers without code is 403', noCodeManagers.status === 403, noCodeManagers.status);
    const wrongCodeManagers = await masterGet('/api/master/managers?status=pending', 'nope');
    ok('master managers with wrong code is 403', wrongCodeManagers.status === 403, wrongCodeManagers.status);
    const noCodeAudit = await masterGet('/api/master/audit');
    ok('master audit without code is 403', noCodeAudit.status === 403, noCodeAudit.status);
    const decideNoCode = await masterPost('/api/master/managers/decide', { user_id: mgrA.d.id, decision: 'approve' });
    ok('master decide without code is 403', decideNoCode.status === 403, decideNoCode.status);
    const decideMissing = await masterPost('/api/master/managers/decide', { user_id: 99999, decision: 'approve' }, MASTER);
    ok('master decide on a missing user is 404', decideMissing.status === 404, decideMissing.status);

    // 10m. Registration validation.
    const shortPw = await reg('short-pw@example.com', 'student', 'short', nextIp());
    ok('register with short password is 400', shortPw.status === 400, shortPw.status);
    const dup1 = await reg('dup@example.com', 'student', 'duppass11', nextIp());
    ok('first registration of a Gmail succeeds', dup1.status === 201, dup1.status);
    const dup2 = await reg('dup@example.com', 'student', 'duppass22', nextIp());
    ok('duplicate Gmail is 409', dup2.status === 409, dup2.status);
    const masterRole = await reg('master-role@example.com', 'master', 'masterpass1', nextIp());
    ok('register with role master is 400', masterRole.status === 400, masterRole.status);
    const badGmail = await reg('not-an-email', 'student', 'badpass11', nextIp());
    ok('register with invalid Gmail is 400', badGmail.status === 400, badGmail.status);
    const badPhone = await req('POST', '/api/auth/register',
      { body: { gmail: 'badphone@example.com', password: 'badpass11', display_name: 'badphone', phone: '12345', role: 'student' }, headers: { 'X-Forwarded-For': nextIp() } });
    ok('register with invalid phone is 400', badPhone.status === 400, badPhone.status);
    const noPhone = await req('POST', '/api/auth/register',
      { body: { gmail: 'nophone@example.com', password: 'nophone11', display_name: 'nophone', role: 'student' }, headers: { 'X-Forwarded-For': nextIp() } });
    ok('register without a phone succeeds (phone is optional)', noPhone.status === 201, noPhone.status);
    const health = await get('/health');
    ok('GET /health returns ok', health && health.ok === true, health);
    const extraField = await req('POST', '/api/auth/register',
      { body: { gmail: 'extra@example.com', password: 'extrapass1', display_name: 'extra', role: 'student', is_admin: true }, headers: { 'X-Forwarded-For': nextIp() } });
    ok('register with an unknown field is 400', extraField.status === 400, extraField.status);

    // 10n. Registration rate limit: 3/hour per IP, 4th is 429.
    const rlIp = '10.9.9.9';
    const rl1 = await reg('rl-1@example.com', 'student', 'rlpass111', rlIp);
    const rl2 = await reg('rl-2@example.com', 'student', 'rlpass222', rlIp);
    const rl3 = await reg('rl-3@example.com', 'student', 'rlpass333', rlIp);
    ok('first 3 registrations from one IP succeed', rl1.status === 201 && rl2.status === 201 && rl3.status === 201, [rl1.status, rl2.status, rl3.status]);
    const rl4 = await reg('rl-4@example.com', 'student', 'rlpass444', rlIp);
    ok('4th registration within the hour is 429', rl4.status === 429, rl4.status);

    // 10o. Audit trail lists the master actions (and never contains a Gmail).
    const auditRes = await masterGet('/api/master/audit', MASTER);
    const actions = (auditRes.d.audit || []).map(a => a.action);
    ok('audit lists manager approve/reject/suspend/reinstate + password reset',
      ['manager.approved', 'manager.rejected', 'manager.suspended', 'manager.reinstated', 'user.password_reset'].every(a => actions.includes(a)), actions);
    ok('audit rows contain no Gmail addresses',
      auditRes.status === 200 && !JSON.stringify(auditRes.d.audit).includes('@example.com'), auditRes.d.audit && auditRes.d.audit.length);

    // 10p. Security headers on pages and API responses.
    const homeRes = await req('GET', '/');
    ok('security headers on /',
      homeRes.headers['x-content-type-options'] === 'nosniff' && homeRes.headers['x-frame-options'] === 'SAMEORIGIN' && homeRes.headers['referrer-policy'] === 'no-referrer-when-downgrade', homeRes.headers);
    const metaRes = await req('GET', '/api/meta');
    ok('security headers on /api/meta',
      metaRes.headers['x-content-type-options'] === 'nosniff' && metaRes.headers['x-frame-options'] === 'SAMEORIGIN' && metaRes.headers['referrer-policy'] === 'no-referrer-when-downgrade', metaRes.headers);

    // 10q. XSS fix: client code escapes user strings; a hostile listing name
    // is stored as data (server does not mangle it) and escaped on render.
    const xss = await mgrPost(mgr0.cookie, { name: '<script>alert(1)</script>', city: 'Peshawar', area: 'Hayatabad',
      type: 'boys', room: 'double', rent_pkr: 15000 });
    ok('hostile listing name from a manager stores as data (201)', xss.status === 201, xss.status);
    const xssList = await get('/api/listings?city=Peshawar');
    const xssRow = xssList.listings.find(l => l.id === xss.d.listing.id);
    ok('hostile name is stored verbatim in the JSON (escaping is on render)', xssRow && xssRow.name.includes('<script>'), xssRow && xssRow.name);
    const appJs = await (await fetch(BASE + '/app.js')).text();
    ok('app.js escapes listing names/sources on render',
      appJs.includes('escapeHtml') && appJs.includes('escapeHtml(l.name)') && appJs.includes('escapeHtml(l.source)'), appJs.slice(0, 120));
    const adminJs = await (await fetch(BASE + '/admin.js')).text();
    ok('admin.js escapes listing names/sources on render',
      adminJs.includes('escapeHtml') && adminJs.includes('escapeHtml(l.name)') && adminJs.includes('escapeHtml(l.source)'), adminJs.slice(0, 120));

    // 10r. Server exits without ADMIN_CODE (fail-closed).
    {
      const DB2 = '/tmp/hostel-test-nocode-' + process.pid + '.sqlite';
      const UP2 = '/tmp/hostel-test-uploads-nocode-' + process.pid;
      const env2 = { ...process.env, PORT: '3098', DB_FILE: DB2, UPLOADS_DIR: UP2, LOGIN_LOCK_SECONDS: '2' };
      delete env2.ADMIN_CODE;
      const srv2 = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: env2, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      srv2.stderr.on('data', c => { err += c; });
      const exited = await Promise.race([
        new Promise(res => srv2.on('exit', code => res(code))),
        new Promise(res => setTimeout(() => res(null), 5000)),
      ]);
      if (exited === null) srv2.kill();
      ok('server exits without ADMIN_CODE set', exited !== null && exited !== 0, exited);
      ok('exit message is FATAL about ADMIN_CODE', err.includes('FATAL') && err.includes('ADMIN_CODE'), err.slice(0, 200));
      try { fs.unlinkSync(DB2); } catch {}
      try { fs.rmSync(UP2, { recursive: true, force: true }); } catch {}
    }

    // ---- 11. Phase 2 manager portal + listing fields ----
    const fullListing = { name: 'P2 Test Hostel', city: 'Peshawar', area: 'Hayatabad',
      near_university: 'UET Peshawar', type: 'boys', room: 'double', rent_pkr: 20000,
      mess_included: false, mess_pkr: 8000, meals_per_day: 3, facilities: ['WiFi'], source: 'p2 test' };
    const mgr1 = await makeManager('p2-mgr1@example.com');
    ok('makeManager helper: approved manager logs in', !!mgr1.cookie, mgr1);
    const mgr2 = await makeManager('p2-mgr2@example.com');

    // 11a. Create with full new fields -> 201 LISTED, owner_id set.
    const createA = await mgrPost(mgr1.cookie, { ...fullListing, room: 'double',
      maps_url: 'https://www.google.com/maps/embed?pb=!1m18!2m12!3m3!1d0!2d71.5!3d34.0',
      contact_phone: '03001234567', contact_gmail: 'hostel@example.com',
      address: 'House 12, Street 3, University Road, Peshawar',
      plus_code: 'C75C+VWV', distance_text: '1.5 km from UET Peshawar',
      rental_period: 'monthly', available_from: '2026-11-06', available_until: '2027-06-30',
      security_deposit_pkr: 10000, wifi_pkr: null, laundry_pkr: 2000,
      amenities: { wifi: { state: 'charged', price: 2000 }, mess: { state: 'included', price: null }, gym: { state: 'not_available', price: null } },
      room_types: [{ room: 'single', rent_pkr: 20000, seats: 4, mess_included: false, mess_pkr: 8000 }, { room: 'double', rent_pkr: 15000, seats: 8, mess_included: true, mess_pkr: null }],
      rules: 'No guests after 10 PM', gate_open: '06:00', gate_close: '22:00', visit_hours: '10 AM – 8 PM',
      seats_total: 20, seats_available: 5, mess_menu: 'Mon: daal chawal', mess_status: 'active' });
    ok('manager create returns 201 LISTED with owner_id', createA.status === 201 && createA.d.listing.status === 'LISTED' && createA.d.listing.owner_id === mgr1.id, createA);
    const hostA = createA.d.listing.id;
    ok('created listing carries maps embed URL + contact + rental period',
      createA.d.listing.maps_embed_url.includes('/maps/embed') && createA.d.listing.contact_phone === '03001234567' && createA.d.listing.rental_period === 'monthly', createA.d.listing);
    ok('created listing fee breakdown shows set fees, null stays Not available',
      createA.d.listing.fees.security_deposit_pkr === 10000 && createA.d.listing.fees.wifi_pkr === 'Not available' && createA.d.listing.fees.ac_pkr === 'Not available', createA.d.listing.fees);
    ok('created listing carries amenities + room types',
      createA.d.listing.amenities.wifi.state === 'charged' && createA.d.listing.room_types.length === 2, createA.d.listing);

    // 11b. Validation rejects bad maps URL / rental period / gate / date / fee / phone / unknown field.
    const badMap = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Map Hostel', maps_url: 'https://example.com/maps/embed?pb=1' });
    ok('create with a non-Google maps URL is 400', badMap.status === 400, badMap.status);
    const badMap2 = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Map 2', maps_url: 'https://www.google.com/search?q=hostel' });
    ok('create with a non-Maps google.com URL is 400', badMap2.status === 400, badMap2.status);
    const badRental = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Rental', rental_period: 'yearly' });
    ok('create with bad rental_period is 400', badRental.status === 400, badRental.status);
    const badGate = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Gate', gate_open: '25:00' });
    ok('create with bad gate time is 400', badGate.status === 400, badGate.status);
    const badDate = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Date', available_from: '2026-02-30' });
    ok('create with an impossible date is 400', badDate.status === 400, badDate.status);
    const badFee = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Fee', security_deposit_pkr: -500 });
    ok('create with a negative fee is 400', badFee.status === 400, badFee.status);
    const badMgrPhone = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Bad Phone', contact_phone: '12345' });
    ok('create with a bad phone is 400', badMgrPhone.status === 400, badMgrPhone.status);
    const unknownField = await mgrPost(mgr1.cookie, { ...fullListing, name: 'Unknown Field', is_verified: true });
    ok('create with an unknown field is 400', unknownField.status === 400, unknownField.status);
    const missingName = await mgrPost(mgr1.cookie, { city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000 });
    ok('create without a name is 400', missingName.status === 400, missingName.status);

    // 11c. Share URL (maps.google.com/maps?q=…) is accepted; detail embeds it.
    const shareCreate = await mgrPost(mgr1.cookie, { ...fullListing, name: 'P2 Share URL Hostel', maps_url: 'https://maps.google.com/maps?q=UET+Peshawar&output=embed' });
    ok('create with a Google Maps share URL succeeds', shareCreate.status === 201, shareCreate.status);
    const shareDet = await get('/api/listings/' + shareCreate.d.listing.id);
    ok('share URL detail has an embed URL', shareDet.listing.maps_embed_url.includes('maps.google.com/maps?q='), shareDet.listing.maps_embed_url);

    // 11d. Manager list is scoped: only own hostels; students + strangers blocked.
    const myList = await mgrGet(mgr1.cookie);
    ok('manager list returns only their own hostels',
      myList.status === 200 && myList.d.listings.length >= 2 && myList.d.listings.every(l => l.owner_id === mgr1.id), myList.d);
    const mgr2List = await mgrGet(mgr2.cookie);
    ok('second manager sees none of the first manager\'s hostels',
      mgr2List.status === 200 && !mgr2List.d.listings.some(l => l.owner_id === mgr1.id), mgr2List.d);
    const noCookieList = await mgrGet(null);
    ok('manager list without a cookie is 401', noCookieList.status === 401, noCookieList.status);
    const stuCreate = await mgrPost(newPwLogin.cookie, { ...fullListing, name: 'Student Hostel' });
    ok('student cannot create via the manager endpoint (403)', stuCreate.status === 403, stuCreate.status);
    const stuGetList = await mgrGet(newPwLogin.cookie);
    ok('student cannot list via the manager endpoint (403)', stuGetList.status === 403, stuGetList.status);
    const anonCreate = await mgrPost(null, { ...fullListing, name: 'Anon Hostel' });
    ok('create without a cookie is 401', anonCreate.status === 401, anonCreate.status);

    // 11e. Edit own listing fees -> 200 + price_history rows for each changed fee.
    const editA = await mgrPut(mgr1.cookie, hostA, { rent_pkr: 21000, security_deposit_pkr: 15000, wifi_pkr: 2000,
      room_types: [{ room: 'single', rent_pkr: 22000, seats: 4, mess_included: false, mess_pkr: 8000 }, { room: 'double', rent_pkr: 15000, seats: 8, mess_included: true, mess_pkr: null }] });
    ok('manager edit of own listing is 200', editA.status === 200, editA);
    const detA = await get('/api/listings/' + hostA);
    const fields = detA.history.map(h => h.field);
    ok('fee edits wrote price_history rows (rent, deposit, wifi, room single)',
      ['rent_pkr', 'security_deposit_pkr', 'wifi_pkr', 'room_types:single'].every(f => fields.includes(f)) && !fields.includes('room_types:double'), detA.history);
    ok('edited values show on the listing', detA.listing.rent_pkr === 21000 && detA.listing.security_deposit_pkr === 15000 && detA.listing.wifi_pkr === 2000, detA.listing);
    ok('manager edit did not verify the listing (still LISTED)', detA.listing.status === 'LISTED', detA.listing.status);

    // 11f. Foreign ids -> 403: another manager's hostel, and a legacy ownerless one.
    const foreignEdit = await mgrPut(mgr2.cookie, hostA, { rent_pkr: 9999 });
    ok('editing another manager\'s hostel is 403', foreignEdit.status === 403, foreignEdit.status);
    const legacyEdit = await mgrPut(mgr1.cookie, 1, { rent_pkr: 9999 });
    ok('editing a legacy ownerless listing as a manager is 403', legacyEdit.status === 403, legacyEdit.status);
    const foreignDel = await mgrDel(mgr2.cookie, hostA);
    ok('hiding another manager\'s hostel is 403', foreignDel.status === 403, foreignDel.status);
    const missingEdit = await mgrPut(mgr1.cookie, 99999, { rent_pkr: 9999 });
    ok('editing a missing listing is 404', missingEdit.status === 404, missingEdit.status);

    // 11g. A manager cannot verify their own listing (no master code -> 403).
    const mgrVerify = await req('POST', '/api/admin/verify', { body: { id: hostA, source_note: 'my own hostel' }, headers: { Cookie: mgr1.cookie } });
    ok('manager verify attempt without the master code is 403', mgrVerify.status === 403, mgrVerify.status);

    // 11h. Master assign: legacy listing -> manager, then that manager can edit it.
    const assign = await masterPost('/api/master/listings/assign', { listing_id: 3, manager_id: mgr2.id }, MASTER);
    ok('master assign of a legacy listing is 200', assign.status === 200 && assign.d.manager_id === mgr2.id, assign);
    const assignedEdit = await mgrPut(mgr2.cookie, 3, { wifi_pkr: 1500 });
    ok('assigned manager can now edit the legacy listing', assignedEdit.status === 200, assignedEdit.status);
    const assignAgain = await masterPost('/api/master/listings/assign', { listing_id: 3, manager_id: mgr1.id }, MASTER);
    ok('assigning an already-owned listing is 400', assignAgain.status === 400, assignAgain.status);
    const assignStudent = await masterPost('/api/master/listings/assign', { listing_id: 4, manager_id: stuA.d.id }, MASTER);
    ok('assigning to a student (non-manager) is 400', assignStudent.status === 400, assignStudent.status);
    const mgrP = await reg('p2-mgr-pending@example.com', 'manager', 'mgrpass99', nextIp());
    const assignPending = await masterPost('/api/master/listings/assign', { listing_id: 4, manager_id: mgrP.d.id }, MASTER);
    ok('assigning to a pending (not active) manager is 400', assignPending.status === 400, assignPending.status);
    const assignNoCode = await masterPost('/api/master/listings/assign', { listing_id: 4, manager_id: mgr2.id });
    ok('assign without the master code is 403', assignNoCode.status === 403, assignNoCode.status);
    const assignMissing = await masterPost('/api/master/listings/assign', { listing_id: 99999, manager_id: mgr2.id }, MASTER);
    ok('assign of a missing listing is 404', assignMissing.status === 404, assignMissing.status);

    // 11i. Delete (hide) own listing -> hidden, absent from public search; master restores it.
    const delA = await mgrDel(mgr1.cookie, hostA);
    ok('manager hide of own listing is 200', delA.status === 200 && delA.d.hidden === true, delA);
    const afterDelSearch = await get('/api/listings?city=Peshawar');
    ok('hidden listing absent from public search', !afterDelSearch.listings.find(l => l.id === hostA), afterDelSearch.listings.map(l => l.id));
    const afterDelDetail = await get('/api/listings/' + hostA);
    ok('hidden listing detail is 404', afterDelDetail.error === 'not found', afterDelDetail);
    const myAfterDel = await mgrGet(mgr1.cookie);
    const hiddenRow = myAfterDel.d.listings.find(l => l.id === hostA);
    ok('manager still sees their own hidden listing, flagged hidden', !!hiddenRow && hiddenRow.hidden === true, hiddenRow);
    const restore = await masterPost('/api/master/listings/restore', { listing_id: hostA }, MASTER);
    ok('master restore returns ok', restore.status === 200 && restore.d.ok === true, restore);
    const afterRestore = await get('/api/listings?city=Peshawar');
    ok('restored listing is back in public search', !!afterRestore.listings.find(l => l.id === hostA), afterRestore.listings.map(l => l.id));

    // 11j. Public detail: unset charges read "Not available", empty rental period is honest.
    const minCreate = await mgrPost(mgr1.cookie, { name: 'P2 Minimal Hostel', city: 'Lahore', area: 'Gulberg', type: 'girls', room: 'single', rent_pkr: 12000 });
    ok('minimal manager create succeeds', minCreate.status === 201, minCreate.status);
    const minDet = await get('/api/listings/' + minCreate.d.listing.id);
    ok('unset charges read Not available on public detail',
      minDet.listing.fees.security_deposit_pkr === 'Not available' && minDet.listing.fees.wifi_pkr === 'Not available' && minDet.listing.fees.electricity_pkr === 'Not available', minDet.listing.fees);
    ok('empty rental period reads "Rental period not stated"',
      minDet.listing.rental_period_display === 'Rental period not stated' && minDet.listing.rental_period === '', minDet.listing);
    ok('minimal listing has empty amenities/room types and no map embed',
      Array.isArray(minDet.listing.room_types) && minDet.listing.room_types.length === 0 && minDet.listing.maps_embed_url === '' && minDet.listing.contact_phone === '', minDet.listing);

    // 11k. Legacy rows untouched: seed listings keep their old fields, no owner.
    const leg1 = await get('/api/listings/1');
    ok('legacy VERIFIED row 1 keeps its old fields and no owner',
      leg1.listing.name === 'UET Lahore Hostel — Dormitory (subsidized)' && leg1.listing.status === 'VERIFIED' && leg1.listing.rent_pkr === 11644 && (leg1.listing.owner_id === null || leg1.listing.owner_id === undefined), leg1.listing);
    ok('legacy row detail shows Not available fees + not-stated rental period',
      leg1.listing.fees.security_deposit_pkr === 'Not available' && leg1.listing.rental_period_display === 'Rental period not stated', leg1.listing);
    const leg4 = await get('/api/listings/4');
    ok('legacy LISTED row 4 still LISTED with its published rent',
      leg4.listing.status === 'LISTED' && leg4.listing.rent_pkr === 12000, leg4.listing);
    const leg3 = await get('/api/listings/3');
    ok('assigned legacy row 3 now shows its manager owner',
      leg3.listing.owner_id === mgr2.id, leg3.listing);
    const seedNames = (await get('/api/listings?show_examples=1')).listings.filter(l => l.id <= 9).map(l => l.status).sort().join(',');
    ok('all 9 seed rows still present (2 VERIFIED, 4 LISTED, 3 EXAMPLE)',
      seedNames === 'EXAMPLE,EXAMPLE,EXAMPLE,LISTED,LISTED,LISTED,LISTED,VERIFIED,VERIFIED', seedNames);

    // 11l. Suspended manager cannot edit (session dies on suspend).
    const mgr3 = await makeManager('p2-mgr3@example.com');
    const mgr3Listing = await mgrPost(mgr3.cookie, { ...fullListing, name: 'P2 Mgr3 Hostel' });
    ok('suspend-test manager creates a listing first', mgr3Listing.status === 201, mgr3Listing.status);
    const mgr3Id = mgr3Listing.d.listing.id;
    await masterPost('/api/master/managers/suspend', { user_id: mgr3.id }, MASTER);
    const suspEdit = await mgrPut(mgr3.cookie, mgr3Id, { rent_pkr: 9999 });
    ok('suspended manager edit is 401/403 (session dead)', suspEdit.status === 401 || suspEdit.status === 403, suspEdit.status);
    const suspLogin = await login('p2-mgr3@example.com', 'mgrpass99', nextIp());
    ok('suspended manager cannot log in', suspLogin.status === 401, suspLogin.status);

    // 11m. Pages: /login (chooser), /login-student, /login-manager and
    // their JS serve; index links to the chooser login.
    const loginPage = await (await fetch(BASE + '/login')).text();
    ok('/login is a chooser with two links and NO login form',
      loginPage.includes('href="/login-student"') && loginPage.includes('href="/login-manager"') &&
      !loginPage.includes('<form') && !loginPage.includes('id="mgrLogin"') && !loginPage.includes('id="stuLogin"'),
      loginPage.slice(0, 200));
    const stuPage = await (await fetch(BASE + '/login-student')).text();
    ok('/login-student serves the student login + register only (no manager form)',
      stuPage.includes('Log in as Student') && stuPage.includes('id="stuLogin"') &&
      stuPage.includes('id="stuRegister"') && stuPage.includes('value="student"') &&
      !stuPage.includes('id="mgrLogin"') && !stuPage.includes('id="mgrRegister"') &&
      !stuPage.includes('Log in as Manager</h2>'),
      stuPage.slice(0, 200));
    const mgrPage = await (await fetch(BASE + '/login-manager')).text();
    ok('/login-manager serves the manager login + register only (no student form)',
      mgrPage.includes('Log in as Manager') && mgrPage.includes('id="mgrLogin"') &&
      mgrPage.includes('id="mgrRegister"') && mgrPage.includes('value="manager"') &&
      mgrPage.includes('waiting for master approval') &&
      !mgrPage.includes('id="stuLogin"') && !mgrPage.includes('id="stuRegister"') &&
      !mgrPage.includes('Log in as Student</h2>'),
      mgrPage.slice(0, 200));
    const portalPage = await (await fetch(BASE + '/manager')).text();
    ok('/manager serves the manager portal with the public-phone warning',
      portalPage.includes('My hostels') && portalPage.includes('will be shown publicly') && portalPage.includes('Photos are stored on this server and are lost if the site is redeployed'), portalPage.slice(0, 200));
    const stuLoginJs = await (await fetch(BASE + '/login-student.js')).text();
    ok('/login-student.js serves and posts to the auth endpoints',
      stuLoginJs.includes('/api/auth/login') && stuLoginJs.includes('/api/auth/register'), stuLoginJs.slice(0, 120));
    const mgrLoginJs = await (await fetch(BASE + '/login-manager.js')).text();
    ok('/login-manager.js serves and posts to the auth endpoints',
      mgrLoginJs.includes('/api/auth/login') && mgrLoginJs.includes('/api/auth/register'), mgrLoginJs.slice(0, 120));
    const shellJsFile = await (await fetch(BASE + '/shell.js')).text();
    ok('/shell.js serves the shared topnav shell (avatar + bell + log-out)',
      shellJsFile.includes('loadShellUser') && shellJsFile.includes('/api/auth/me') && shellJsFile.includes('navLogoutBtn'),
      shellJsFile.slice(0, 120));
    const loginGone = await fetch(BASE + '/login.js');
    ok('/login.js is gone (404) — no shared login script any more', loginGone.status === 404, loginGone.status);
    const mgrJs = await (await fetch(BASE + '/manager.js')).text();
    ok('/manager.js serves and escapes listing names on render',
      mgrJs.includes('/api/manager/listings') && mgrJs.includes('escapeHtml'), mgrJs.slice(0, 120));
    const homeHtml = await (await fetch(BASE + '/')).text();
    ok('index links to the login chooser', homeHtml.includes('href="/login"') && homeHtml.includes('>Log in</a>') && !homeHtml.includes('Manager / Student'), homeHtml.slice(0, 300));
    const adminHtml = await (await fetch(BASE + '/admin')).text();
    ok('admin page has pending-managers + audit-trail sections',
      adminHtml.includes('Pending managers') && adminHtml.includes('Audit trail'), adminHtml.slice(0, 300));
    const meta2 = await get('/api/meta');
    ok('meta exposes amenities + rental periods + fee fields',
      Array.isArray(meta2.amenities) && meta2.amenities.length === 17 && meta2.rental_periods.length === 5 && meta2.fee_fields.length === 7, meta2);

    // ---- 12. Phase 3 photos ----
    // Minimal real image bytes (magic bytes only — no real picture needed).
    const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('fakepngdata')]);
    const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0x00, 0x00, 0x00]), Buffer.from('WEBP'), Buffer.from('fakedata')]);
    function multipart(fields, file) {
      const boundary = '----testboundary' + process.pid;
      const parts = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      if (file) parts.push(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`), file.data, Buffer.from('\r\n')]));
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return { body: Buffer.concat(parts), boundary };
    }
    const uploadPhoto = (cookie, fields, file) => {
      const { body, boundary } = multipart(fields, file);
      return new Promise((resolve, reject) => {
        const r = httpMod.request({ host: '127.0.0.1', port: PORT, path: '/api/manager/photos', method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, ...(cookie ? { Cookie: cookie } : {}) } }, res => {
          let s = ''; res.on('data', c => { s += c; }); res.on('end', () => { let d; try { d = JSON.parse(s); } catch { d = s; } resolve({ status: res.statusCode, d, headers: res.headers }); });
        });
        r.on('error', reject); r.write(body); r.end();
      });
    };
    const fileGet = (p, cookie) => req('GET', p, { headers: cookie ? { Cookie: cookie } : {} });
    const jpegFile = { field: 'photo', filename: 'gate.jpg', contentType: 'image/jpeg', data: JPEG };

    const photoHostel = await mgrPost(mgr1.cookie, { ...fullListing, name: 'P3 Photo Hostel' });
    ok('photo test hostel created', photoHostel.status === 201, photoHostel.status);
    const phId = photoHostel.d.listing.id;

    // 12a. Real JPEG upload -> 200, approved, random stored name, file on disk.
    const up1 = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'hostel', caption: 'Front gate' }, jpegFile);
    ok('manager uploads a real JPEG for their own listing (200, approved)',
      up1.status === 200 && up1.d.photo && up1.d.photo.status === 'approved' && up1.d.photo.kind === 'hostel' && up1.d.photo.caption === 'Front gate', up1);
    ok('stored filename is random photo-<32 hex>.jpg, never the upload name',
      /^photo-[0-9a-f]{32}\.jpg$/.test(up1.d.photo.filename) && up1.d.photo.filename !== 'gate.jpg', up1.d.photo.filename);
    ok('uploaded JPEG file exists on disk under the uploads dir',
      fs.existsSync(path.join(UPLOADS, up1.d.photo.filename)));
    const fetchJpeg = await fileGet('/api/photos/file/' + up1.d.photo.filename);
    ok('public GET of the approved JPEG is 200 with image MIME + nosniff',
      fetchJpeg.status === 200 && (fetchJpeg.headers['content-type'] || '').startsWith('image/jpeg') && fetchJpeg.headers['x-content-type-options'] === 'nosniff', fetchJpeg.headers);

    // 12b. Real PNG + WebP uploads -> 200 with the right MIME on fetch.
    const upPng = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'room', caption: '' },
      { field: 'photo', filename: 'room.png', contentType: 'image/png', data: PNG });
    ok('manager uploads a real PNG (200, approved)', upPng.status === 200 && upPng.d.photo.status === 'approved', upPng);
    const fetchPng = await fileGet('/api/photos/file/' + upPng.d.photo.filename);
    ok('public GET of the approved PNG is 200 image/png',
      fetchPng.status === 200 && (fetchPng.headers['content-type'] || '').startsWith('image/png'), fetchPng.headers);
    const upWebp = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'mess', caption: 'Mess hall' },
      { field: 'photo', filename: 'mess.webp', contentType: 'image/webp', data: WEBP });
    ok('manager uploads a real WebP (200, approved)', upWebp.status === 200 && upWebp.d.photo.status === 'approved', upWebp);
    const fetchWebp = await fileGet('/api/photos/file/' + upWebp.d.photo.filename);
    ok('public GET of the approved WebP is 200 image/webp',
      fetchWebp.status === 200 && (fetchWebp.headers['content-type'] || '').startsWith('image/webp'), fetchWebp.headers);

    // 12c. Magic bytes rule: .jpg extension with PNG bytes -> 400; text renamed .jpg -> 400.
    const badMagic = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'hostel', caption: '' },
      { field: 'photo', filename: 'fake.jpg', contentType: 'image/jpeg', data: PNG });
    ok('.jpg extension with PNG magic bytes is 400', badMagic.status === 400, badMagic.status);
    const textAsJpg = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'hostel', caption: '' },
      { field: 'photo', filename: 'notes.jpg', contentType: 'image/jpeg', data: Buffer.from('hello, this is plain text, not an image') });
    ok('text file renamed .jpg is 400', textAsJpg.status === 400, textAsJpg.status);
    const webpAsPng = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'hostel', caption: '' },
      { field: 'photo', filename: 'fake.png', contentType: 'image/png', data: WEBP });
    ok('.png extension with WebP magic bytes is 400', webpAsPng.status === 400, webpAsPng.status);

    // 12d. Oversize -> 413; kind review + caption over 120 -> 400.
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const upBig = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'hostel', caption: '' },
      { field: 'photo', filename: 'big.jpg', contentType: 'image/jpeg', data: big });
    ok('upload over 5 MB is 413', upBig.status === 413, upBig.status);
    const reviewKind = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'review', caption: '' }, jpegFile);
    ok('manager upload with kind review is 400 (review photos come in Phase 4)', reviewKind.status === 400, reviewKind.status);
    const longCaption = await uploadPhoto(mgr1.cookie, { listing_id: String(phId), kind: 'hostel', caption: 'x'.repeat(121) }, jpegFile);
    ok('caption over 120 chars is 400', longCaption.status === 400, longCaption.status);

    // 12e. Ownership: foreign hostel -> 403; student -> 403; anonymous -> 401.
    const foreignUp = await uploadPhoto(mgr2.cookie, { listing_id: String(phId), kind: 'hostel', caption: '' }, jpegFile);
    ok('upload to another manager\'s hostel is 403', foreignUp.status === 403, foreignUp.status);
    const stuUp = await uploadPhoto(newPwLogin.cookie, { listing_id: String(phId), kind: 'hostel', caption: '' }, jpegFile);
    ok('upload as a student is 403', stuUp.status === 403, stuUp.status);
    const anonUp = await uploadPhoto(null, { listing_id: String(phId), kind: 'hostel', caption: '' }, jpegFile);
    ok('upload without a cookie is 401', anonUp.status === 401, anonUp.status);
    const missingUp = await uploadPhoto(mgr1.cookie, { listing_id: '99999', kind: 'hostel', caption: '' }, jpegFile);
    ok('upload to a missing listing is 404', missingUp.status === 404, missingUp.status);

    // 12f. Cap: 8 photos on one hostel, the 9th is 400.
    const capHostel = await mgrPost(mgr1.cookie, { ...fullListing, name: 'P3 Cap Hostel' });
    const capId = capHostel.d.listing.id;
    let capOk = 0;
    for (let i = 0; i < 8; i++) {
      const r = await uploadPhoto(mgr1.cookie, { listing_id: String(capId), kind: 'hostel', caption: 'photo ' + (i + 1) },
        { field: 'photo', filename: 'p' + i + '.jpg', contentType: 'image/jpeg', data: JPEG });
      if (r.status === 200) capOk++;
    }
    ok('8 photos upload to one hostel', capOk === 8, capOk);
    const ninth = await uploadPhoto(mgr1.cookie, { listing_id: String(capId), kind: 'hostel', caption: 'ninth' },
      { field: 'photo', filename: 'p9.jpg', contentType: 'image/jpeg', data: JPEG });
    ok('9th photo on one hostel is 400', ninth.status === 400, ninth.status);

    // 12g. Path traversal is blocked and never serves server.js.
    const trav = await fetch(BASE + '/api/photos/file/..%2F..%2Fserver.js');
    const travText = await trav.text();
    ok('path traversal GET is 400/404 and never serves server.js',
      (trav.status === 400 || trav.status === 404) && !travText.includes('Hostel + Mess Index'), trav.status);
    const trav2 = await fetch(BASE + '/api/photos/file/%2e%2e%2fserver.js');
    ok('encoded-dot traversal GET is 400/404', trav2.status === 400 || trav2.status === 404, trav2.status);
    const unknownFile = await fileGet('/api/photos/file/photo-00000000000000000000000000000000.jpg');
    ok('GET of an unknown stored name is 404', unknownFile.status === 404, unknownFile.status);

    // 12h. Manager photo list: own photos, all statuses; foreign hostel -> 403.
    const mgrPhotos = await req('GET', '/api/manager/photos?listing_id=' + phId, { headers: { Cookie: mgr1.cookie } });
    ok('manager photo list returns their own photos for the listing',
      mgrPhotos.status === 200 && mgrPhotos.d.photos.length === 3 && mgrPhotos.d.photos.every(p => p.url === '/api/photos/file/' + p.filename), mgrPhotos.d);
    const mgrPhotosForeign = await req('GET', '/api/manager/photos?listing_id=' + phId, { headers: { Cookie: mgr2.cookie } });
    ok('manager photo list for another manager\'s hostel is 403', mgrPhotosForeign.status === 403, mgrPhotosForeign.status);
    const mgrPhotosAnon = await req('GET', '/api/manager/photos?listing_id=' + phId, {});
    ok('manager photo list without a cookie is 401', mgrPhotosAnon.status === 401, mgrPhotosAnon.status);

    // 12i. Public detail returns approved photos only, with kind + caption + URL.
    const detPh = await get('/api/listings/' + phId);
    ok('public detail returns photos (approved only, with kind + caption + URL)',
      Array.isArray(detPh.photos) && detPh.photos.length === 3
      && detPh.photos.some(p => p.kind === 'mess' && p.caption === 'Mess hall' && p.url === '/api/photos/file/' + p.filename), detPh.photos);

    // 12j. Pending photo (inserted directly in the test DB, as Phase 4 will
    // create them): never public, visible to its owning manager only.
    const pendingName = 'photo-' + 'a'.repeat(32) + '.jpg';
    fs.writeFileSync(path.join(UPLOADS, pendingName), JPEG);
    const tdb = new DatabaseSync(DB);
    tdb.prepare(`INSERT INTO photos(listing_id, uploader_id, kind, filename, caption, status)
      VALUES(?,?,?,?,?,'pending')`).run(phId, mgr1.id, 'hostel', pendingName, 'waiting');
    tdb.close();
    const pendPublic = await fileGet('/api/photos/file/' + pendingName);
    ok('pending photo is NOT served publicly (404)', pendPublic.status === 404, pendPublic.status);
    const pendOwner = await fileGet('/api/photos/file/' + pendingName, mgr1.cookie);
    ok('pending photo IS served to its owning manager (200)', pendOwner.status === 200, pendOwner.status);
    const pendOther = await fileGet('/api/photos/file/' + pendingName, mgr2.cookie);
    ok('pending photo is NOT served to another manager (404)', pendOther.status === 404, pendOther.status);
    const detPh2 = await get('/api/listings/' + phId);
    ok('public detail still lists only the 3 approved photos (pending excluded)',
      Array.isArray(detPh2.photos) && detPh2.photos.length === 3 && !detPh2.photos.some(p => p.filename === pendingName), detPh2.photos);
    const mgrPhotos2 = await req('GET', '/api/manager/photos?listing_id=' + phId, { headers: { Cookie: mgr1.cookie } });
    ok('manager photo list includes the pending photo (all statuses)',
      mgrPhotos2.status === 200 && mgrPhotos2.d.photos.some(p => p.status === 'pending' && p.filename === pendingName), mgrPhotos2.d);

    // 12k. Delete own photo -> file + row gone; delete another's -> 403.
    const delOwn = await req('POST', '/api/manager/photos/' + upPng.d.photo.id + '/delete', { headers: { Cookie: mgr1.cookie } });
    ok('manager deletes their own photo (200)', delOwn.status === 200 && delOwn.d.ok === true, delOwn);
    ok('deleted photo file is gone from disk', !fs.existsSync(path.join(UPLOADS, upPng.d.photo.filename)));
    const goneGet = await fileGet('/api/photos/file/' + upPng.d.photo.filename);
    ok('deleted photo is 404 on public GET', goneGet.status === 404, goneGet.status);
    const foreignPhotoDel = await req('POST', '/api/manager/photos/' + up1.d.photo.id + '/delete', { headers: { Cookie: mgr2.cookie } });
    ok('deleting another manager\'s photo is 403', foreignPhotoDel.status === 403, foreignPhotoDel.status);
    const delMissing = await req('POST', '/api/manager/photos/99999/delete', { headers: { Cookie: mgr1.cookie } });
    ok('deleting a missing photo is 404', delMissing.status === 404, delMissing.status);

    // 12l. Master delete removes any photo (file + row); needs the code.
    const masterDelNoCode = await req('POST', '/api/master/photos/' + up1.d.photo.id + '/delete', {});
    ok('master delete without the code is 403', masterDelNoCode.status === 403, masterDelNoCode.status);
    const masterDel = await masterPost('/api/master/photos/' + up1.d.photo.id + '/delete', {}, MASTER);
    ok('master deletes any photo (200)', masterDel.status === 200 && masterDel.d.ok === true, masterDel);
    ok('master-deleted photo file is gone from disk', !fs.existsSync(path.join(UPLOADS, up1.d.photo.filename)));
    const masterDelMissing = await masterPost('/api/master/photos/99999/delete', {}, MASTER);
    ok('master delete of a missing photo is 404', masterDelMissing.status === 404, masterDelMissing.status);

    // ---- 13. Phase 4 student reviews ----
    const makeStudent = async gmail => {
      const r = await reg(gmail, 'student', 'stupass99', nextIp());
      const l = await login(gmail, 'stupass99', nextIp());
      return { id: r.d.id, cookie: l.cookie };
    };
    const submitReview = (cookie, body) => req('POST', '/api/reviews', { body, headers: cookie ? { Cookie: cookie } : {} });
    const editReview = (cookie, id, body) => req('PUT', '/api/reviews/' + id, { body, headers: cookie ? { Cookie: cookie } : {} });
    const deleteReview = (cookie, id) => req('POST', '/api/reviews/' + id + '/delete', { headers: cookie ? { Cookie: cookie } : {} });
    const mgrDecide = (cookie, body) => req('POST', '/api/manager/reviews/decide', { body, headers: cookie ? { Cookie: cookie } : {} });
    const mgrReply = (cookie, body) => req('POST', '/api/manager/reviews/reply', { body, headers: cookie ? { Cookie: cookie } : {} });
    const mgrReviews = cookie => req('GET', '/api/manager/reviews', { headers: cookie ? { Cookie: cookie } : {} });
    const stuReviews = cookie => req('GET', '/api/student/reviews', { headers: cookie ? { Cookie: cookie } : {} });
    const pubReviews = lid => get('/api/listings/' + lid + '/reviews');
    const uploadReviewPhoto = (cookie, reviewId, file, caption) => {
      const { body, boundary } = multipart({ caption: caption || '' }, file);
      return new Promise((resolve, reject) => {
        const r = httpMod.request({ host: '127.0.0.1', port: PORT, path: '/api/reviews/' + reviewId + '/photo', method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, ...(cookie ? { Cookie: cookie } : {}) } }, res => {
          let s = ''; res.on('data', c => { s += c; }); res.on('end', () => { let d; try { d = JSON.parse(s); } catch { d = s; } resolve({ status: res.statusCode, d, headers: res.headers }); });
        });
        r.on('error', reject); r.write(body); r.end();
      });
    };

    // 13a. Submit as a student -> 201 pending, invisible in public + summary.
    const stuR1 = await makeStudent('p4-stu1@example.com');
    const stuR2 = await makeStudent('p4-stu2@example.com');
    const stuR3 = await makeStudent('p4-stu3@example.com');
    const rev1 = await submitReview(stuR1.cookie, { listing_id: hostA, rating: 5, categories: { cleanliness: 5, food: 4, security: 5, location: 4, value: 5 }, title: 'Great stay', body: 'Clean rooms and friendly staff.' });
    ok('student submits a review -> 201 pending', rev1.status === 201 && rev1.d.review.status === 'pending' && rev1.d.review.rating === 5 && rev1.d.review.categories.cleanliness === 5, rev1);
    const rev1Id = rev1.d.review.id;
    const pubBefore = await pubReviews(hostA);
    ok('pending review is invisible in the public review list', pubBefore.reviews.length === 0, pubBefore.reviews);
    const detBefore = await get('/api/listings/' + hostA);
    ok('pending review is invisible in the detail summary (average null, count 0, unpublished 1)',
      detBefore.review_summary.average_rating === null && detBefore.review_summary.review_count === 0 && detBefore.review_summary.unpublished_review_count === 1
      && detBefore.review_summary.honest_label === 'Student review — the site has not verified this student lived here.', detBefore.review_summary);
    const mgrQueue = await mgrReviews(mgr1.cookie);
    ok('manager queue lists the pending review (pending first)',
      mgrQueue.status === 200 && mgrQueue.d.reviews.some(r => r.id === rev1Id && r.status === 'pending'), mgrQueue.d);

    // 13b. Manager approves -> 200, public, counted in the average.
    const approve1 = await mgrDecide(mgr1.cookie, { review_id: rev1Id, decision: 'approve' });
    ok('manager approves a review -> 200 approved', approve1.status === 200 && approve1.d.review.status === 'approved', approve1);
    const pubAfter = await pubReviews(hostA);
    ok('approved review shows in the public list with display name only (never Gmail)',
      pubAfter.reviews.length === 1 && pubAfter.reviews[0].reviewer_name === 'p4-stu1'
      && !JSON.stringify(pubAfter.reviews).includes('@example.com'), pubAfter.reviews);
    ok('public review carries the honest label',
      pubAfter.reviews[0].honest_label === 'Student review — the site has not verified this student lived here.', pubAfter.reviews[0]);
    const detAfter = await get('/api/listings/' + hostA);
    ok('approved review counts in the detail average (5.0 over 1, unpublished 0)',
      detAfter.review_summary.average_rating === 5 && detAfter.review_summary.review_count === 1 && detAfter.review_summary.unpublished_review_count === 0, detAfter.review_summary);

    // 13c. Reject flow: no reason 400, invalid reason 400, valid reason 200,
    // review stays in the DB, master sees it, public counts it unpublished.
    const rev2 = await submitReview(stuR2.cookie, { listing_id: hostA, rating: 2, title: 'Not good', body: 'Mess food was cold every day.' });
    ok('second student submits a review -> 201 pending', rev2.status === 201 && rev2.d.review.status === 'pending', rev2);
    const rev2Id = rev2.d.review.id;
    const rejNoReason = await mgrDecide(mgr1.cookie, { review_id: rev2Id, decision: 'reject' });
    ok('reject without a reason is 400', rejNoReason.status === 400, rejNoReason.status);
    const rejBadReason = await mgrDecide(mgr1.cookie, { review_id: rev2Id, decision: 'reject', reason: 'rude' });
    ok('reject with an invalid reason is 400', rejBadReason.status === 400, rejBadReason.status);
    const rejOk = await mgrDecide(mgr1.cookie, { review_id: rev2Id, decision: 'reject', reason: 'spam', note: 'looks copied' });
    ok('reject with a valid reason is 200 rejected', rejOk.status === 200 && rejOk.d.review.status === 'rejected' && rejOk.d.review.decide_reason.includes('spam'), rejOk);
    const pubAfterReject = await pubReviews(hostA);
    ok('rejected review stays out of the public list', pubAfterReject.reviews.length === 1 && !pubAfterReject.reviews.some(r => r.id === rev2Id), pubAfterReject.reviews);
    const detAfterReject = await get('/api/listings/' + hostA);
    ok('rejected review shows as unpublished in the summary (count 1)',
      detAfterReject.review_summary.unpublished_review_count === 1 && detAfterReject.review_summary.review_count === 1, detAfterReject.review_summary);
    const masterRejected = await masterGet('/api/master/reviews?status=rejected', MASTER);
    ok('master sees the rejected review with its reason',
      masterRejected.status === 200 && masterRejected.d.reviews.some(r => r.id === rev2Id && r.decide_reason.includes('spam')), masterRejected.d);
    const masterAll = await masterGet('/api/master/reviews?status=all', MASTER);
    ok('master ?status=all lists approved + rejected reviews',
      masterAll.status === 200 && masterAll.d.reviews.some(r => r.id === rev1Id) && masterAll.d.reviews.some(r => r.id === rev2Id), masterAll.d);

    // 13d. Master overturn rejected -> approve -> public; overturn approved
    // -> hide -> out of public; reply add / remove.
    const overturnApprove = await masterPost('/api/master/reviews/overturn', { review_id: rev2Id, decision: 'approve', reason: 'not spam, genuine complaint' }, MASTER);
    ok('master overturn of a rejected review -> approve (200)', overturnApprove.status === 200 && overturnApprove.d.review.status === 'approved', overturnApprove);
    const pubOverturn = await pubReviews(hostA);
    ok('overturned review is public now (2 reviews, average 3.5)',
      pubOverturn.reviews.length === 2 && pubOverturn.summary.average_rating === 3.5 && pubOverturn.summary.review_count === 2, pubOverturn.summary);
    const replyOk = await mgrReply(mgr1.cookie, { review_id: rev2Id, reply: 'Sorry about the mess — we have changed the cook.' });
    ok('manager reply is 200', replyOk.status === 200 && replyOk.d.ok === true, replyOk);
    const pubReply = await pubReviews(hostA);
    const replied = pubReply.reviews.find(r => r.id === rev2Id);
    ok('manager reply shows under the review publicly', !!replied && replied.manager_reply.includes('changed the cook'), replied);
    const replyLong = await mgrReply(mgr1.cookie, { review_id: rev2Id, reply: 'x'.repeat(1001) });
    ok('reply over 1000 chars is 400', replyLong.status === 400, replyLong.status);
    const delReply = await masterPost('/api/master/reviews/reply/delete', { review_id: rev2Id }, MASTER);
    ok('master removes a manager reply -> 200', delReply.status === 200 && delReply.d.ok === true, delReply);
    const pubNoReply = await pubReviews(hostA);
    ok('reply is gone from the public review after master removal',
      pubNoReply.reviews.find(r => r.id === rev2Id).manager_reply === '', pubNoReply.reviews);
    const overturnHide = await masterPost('/api/master/reviews/overturn', { review_id: rev1Id, decision: 'hide', reason: 'master check' }, MASTER);
    ok('master overturn of an approved review -> hide (200)', overturnHide.status === 200 && overturnHide.d.review.status === 'hidden', overturnHide);
    const pubHidden = await pubReviews(hostA);
    ok('hidden review is out of the public list (only the 2-star one left)',
      pubHidden.reviews.length === 1 && pubHidden.reviews[0].id === rev2Id, pubHidden.reviews);

    // 13e. One review per hostel, edit rules, delete rules.
    const rev3 = await submitReview(stuR3.cookie, { listing_id: hostA, rating: 4, title: 'Good', body: 'Decent place, close to campus.' });
    ok('third student submits a review -> 201 pending', rev3.status === 201, rev3);
    const rev3Id = rev3.d.review.id;
    const dup = await submitReview(stuR3.cookie, { listing_id: hostA, rating: 1, body: 'Second try.' });
    ok('second review for the same hostel by the same student is 409 (edit instead)',
      dup.status === 409 && dup.d.error.includes('edit instead'), dup);
    const editOwn = await editReview(stuR3.cookie, rev3Id, { rating: 3, title: 'Good, mostly' });
    ok('edit own pending review is 200, still pending', editOwn.status === 200 && editOwn.d.review.status === 'pending' && editOwn.d.review.rating === 3, editOwn);
    const editOther = await editReview(stuR1.cookie, rev3Id, { rating: 1, body: 'hijack' });
    ok('edit another student\'s review is 403', editOther.status === 403, editOther.status);
    const editApproved = await editReview(stuR2.cookie, rev2Id, { rating: 4, body: 'Updated: the mess improved after my complaint.' });
    ok('edit an approved review sends it back to pending', editApproved.status === 200 && editApproved.d.review.status === 'pending', editApproved);
    const pubEditBack = await pubReviews(hostA);
    ok('edited (re-pending) review is out of the public list', pubEditBack.reviews.length === 0, pubEditBack.reviews);
    const delOther = await deleteReview(stuR3.cookie, rev2Id);
    ok('delete another student\'s review is 403', delOther.status === 403, delOther.status);
    const delOwnRev = await deleteReview(stuR3.cookie, rev3Id);
    ok('delete own review is 200', delOwnRev.status === 200 && delOwnRev.d.ok === true, delOwnRev);
    const stuR3List = await stuReviews(stuR3.cookie);
    ok('deleted review is gone from the student\'s own list',
      stuR3List.status === 200 && !stuR3List.d.reviews.some(r => r.id === rev3Id), stuR3List.d);
    const editRejected = await editReview(stuR2.cookie, rev2Id, { body: 'trying to edit while pending again' });
    ok('edit own pending review again still works (200)', editRejected.status === 200, editRejected);

    // 13f. Review photos: 3 OK, 4th 400; pending until approval, then public;
    // deleting the review deletes its photos (files + rows).
    const stuR4 = await makeStudent('p4-stu4@example.com');
    const rev4 = await submitReview(stuR4.cookie, { listing_id: 3, rating: 5, title: 'Loved it', body: 'Great rooms.' });
    ok('review on the second manager\'s hostel submits (201)', rev4.status === 201, rev4);
    const rev4Id = rev4.d.review.id;
    const phNames = [];
    let phOk = 0;
    for (let i = 0; i < 3; i++) {
      const up = await uploadReviewPhoto(stuR4.cookie, rev4Id,
        { field: 'photo', filename: 'room' + i + '.jpg', contentType: 'image/jpeg', data: JPEG }, 'room ' + (i + 1));
      if (up.status === 200 && up.d.photo.status === 'pending') { phOk++; phNames.push(up.d.photo.filename); }
    }
    ok('3 review photos upload (200, pending)', phOk === 3, phOk);
    const pubPhBefore = await pubReviews(3);
    ok('review photos are pending until approval (no public review yet)', pubPhBefore.reviews.length === 0, pubPhBefore.reviews);
    const pendFile = await fileGet('/api/photos/file/' + phNames[0]);
    ok('pending review photo is NOT served publicly (404)', pendFile.status === 404, pendFile.status);
    const pendFileOwner = await fileGet('/api/photos/file/' + phNames[0], stuR4.cookie);
    ok('pending review photo IS served to its student owner (200)', pendFileOwner.status === 200, pendFileOwner.status);
    const fourth = await uploadReviewPhoto(stuR4.cookie, rev4Id,
      { field: 'photo', filename: 'room4.jpg', contentType: 'image/jpeg', data: JPEG }, 'fourth');
    ok('4th review photo is 400', fourth.status === 400, fourth.status);
    const approve4 = await mgrDecide(mgr2.cookie, { review_id: rev4Id, decision: 'approve' });
    ok('manager approves the review with photos', approve4.status === 200 && approve4.d.review.status === 'approved', approve4);
    const pubPhAfter = await pubReviews(3);
    ok('approved review shows publicly with its 3 photos',
      pubPhAfter.reviews.length === 1 && pubPhAfter.reviews[0].photos.length === 3, pubPhAfter.reviews);
    const pubFile = await fileGet('/api/photos/file/' + phNames[0]);
    ok('approved review photo is served publicly (200)', pubFile.status === 200, pubFile.status);
    const delRev4 = await deleteReview(stuR4.cookie, rev4Id);
    ok('delete review with photos is 200', delRev4.status === 200, delRev4);
    ok('deleted review photos are gone from disk', !phNames.some(n => fs.existsSync(path.join(UPLOADS, n))));
    const gonePh = await fileGet('/api/photos/file/' + phNames[0]);
    ok('deleted review photo is 404 on public GET', gonePh.status === 404, gonePh.status);

    // 13g. Abuse guards: URLs stripped, phone/CNIC rejected, bad values 400.
    const stuR5 = await makeStudent('p4-stu5@example.com');
    const urlRev = await submitReview(stuR5.cookie, { listing_id: hostA, rating: 4, body: 'Nice place, see https://example.com/photos for pics.' });
    ok('review with a URL submits (201)', urlRev.status === 201, urlRev);
    ok('URL is stripped from the stored body',
      urlRev.d.review.body && !urlRev.d.review.body.includes('example.com') && !urlRev.d.review.body.includes('http'), urlRev.d.review.body);
    const stuR6 = await makeStudent('p4-stu6@example.com');
    const phoneRev = await submitReview(stuR6.cookie, { listing_id: hostA, rating: 4, body: 'Call me on 03001234567 about this.' });
    ok('review body with a phone number is 400', phoneRev.status === 400, phoneRev.status);
    const cnicRev = await submitReview(stuR6.cookie, { listing_id: hostA, rating: 4, body: 'My CNIC is 35202-1234567-1.' });
    ok('review body with a CNIC number is 400', cnicRev.status === 400, cnicRev.status);
    const badRating = await submitReview(stuR6.cookie, { listing_id: hostA, rating: 6, body: 'Too high.' });
    ok('rating 6 is 400', badRating.status === 400, badRating.status);
    const badCat = await submitReview(stuR6.cookie, { listing_id: hostA, rating: 4, categories: { cleanliness: 9 }, body: 'Bad category.' });
    ok('category value 9 is 400', badCat.status === 400, badCat.status);
    const longBody = await submitReview(stuR6.cookie, { listing_id: hostA, rating: 4, body: 'x'.repeat(2001) });
    ok('body over 2000 chars is 400', longBody.status === 400, longBody.status);
    const longTitle = await submitReview(stuR6.cookie, { listing_id: hostA, rating: 4, title: 'x'.repeat(121), body: 'Long title.' });
    ok('title over 120 chars is 400', longTitle.status === 400, longTitle.status);
    const anonRev = await submitReview(null, { listing_id: hostA, rating: 5, body: 'Anonymous.' });
    ok('submit without a cookie is 401', anonRev.status === 401, anonRev.status);
    const missingRev = await submitReview(stuR6.cookie, { listing_id: 99999, rating: 5, body: 'Missing hostel.' });
    ok('review for a missing listing is 404', missingRev.status === 404, missingRev.status);

    // 13h. Average counts APPROVED only: approved 5 + approved 3 + pending 1
    // -> average 4.0 over 2, not 3.
    const avgHostel = await mgrPost(mgr1.cookie, { name: 'P4 Average Hostel', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000 });
    ok('average-test hostel created', avgHostel.status === 201, avgHostel.status);
    const avgId = avgHostel.d.listing.id;
    const stuAvgA = await makeStudent('p4-avga@example.com');
    const stuAvgB = await makeStudent('p4-avgb@example.com');
    const stuAvgC = await makeStudent('p4-avgc@example.com');
    const rA = await submitReview(stuAvgA.cookie, { listing_id: avgId, rating: 5, body: 'Excellent.' });
    const rB = await submitReview(stuAvgB.cookie, { listing_id: avgId, rating: 3, body: 'Average.' });
    const rC = await submitReview(stuAvgC.cookie, { listing_id: avgId, rating: 1, body: 'Bad, waiting for check.' });
    ok('three reviews submit for the average test', rA.status === 201 && rB.status === 201 && rC.status === 201, [rA.status, rB.status, rC.status]);
    await mgrDecide(mgr1.cookie, { review_id: rA.d.review.id, decision: 'approve' });
    await mgrDecide(mgr1.cookie, { review_id: rB.d.review.id, decision: 'approve' });
    const detAvg = await get('/api/listings/' + avgId);
    ok('average is 4.0 over 2 approved reviews (pending 1-star excluded), unpublished 1',
      detAvg.review_summary.average_rating === 4 && detAvg.review_summary.review_count === 2 && detAvg.review_summary.unpublished_review_count === 1, detAvg.review_summary);
    const pubAvg = await pubReviews(avgId);
    ok('public review list for the average test has exactly the 2 approved reviews',
      pubAvg.reviews.length === 2 && pubAvg.reviews.every(r => r.status === 'approved'), pubAvg.reviews);

    // 13i. Ownership + roles: foreign manager 403, student cannot approve,
    // manager reply on another's hostel 403, master endpoints need the code.
    const stuR7 = await makeStudent('p4-stu7@example.com');
    const rev7 = await submitReview(stuR7.cookie, { listing_id: hostA, rating: 5, body: 'Foreign-hostel test.' });
    ok('review for the foreign-manager test submits', rev7.status === 201, rev7);
    const foreignDecide = await mgrDecide(mgr2.cookie, { review_id: rev7.d.review.id, decision: 'approve' });
    ok('manager deciding a review on another manager\'s hostel is 403', foreignDecide.status === 403, foreignDecide.status);
    const foreignReply = await mgrReply(mgr2.cookie, { review_id: rev7.d.review.id, reply: 'Hello from the wrong manager.' });
    ok('manager replying to a review on another manager\'s hostel is 403', foreignReply.status === 403, foreignReply.status);
    const stuDecide = await mgrDecide(stuR7.cookie, { review_id: rev7.d.review.id, decision: 'approve' });
    ok('student cannot approve anything (POST decide as a student is 403)', stuDecide.status === 403, stuDecide.status);
    const stuReply = await mgrReply(stuR7.cookie, { review_id: rev7.d.review.id, reply: 'Student reply.' });
    ok('student cannot reply as a manager (403)', stuReply.status === 403, stuReply.status);
    const masterNoCode = await masterGet('/api/master/reviews?status=rejected');
    ok('master reviews without the code is 403', masterNoCode.status === 403, masterNoCode.status);
    const overturnMissing = await masterPost('/api/master/reviews/overturn', { review_id: 99999, decision: 'approve' }, MASTER);
    ok('master overturn of a missing review is 404', overturnMissing.status === 404, overturnMissing.status);
    const mgrQueueForeign = await req('GET', '/api/manager/reviews?listing_id=' + hostA, { headers: { Cookie: mgr2.cookie } });
    ok('manager review queue for another manager\'s listing is 403', mgrQueueForeign.status === 403, mgrQueueForeign.status);
    const stuOwnList = await stuReviews(stuR7.cookie);
    ok('student reviews list shows only their own reviews with statuses',
      stuOwnList.status === 200 && stuOwnList.d.reviews.length === 1 && stuOwnList.d.reviews[0].status === 'pending', stuOwnList.d);

    // 13j. Daily limit: 5 reviews/day per student, the 6th is 429.
    const stuR8 = await makeStudent('p4-stu8@example.com');
    const dailyIds = [];
    for (let i = 0; i < 6; i++) {
      const cr = await mgrPost(mgr1.cookie, { name: 'P4 Daily Hostel ' + (i + 1), city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000 });
      if (cr.status === 201) dailyIds.push(cr.d.listing.id);
    }
    ok('6 daily-limit hostels created', dailyIds.length === 6, dailyIds.length);
    let dailyOk = 0;
    for (let i = 0; i < 5; i++) {
      const r = await submitReview(stuR8.cookie, { listing_id: dailyIds[i], rating: 4, body: 'Daily review ' + (i + 1) + '.' });
      if (r.status === 201) dailyOk++;
    }
    ok('first 5 reviews in a day succeed', dailyOk === 5, dailyOk);
    const sixth = await submitReview(stuR8.cookie, { listing_id: dailyIds[5], rating: 4, body: 'Sixth review today.' });
    ok('6th review in a day is 429', sixth.status === 429, sixth.status);

    // 13k. Pages: /hostel + /hostel.js serve; app.js links to the detail
    // page; manager.js has the reviews queue; admin.js has rejected reviews.
    const hostelPage = await (await fetch(BASE + '/hostel?id=1')).text();
    ok('/hostel serves the detail page with reviews + price history sections',
      hostelPage.includes('Student reviews') && hostelPage.includes('Price history') && hostelPage.includes('/hostel.js'), hostelPage.slice(0, 200));
    const hostelJs = await (await fetch(BASE + '/hostel.js')).text();
    ok('/hostel.js serves and escapes review text/replies on render',
      hostelJs.includes('escapeHtml') && hostelJs.includes('Open in Google Maps') && hostelJs.includes('escapeHtml(r.body)') && hostelJs.includes('escapeHtml(r.manager_reply)'), hostelJs.slice(0, 120));
    const appJs2 = await (await fetch(BASE + '/app.js')).text();
    ok('app.js links each listing card to the detail page',
      appJs2.includes('/hostel?id=') && appJs2.includes('Price history &amp; details'), appJs2.slice(0, 120));
    const mgrJs2 = await (await fetch(BASE + '/manager.js')).text();
    ok('manager.js has the reviews queue with the fixed reject-reason list',
      mgrJs2.includes('/api/manager/reviews') && mgrJs2.includes('abusive language') && mgrJs2.includes('fake or staged'), mgrJs2.slice(0, 120));
    const adminJs2 = await (await fetch(BASE + '/admin.js')).text();
    ok('admin.js has the rejected-reviews section with overturn',
      adminJs2.includes('/api/master/reviews') && adminJs2.includes('Overturn'), adminJs2.slice(0, 120));

    // ---- 14. Phase 5 final review: fixes found in the security re-check ----
    // 14a. Suspended-manager marking (plan Roles rule): a suspended
    // manager's listings stay visible but are marked honestly.
    const suspMark = await masterPost('/api/master/managers/suspend', { user_id: mgr1.id }, MASTER);
    ok('suspend mgr1 for the marking test', suspMark.status === 200, suspMark.status);
    const detSusp = await get('/api/listings/' + hostA);
    ok('suspended manager\'s listing stays public but is flagged manager_suspended',
      detSusp.listing.manager_suspended === true, detSusp.listing.manager_suspended);
    const searchSusp = await get('/api/listings?city=Peshawar');
    ok('suspended manager\'s listing still appears in public search',
      !!searchSusp.listings.find(l => l.id === hostA), searchSusp.listings.map(l => l.id));
    const detLegacy = await get('/api/listings/1');
    ok('ownerless legacy listing is not flagged suspended',
      detLegacy.listing.manager_suspended === false, detLegacy.listing.manager_suspended);
    const hostelJs5 = await (await fetch(BASE + '/hostel.js')).text();
    ok('hostel.js renders the suspended-manager notice',
      hostelJs5.includes('Manager suspended — contact the site admin'), hostelJs5.slice(0, 120));
    const appJs5 = await (await fetch(BASE + '/app.js')).text();
    ok('app.js renders the suspended-manager notice + Write a review link',
      appJs5.includes('Manager suspended — contact the site admin') && appJs5.includes('Write a review'), appJs5.slice(0, 120));
    const reinst1 = await masterPost('/api/master/managers/reinstate', { user_id: mgr1.id }, MASTER);
    ok('reinstate mgr1 after the marking test', reinst1.status === 200, reinst1.status);
    const detReinst = await get('/api/listings/' + hostA);
    ok('reinstated manager\'s listing is no longer flagged',
      detReinst.listing.manager_suspended === false, detReinst.listing.manager_suspended);

    // 14b. Reject-after-approve hides the review's photos too (Phase 5 fix:
    // setReviewPhotosStatus used to leave approved photos public when a
    // review was rejected after approval).
    const stuP5 = await makeStudent('p5-stu1@example.com');
    const revP5 = await submitReview(stuP5.cookie, { listing_id: 3, rating: 5, title: 'Photo test', body: 'Great rooms, see the photo.' });
    ok('reject-after-approve test review submits', revP5.status === 201, revP5.status);
    const revP5Id = revP5.d.review.id;
    const revP5Ph = await uploadReviewPhoto(stuP5.cookie, revP5Id,
      { field: 'photo', filename: 'room.jpg', contentType: 'image/jpeg', data: JPEG }, 'my room');
    ok('review photo uploads (pending)', revP5Ph.status === 200 && revP5Ph.d.photo.status === 'pending', revP5Ph);
    const revP5PhName = revP5Ph.d.photo.filename;
    const approveP5 = await mgrDecide(mgr2.cookie, { review_id: revP5Id, decision: 'approve' });
    ok('manager approves the photo review', approveP5.status === 200 && approveP5.d.review.status === 'approved', approveP5);
    const phPublic = await fileGet('/api/photos/file/' + revP5PhName);
    ok('approved review photo is public (200)', phPublic.status === 200, phPublic.status);
    const rejectP5 = await mgrDecide(mgr2.cookie, { review_id: revP5Id, decision: 'reject', reason: 'spam' });
    ok('manager rejects the previously approved review', rejectP5.status === 200 && rejectP5.d.review.status === 'rejected', rejectP5);
    const phAfterReject = await fileGet('/api/photos/file/' + revP5PhName);
    ok('rejected-after-approval review photo is NOT public (404)', phAfterReject.status === 404, phAfterReject.status);
    const detP5 = await get('/api/listings/3');
    ok('rejected review photo is out of the public detail gallery',
      Array.isArray(detP5.photos) && !detP5.photos.some(p => p.filename === revP5PhName), detP5.photos);
    const pubP5 = await pubReviews(3);
    ok('rejected review is out of the public review list', pubP5.reviews.length === 0, pubP5.reviews);

    // 14c. Admin verify/hide/edit write audit rows (Phase 5 fix: the legacy
    // admin endpoints wrote no audit rows at all).
    // mgr1's session died when it was suspended + reinstated earlier, so
    // the audit listing comes from a fresh approved manager.
    const auditMgr = await makeManager('p5-audit-mgr@example.com');
    const auditListing = await mgrPost(auditMgr.cookie, { name: 'P5 Audit Hostel', city: 'Lahore', area: 'Gulberg',
      type: 'boys', room: 'single', rent_pkr: 13000 });
    ok('audit-test listing created by a manager', auditListing.status === 201, auditListing.status);
    const auditId = auditListing.d.listing.id;
    await post('/api/admin/verify', { id: auditId, source_note: 'P5 audit test source' }, 'test-admin-code');
    await post('/api/admin/edit', { id: auditId, rent_pkr: 14000 }, 'test-admin-code');
    await post('/api/admin/hide', { id: auditId }, 'test-admin-code');
    const audit5 = await masterGet('/api/master/audit', MASTER);
    const actions5 = (audit5.d.audit || []).map(a => a.action + ':' + a.target_id);
    ok('audit lists listing.verified + listing.updated + listing.hidden for the admin actions',
      actions5.includes('listing.verified:' + auditId) && actions5.includes('listing.updated:' + auditId)
      && actions5.includes('listing.hidden:' + auditId), actions5.slice(0, 12));

    // 14d. Boundary validation (Phase 5 fixes): manager create + admin
    // edit + login/master unknown fields + calc/listings query params.
    // (The old community-submit boundary tests moved here: the manager
    // endpoint is now the only create route and shares the same parser.)
    const commUnknown = await mgrPost(auditMgr.cookie, { name: 'P5 Unknown', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000, is_verified: true });
    ok('manager create with an unknown field is 400', commUnknown.status === 400, commUnknown.status);
    const commLongName = await mgrPost(auditMgr.cookie, { name: 'x'.repeat(101), city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000 });
    ok('manager create with a 101-char name is 400', commLongName.status === 400, commLongName.status);
    const commBadMeals = await mgrPost(auditMgr.cookie, { name: 'P5 Meals', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000, meals_per_day: -1 });
    ok('manager create with meals_per_day -1 is 400', commBadMeals.status === 400, commBadMeals.status);
    const commBadFac = await mgrPost(auditMgr.cookie, { name: 'P5 Fac', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000, facilities: ['swimming pool'] });
    ok('manager create with an unknown facility is 400', commBadFac.status === 400, commBadFac.status);
    const commFloatRent = await mgrPost(auditMgr.cookie, { name: 'P5 Float', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000.5 });
    ok('manager create with a float rent is 400', commFloatRent.status === 400, commFloatRent.status);
    const adminBadRent = await post('/api/admin/edit', { id: auditId, rent_pkr: 'abc' }, 'test-admin-code');
    ok('admin edit with rent "abc" is 400 (not a crash)', adminBadRent.status === 400, adminBadRent.status);
    const adminBadJson = await req('POST', '/api/admin/edit', { body: 'not json', headers: { 'X-Admin-Code': 'test-admin-code' } });
    ok('admin edit with invalid JSON is 400', adminBadJson.status === 400, adminBadJson.status);
    const adminHideMissing = await post('/api/admin/hide', { id: 99999 }, 'test-admin-code');
    ok('admin hide of a missing listing is 404', adminHideMissing.status === 404, adminHideMissing.status);
    const loginUnknown = await req('POST', '/api/auth/login',
      { body: { gmail: 'stu-a@example.com', password: 'stuapass2', is_admin: true }, headers: { 'X-Forwarded-For': nextIp() } });
    ok('login with an unknown field is 400', loginUnknown.status === 400, loginUnknown.status);
    const decideUnknown = await masterPost('/api/master/managers/decide', { user_id: mgrA.d.id, decision: 'approve', extra: 1 }, MASTER);
    ok('master decide with an unknown field is 400', decideUnknown.status === 400, decideUnknown.status);
    const calcNeg = await get('/api/calc?listing_id=1&extras=-5');
    ok('calc with negative extras is 400', calcNeg.error === 'invalid extras', calcNeg);
    const maxRentBad = await get('/api/listings?max_rent=abc');
    ok('listings with max_rent=abc is 400', maxRentBad.error === 'invalid max_rent', maxRentBad);

    // 14e. Photo daily limit: 20 uploads/day per manager, the 21st is 429
    // (Phase 5 fix: it used to return 400 like a cap, not a rate limit).
    const mgrDaily = await makeManager('p5-mgrdaily@example.com');
    const dailyHostels = [];
    for (let i = 0; i < 3; i++) {
      const cr = await mgrPost(mgrDaily.cookie, { ...fullListing, name: 'P5 Daily Hostel ' + (i + 1) });
      if (cr.status === 201) dailyHostels.push(cr.d.listing.id);
    }
    ok('3 daily-limit hostels created', dailyHostels.length === 3, dailyHostels.length);
    let dailyUpOk = 0;
    const plan14e = [[0, 8], [1, 8], [2, 4]];
    for (const [hi, n] of plan14e) {
      for (let i = 0; i < n; i++) {
        const up = await uploadPhoto(mgrDaily.cookie, { listing_id: String(dailyHostels[hi]), kind: 'hostel', caption: '' },
          { field: 'photo', filename: 'd' + hi + '-' + i + '.jpg', contentType: 'image/jpeg', data: JPEG });
        if (up.status === 200) dailyUpOk++;
      }
    }
    ok('first 20 uploads in a day succeed', dailyUpOk === 20, dailyUpOk);
    const up21 = await uploadPhoto(mgrDaily.cookie, { listing_id: String(dailyHostels[2]), kind: 'hostel', caption: '' },
      { field: 'photo', filename: 'd21.jpg', contentType: 'image/jpeg', data: JPEG });
    ok('21st upload in a day is 429', up21.status === 429, up21.status);

    // 15. Phase 1 shell: design tokens in public/styles.css must pass
    // WCAG AA 4.5:1 for every text/background pair the shell uses, and
    // the shell structure must be present in index.html. Pure file
    // checks — no server needed. Tokens are parsed from the real CSS,
    // not copied here, so a token change that breaks contrast fails.
    const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
    const rootBlock = (css.match(/:root\s*\{([\s\S]*?)\}/) || [])[1] || '';
    const tokens = {};
    for (const m of rootBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
    const chan = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = rgb => 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
    const parseColor = s => {
      if (!s) return null;
      const hex = s.match(/^#([0-9a-f]{6})$/i);
      if (hex) return [0, 2, 4].map(i => parseInt(hex[1].substr(i, 2), 16));
      const rgba = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
      if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]];
      return null;
    };
    const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const blendOver = (fg, bg) => { const a = fg[3] === undefined ? 1 : fg[3]; return fg.slice(0, 3).map((v, i) => Math.round(v * a + bg[i] * (1 - a))); };
    const need = ['bg', 'surface', 'text', 'text-muted', 'accent-text', 'accent-btn', 'glass'];
    const parsed = {};
    for (const n of need) parsed[n] = parseColor(tokens[n]);
    const tokensOk = need.every(n => !!parsed[n]);
    ok('contrast tokens all parse as colours', tokensOk, tokens);
    if (tokensOk) {
      const cr = (fg, bg, label) => ok('contrast ' + label + ' >= 4.5:1', ratio(fg, bg) >= 4.5, ratio(fg, bg).toFixed(2));
      cr(parsed['text'], parsed['bg'], 'text on app background');
      cr(parsed['text-muted'], parsed['bg'], 'muted text on app background');
      cr(parsed['text'], parsed['surface'], 'text on white card');
      cr(parsed['text-muted'], parsed['surface'], 'muted text on white card');
      cr(parsed['accent-text'], parsed['bg'], 'orange text on app background');
      cr(parsed['accent-text'], parsed['surface'], 'orange text on white card');
      cr([255, 255, 255], parsed['accent-btn'], 'white text on orange button');
      cr(parsed['text'], blendOver(parsed['glass'], parsed['bg']), 'text on frosted glass card');
    }
    const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    ok('index has the shell (topnav + icon rail + greeting + scene zoom)',
      indexHtml.includes('class="topnav"') && indexHtml.includes('class="rail"') &&
      indexHtml.includes('id="greetingTitle"') && indexHtml.includes('id="zoomIn"') &&
      indexHtml.includes('id="sceneInner"'), 'shell ids missing');
    ok('glass cards lift on hover like the reel', css.includes('translateY(-5px)'), 'no -5px lift in CSS');
    ok('index shell adds no external asset (no img, no http URL, no CDN)',
      !indexHtml.includes('<img') && !indexHtml.includes('http://') && !indexHtml.includes('https://'),
      'external reference found in index.html');

    // 16. Phase 2 3D scene: the map is built from real /api/listings data
    // only — one block per VERIFIED/LISTED hostel, EXAMPLE rows never in
    // the scene, wall chart from real rents, student labels only from
    // approved reviews, honest empty state. Pure functions are tested
    // directly (the BEGIN/END SCENE section is extracted from app.js
    // and evaluated standalone in Node); live data is tested
    // against the running server; files are checked for the scene
    // structure, the <a> blocks and the no-raw-HTML rule.
    // The scene lives in app.js (server.js serves static files from a
    // fixed per-file list and this phase does not change it), so the pure
    // scene functions are tested by extracting the BEGIN/END SCENE
    // section from app.js and evaluating it standalone in Node.
    const appJsFile = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const sceneStart = appJsFile.indexOf('// ---- BEGIN SCENE');
    const sceneEnd = appJsFile.indexOf('// ---- END SCENE ----');
    const sceneSrc = appJsFile.slice(sceneStart, sceneEnd);
    const sceneMod = { exports: {} };
    new Function('module', 'window', 'document', sceneSrc)(sceneMod, undefined, undefined);
    const Scene = sceneMod.exports;
    const fakeRows = [
      { id: 1, status: 'VERIFIED' }, { id: 2, status: 'LISTED' },
      { id: 3, status: 'EXAMPLE' }, { id: 4, status: 'LISTED' },
      { id: 5, status: 'HIDDEN' }, null, undefined,
    ];
    ok('sceneListings keeps VERIFIED + LISTED only (EXAMPLE never in the scene)',
      Scene.sceneListings(fakeRows).map(l => l.id).join(',') === '1,2,4', Scene.sceneListings(fakeRows));
    const liveAll = await get('/api/listings');
    ok('scene block count equals the listed count from the API',
      Scene.sceneListings(liveAll.listings).length === liveAll.counts.total,
      { blocks: Scene.sceneListings(liveAll.listings).length, total: liveAll.counts.total });
    const liveWithEx = await get('/api/listings?show_examples=1');
    ok('EXAMPLE rows are excluded from the scene even when the API returns them',
      Scene.sceneListings(liveWithEx.listings).length === liveWithEx.counts.total &&
      liveWithEx.listings.some(l => l.status === 'EXAMPLE'), liveWithEx.listings.length);
    ok('every block routes to its hostel detail page (/hostel?id=N)',
      liveAll.listings.every(l => Scene.detailUrl(l) === '/hostel?id=' + l.id),
      liveAll.listings.map(Scene.detailUrl));
    const chart = Scene.chartData(liveAll.listings);
    ok('wall-chart values equal the real monthly rents from /api/listings',
      chart.rows.length === liveAll.counts.total &&
      chart.rows.every(r => {
        const l = liveAll.listings.find(x => x.id === r.id);
        return l && r.monthlyRent === l.monthly_rent_equivalent;
      }), chart.rows.map(r => r.monthlyRent));
    ok('wall-chart bars scale to the max rent (tallest = 56px, zero = 0)',
      chart.max === Math.max(...chart.rows.map(r => r.monthlyRent)) &&
      Scene.barHeight(chart.max, chart.max) === 56 &&
      Scene.barHeight(0, chart.max) === 0 &&
      Scene.barHeight(chart.max, chart.max) >= Scene.barHeight(Math.min(...chart.rows.map(r => r.monthlyRent)), chart.max),
      { max: chart.max });
    const uetDorm = liveAll.listings.find(l => l.name.includes('Dormitory'));
    const uetCub = liveAll.listings.find(l => l.name.includes('Cubicle'));
    ok('semester hostels chart as the monthly equivalent (÷6), labelled so',
      uetDorm && uetCub &&
      Scene.monthlyRent(uetDorm) === Math.round(uetDorm.rent_pkr / 6) &&
      Scene.monthlyRent(uetCub) === Math.round(uetCub.rent_pkr / 6) &&
      Scene.rentLabel(uetDorm) === 'Rs 11,644 /semester' && chart.hasSemester === true,
      { dorm: uetDorm && Scene.monthlyRent(uetDorm), cub: uetCub && Scene.monthlyRent(uetCub) });
    ok('student labels come only from approved-review data',
      Scene.studentLabel([]) === null && Scene.studentLabel(null) === null &&
      Scene.studentLabel([{ reviewer_name: 'Student' }]) === null &&
      Scene.studentLabel([{ reviewer_name: 'Ayesha Khan' }]) === 'Ayesha Khan',
      'label rule broken');
    const seedRev1 = await pubReviews(1);
    ok('a hostel with no approved reviews gets no name label',
      Scene.studentLabel(seedRev1.reviews) === null, seedRev1.reviews);
    // Fresh approved review (hostA's reviews were hidden / re-pended /
    // deleted by the section-13 flow, so build one here instead).
    const sceneMgr = await makeManager('p6-scene-mgr@example.com');
    const sceneHostel = await mgrPost(sceneMgr.cookie, { ...fullListing, name: 'Scene Label Hostel' });
    const sceneStu = await makeStudent('p6-scene-stu@example.com');
    const sceneRev = await submitReview(sceneStu.cookie, { listing_id: sceneHostel.d.listing.id, rating: 5, body: 'Clean rooms.' });
    const sceneApprove = await mgrDecide(sceneMgr.cookie, { review_id: sceneRev.d.review.id, decision: 'approve' });
    const scenePub = await pubReviews(sceneHostel.d.listing.id);
    ok('a label, when present, matches a real approved review author',
      sceneHostel.status === 201 && sceneRev.status === 201 && sceneApprove.status === 200 &&
      scenePub.reviews.length === 1 && Scene.studentLabel(scenePub.reviews) === 'p6-scene-stu',
      scenePub.reviews);
    ok('scene empty state when no hostels are listed',
      Scene.sceneListings([]).length === 0 && Scene.layout([]).count === 0 &&
      sceneSrc.includes('No hostels listed yet') &&
      sceneSrc.includes('The hostel map could not be loaded'),
      'empty-state strings missing from the scene section');
    ok('index loads the scene from app.js and the Phase 1 placeholder is gone',
      appJsFile.includes('// ---- BEGIN SCENE') && appJsFile.includes('// ---- END SCENE ----') &&
      appJsFile.includes('Scene.loadScene()') &&
      !indexHtml.includes('scene-placeholder') && !indexHtml.includes('Coming in Phase 2'),
      'scene section missing from app.js or placeholder still in index.html');
    ok('scene CSS has the isometric floor, wall screen and room blocks',
      css.includes('.scene3d') && css.includes('.iso-floor') && css.includes('.room-block') &&
      css.includes('rotateX(60deg)') && css.includes('rotateZ(-45deg)') &&
      css.includes('.wall-screen') && css.includes('.room-block:focus-visible'),
      'scene classes/transforms missing from styles.css');
    ok('scene blocks are real links with an accessible name (no div click targets)',
      sceneSrc.includes("el('a', 'room-block'") && sceneSrc.includes('aria-label') &&
      sceneSrc.includes('detailUrl(l)'), 'blocks are not <a> elements');
    ok('scene renders user strings with textContent only (no raw HTML, no images, no external URLs)',
      !sceneSrc.includes('.innerHTML') && !sceneSrc.includes('<img') &&
      !sceneSrc.includes('http://') && !sceneSrc.includes('https://'),
      'raw HTML or external reference in the scene section');
    const six = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, status: 'LISTED' }));
    const lay6 = Scene.layout(six);
    ok('6 hostels lay out as 2 rows of 3, every block inside the floor',
      lay6.rows === 2 && lay6.blocks.length === 6 && lay6.floorH === 425 &&
      lay6.blocks.every(b => b.x + 170 <= 640 && b.y + 105 <= lay6.floorH - 140),
      lay6);
    ok('a 7th hostel adds a third row instead of being dropped',
      Scene.layout([...six, { id: 7, status: 'VERIFIED' }]).rows === 3 &&
      Scene.layout([...six, { id: 7, status: 'VERIFIED' }]).count === 7,
      '7th hostel not laid out');
    ok('zoom control still wires to #sceneInner after the scene lands',
      indexHtml.includes('id="zoomIn"') && indexHtml.includes('id="zoomOut"') &&
      indexHtml.includes('id="zoomLevel"') &&
      appJsFile.includes("$('sceneInner').style.transform = 'scale('"),
      'zoom wiring changed');

    // 17. Phase 3 stat cards + Ask Hostel AI panel: every number is
    // computed from the same live API data in-test (never hardcoded);
    // each chip performs its real action on the list + the scene; the
    // panel carries the honest line and no fake-AI text; empty states
    // stay honest. Pure functions are tested directly (the BEGIN/END
    // STATS section is extracted from app.js and evaluated standalone
    // in Node, like the scene section in §16); live data is tested
    // against the running server.
    const statsStart = appJsFile.indexOf('// ---- BEGIN STATS');
    const statsEnd = appJsFile.indexOf('// ---- END STATS ----');
    const statsSrc = appJsFile.slice(statsStart, statsEnd);
    const statsMod = { exports: {} };
    new Function('module', 'window', 'document', statsSrc)(statsMod, undefined, undefined);
    const Stats = statsMod.exports;
    // Live numbers: fetch the same API data the page uses and compute
    // every stat independently in-test, then compare.
    const liveAll3 = await get('/api/listings');
    const liveListed3 = Stats.statListings(liveAll3.listings);
    const liveReviewsById = {};
    await Promise.all(liveListed3.map(async l => {
      const r = await pubReviews(l.id);
      liveReviewsById[l.id] = r.reviews || [];
    }));
    const liveStats = Stats.computeStats(liveAll3.listings, liveReviewsById);
    const expHostels = liveAll3.counts.total;
    const expRooms = liveListed3.reduce((s, l) =>
      s + (Array.isArray(l.room_types) ? l.room_types.reduce((a, t) =>
        a + (typeof t.seats === 'number' && t.seats > 0 ? t.seats : 0), 0) : 0), 0);
    const expReviews = Object.values(liveReviewsById).reduce((s, rs) => s + rs.length, 0);
    const expCheapest = Math.min(...liveListed3.map(l => l.monthly_rent_equivalent));
    ok('stat cards equal the numbers computed from the same live API data (hostels, rooms, reviews, cheapest)',
      liveStats.hostels === expHostels && liveStats.rooms === expRooms &&
      liveStats.reviews === expReviews && liveStats.cheapest === expCheapest,
      { liveStats, expHostels, expRooms, expReviews, expCheapest });
    const seatRows = [
      { id: 1, status: 'VERIFIED', rent_pkr: 10000, price_basis: 'month',
        room_types: [{ room: 'single', seats: 4 }, { room: 'double', seats: null }] },
      { id: 2, status: 'LISTED', rent_pkr: 12000, price_basis: 'month', room_types: [] },
      { id: 3, status: 'LISTED', rent_pkr: 15000, price_basis: 'month' },
      { id: 4, status: 'EXAMPLE', rent_pkr: 1000, price_basis: 'month',
        room_types: [{ room: 'single', seats: 99 }] },
    ];
    const seatStats = Stats.computeStats(seatRows, {});
    const noSeatStats = Stats.computeStats(
      [{ id: 9, status: 'LISTED', rent_pkr: 10000, price_basis: 'month',
        room_types: [{ room: 'single', seats: null }] }], {});
    ok('rooms count uses the stated-only rule (unstated seats add 0, EXAMPLE never counts)',
      seatStats.rooms === 4 && seatStats.roomsStated === true && noSeatStats.rooms === 0 &&
      noSeatStats.roomsStated === false, { seatStats, noSeatStats });
    const cheapRows = [
      { id: 1, status: 'VERIFIED', rent_pkr: 11644, price_basis: 'semester' },
      { id: 2, status: 'LISTED', rent_pkr: 9990, price_basis: 'month' },
      { id: 3, status: 'LISTED', rent_pkr: 30000, price_basis: 'semester' },
    ];
    const cheapStats = Stats.computeStats(cheapRows, {});
    ok('cheapest rent is the monthly equivalent (semester ÷6) and labels the basis',
      cheapStats.cheapest === Math.round(11644 / 6) && cheapStats.cheapestSemester === true &&
      Stats.statMonthlyRent({ price_basis: 'semester', rent_pkr: 11644, monthly_rent_equivalent: 1941 }) === 1941,
      cheapStats);
    const emptyStats = Stats.computeStats([], {});
    ok('stats show the honest empty state when no hostels are listed',
      emptyStats.hostels === 0 && emptyStats.rooms === 0 && emptyStats.reviews === 0 &&
      emptyStats.cheapest === null &&
      statsSrc.includes('No hostels listed yet') && statsSrc.includes("'—'"),
      emptyStats);
    const vacRows = [
      { id: 1, status: 'LISTED', seats_available: 5 },
      { id: 2, status: 'LISTED', seats_available: 0 },
      { id: 3, status: 'LISTED', seats_available: null },
      { id: 4, status: 'LISTED' },
      { id: 5, status: 'VERIFIED', seats_available: 2 },
    ];
    ok('vacant chip shows only hostels with a stated seats_available above zero',
      Stats.applyQuickFilter(vacRows, 'vacant').map(l => l.id).join(',') === '1,5',
      Stats.applyQuickFilter(vacRows, 'vacant'));
    ok('vacant filter on live data returns only seats_available > 0 rows',
      Stats.applyQuickFilter(liveAll3.listings, 'vacant')
        .every(l => typeof l.seats_available === 'number' && l.seats_available > 0),
      Stats.applyQuickFilter(liveAll3.listings, 'vacant').map(l => l.id));
    const verRows = [
      { id: 1, status: 'VERIFIED' }, { id: 2, status: 'LISTED' },
      { id: 3, status: 'EXAMPLE' }, { id: 4, status: 'VERIFIED' },
    ];
    ok('verified-only chip shows only VERIFIED hostels (live count matches the API)',
      Stats.applyQuickFilter(verRows, 'verified').map(l => l.id).join(',') === '1,4' &&
      Stats.applyQuickFilter(liveAll3.listings, 'verified').length === liveAll3.counts.verified,
      Stats.applyQuickFilter(liveAll3.listings, 'verified').map(l => l.id));
    const sortRows = [
      { id: 1, status: 'LISTED', rent_pkr: 12000, price_basis: 'month', monthly_rent_equivalent: 12000 },
      { id: 2, status: 'LISTED', rent_pkr: 30000, price_basis: 'semester', monthly_rent_equivalent: 5000 },
      { id: 3, status: 'VERIFIED', rent_pkr: 11644, price_basis: 'semester', monthly_rent_equivalent: 1941 },
    ];
    const sortedLive = Stats.applyQuickFilter(liveAll3.listings, 'cheapest');
    ok('cheapest chip sorts by monthly-equivalent rent ascending (semester ÷6)',
      Stats.applyQuickFilter(sortRows, 'cheapest').map(l => l.id).join(',') === '3,2,1' &&
      sortedLive.every((l, i) => i === 0 || l.monthly_rent_equivalent >= sortedLive[i - 1].monthly_rent_equivalent),
      sortedLive.map(l => l.monthly_rent_equivalent));
    const mgrAct = Stats.pendingReviewsAction('manager');
    const stuAct = Stats.pendingReviewsAction('student');
    const outAct = Stats.pendingReviewsAction(null);
    const mgrHtml = fs.readFileSync(path.join(__dirname, 'public', 'manager.html'), 'utf8');
    ok('pending-reviews chip routes by role: manager opens the queue, others get the login message (no fake count)',
      mgrAct.action === 'open-queue' && mgrAct.url === '/manager#reviews' &&
      mgrHtml.includes('id="reviews"') &&
      stuAct.action === 'login-message' && stuAct.url === '/login-manager' &&
      outAct.action === 'login-message' &&
      stuAct.message.includes('Log in as a manager to see pending reviews'),
      { mgrAct, stuAct, outAct });
    ok('chip status messages say what happened in plain words',
      Stats.quickFilterStatus(2, 'verified') === 'Showing 2 verified hostels.' &&
      Stats.quickFilterStatus(1, 'vacant') === 'Showing 1 hostel with vacant rooms.' &&
      Stats.quickFilterStatus(0, 'vacant').includes('never counted as vacant') &&
      Stats.quickFilterStatus(3, 'cheapest') === 'Showing 3 hostels, cheapest first.' &&
      Stats.quickFilterStatus(0, null) === 'Showing all hostels.',
      Stats.quickFilterStatus(2, 'verified'));
    const panelStart = indexHtml.indexOf('<aside class="ai-panel"');
    const panelEnd = indexHtml.indexOf('</aside>', panelStart);
    const panelHtml = indexHtml.slice(panelStart, panelEnd);
    ok('panel carries the honest line and no fake-AI text',
      panelHtml.includes('Shortcuts — no AI here yet. Each button filters the real list below.') &&
      !/thinking|typing|AI is/i.test(panelHtml) && !/thinking|typing|AI is/i.test(statsSrc),
      panelHtml.slice(0, 200));
    ok('panel has all four chips, a close button, a status line, the login note and a Show-all reset',
      panelHtml.includes('id="aiPanel"') && indexHtml.includes('id="askAiBtn"') &&
      ['data-chip="pending"', 'data-chip="vacant"', 'data-chip="cheapest"', 'data-chip="verified"']
        .every(s => panelHtml.includes(s)) &&
      panelHtml.includes('id="aiClose"') && panelHtml.includes('id="aiStatus"') &&
      panelHtml.includes('id="aiShowAll"') && panelHtml.includes('id="aiPendingMsg"') &&
      panelHtml.includes('href="/login-manager"') && panelHtml.includes('hidden'),
      'panel structure incomplete');
    ok('stat cards exist in the markup with real ids and the stated-only note',
      indexHtml.includes('id="stats"') &&
      ['statHostels', 'statRooms', 'statReviews', 'statCheapest']
        .every(id => indexHtml.includes('id="' + id + '"')) &&
      indexHtml.includes('seats stated only') && indexHtml.includes('glass-card stat-card'),
      'stat card markup incomplete');
    ok('chips use the same filter state as the list and the scene (no second filtering system)',
      appJsFile.includes('applyQuickFilter(rows, qf)') &&
      appJsFile.includes('applyQuickFilter(listed, qf)') &&
      appJsFile.includes('getQuickFilter()') &&
      sceneSrc.includes('No hostels match this filter'),
      'quick-filter wiring missing');
    ok('no community-submit wiring left in app.js (no submit form, no POST /api/listings)',
      !appJsFile.includes('submitForm') && !appJsFile.includes('submitOut') &&
      !appJsFile.includes("'/api/listings', { method: 'POST'") &&
      !appJsFile.includes('Submit a hostel') && !appJsFile.includes('#submit'),
      'submit wiring still in app.js');
    // Live delta: a new manager listing with stated room seats moves the
    // Rooms stat by exactly that many, and shows under the vacant chip.
    const beforeStats = Stats.computeStats((await get('/api/listings')).listings, {});
    const p3Mgr = await makeManager('p3-stats-mgr@example.com');
    const p3Hostel = await mgrPost(p3Mgr.cookie, { ...fullListing, name: 'P3 Stats Hostel',
      room_types: [{ room: 'single', rent_pkr: 18000, seats: 3, mess_included: false, mess_pkr: 5000 },
        { room: 'double', rent_pkr: 14000, seats: 5, mess_included: true, mess_pkr: null }],
      seats_available: 4 });
    const afterListings = await get('/api/listings');
    const afterStats = Stats.computeStats(afterListings.listings, {});
    ok('a manager listing with stated room seats moves the Rooms stat by exactly that many',
      p3Hostel.status === 201 && afterStats.hostels === beforeStats.hostels + 1 &&
      afterStats.rooms === beforeStats.rooms + 8,
      { beforeStats, afterStats, p3Hostel: p3Hostel.status });
    ok('a listing with stated vacant seats shows under the vacant chip (unstated never does)',
      p3Hostel.status === 201 &&
      Stats.applyQuickFilter(afterListings.listings, 'vacant')
        .some(l => l.id === p3Hostel.d.listing.id) &&
      Stats.applyQuickFilter(afterListings.listings, 'vacant')
        .every(l => typeof l.seats_available === 'number' && l.seats_available > 0),
      Stats.applyQuickFilter(afterListings.listings, 'vacant').map(l => l.id));
    // Live delta: one approved review moves the Student reviews stat by one.
    const p3Stu = await makeStudent('p3-stats-stu@example.com');
    const p3Rev = await submitReview(p3Stu.cookie, { listing_id: p3Hostel.d.listing.id, rating: 5, body: 'Quiet rooms, good mess.' });
    const p3Approve = await mgrDecide(p3Mgr.cookie, { review_id: p3Rev.d.review.id, decision: 'approve' });
    const freshListings = await get('/api/listings');
    const freshListed = Stats.statListings(freshListings.listings);
    const freshReviewsById = {};
    await Promise.all(freshListed.map(async l => {
      const r = await pubReviews(l.id);
      freshReviewsById[l.id] = r.reviews || [];
    }));
    const freshStats = Stats.computeStats(freshListings.listings, freshReviewsById);
    ok('an approved review moves the Student reviews stat by exactly one',
      p3Rev.status === 201 && p3Approve.status === 200 &&
      freshStats.reviews === liveStats.reviews + 1,
      { liveReviews: liveStats.reviews, freshReviews: freshStats.reviews });
    ok('stat cards + panel CSS: 4-column grid, glass panel sliding in from the right, responsive',
      css.includes('.stats') && css.includes('repeat(4,1fr)') &&
      css.includes('.ai-panel') && css.includes('translate(120%,-50%)') &&
      css.includes('.ai-panel.is-open') && css.includes('.stat-value') &&
      css.includes('.stats{grid-template-columns:repeat(2,1fr)}') &&
      css.includes('.stats{grid-template-columns:1fr}'),
      'Phase 3 CSS missing');

    // ---- 18. Phase 4 (3D restyle): the four remaining pages in the shell ----
    // Served HTML for each page carries the same top pill nav + left icon
    // rail as the home page (current page's icon highlighted), the same
    // glass cards, and no external asset. Every v2 control is still
    // present — restyle only, no feature lost. JS-rendered controls are
    // asserted from each page's own JS source (no browser here).
    const shellPages = {};
    for (const p of ['/hostel', '/login', '/login-student', '/login-manager', '/manager', '/admin']) {
      const r = await fetch(BASE + p);
      shellPages[p] = { status: r.status, html: await r.text() };
    }
    const shellJs = {};
    for (const p of ['hostel.js', 'login-student.js', 'login-manager.js', 'shell.js', 'manager.js', 'admin.js']) {
      shellJs[p] = await (await fetch(BASE + '/' + p)).text();
    }
    for (const [p, pg] of Object.entries(shellPages)) {
      ok(`Phase 4 shell on ${p}: serves 200 with topnav + rail + avatar + bell + log-out`,
        pg.status === 200 && pg.html.includes('class="topnav"') && pg.html.includes('class="rail"') &&
        pg.html.includes('class="shell"') && pg.html.includes('id="avatarLink"') &&
        pg.html.includes('id="bellBtn"') && pg.html.includes('id="bellPop"') &&
        pg.html.includes('id="navLogoutBtn"') && pg.html.includes('class="glass-card page-head"'),
        pg.status);
      ok(`Phase 4: no external asset on ${p} (no img, no http URL, no CDN)`,
        !pg.html.includes('<img') && !pg.html.includes('http://') && !pg.html.includes('https://'),
        'external reference found on ' + p);
    }
    // Current page's rail icon (and nav pill) highlighted. The detail page
    // is a search result, so Search is its active section; login/admin
    // have their own rail icon + pill since no home section matches them.
    const railActive = { '/hostel': '/#find', '/login': '/login', '/login-student': '/login-student',
      '/login-manager': '/login-manager', '/manager': '/manager', '/admin': '/admin' };
    for (const [p, href] of Object.entries(railActive)) {
      ok(`Phase 4: ${p} highlights its own rail icon (and nav pill)`,
        shellPages[p].html.includes('class="rail-btn is-active" href="' + href + '"') &&
        shellPages[p].html.includes('class="nav-pill is-active" href="' + href + '"'),
        'active rail/pill missing on ' + p);
    }
    // Detail page: every v2 control still present (static HTML + hostel.js).
    const hostelHtml = shellPages['/hostel'].html;
    ok('detail page keeps every v2 control (back link, reviews, price history)',
      hostelHtml.includes('id="detail"') && hostelHtml.includes('id="reviewsCard"') &&
      hostelHtml.includes('id="reviewSummary"') &&
      hostelHtml.includes('Student review — the site has not verified this student lived here.') &&
      hostelHtml.includes('id="reviewList"') && hostelHtml.includes('id="writeReview"') &&
      hostelHtml.includes('id="history"') && hostelHtml.includes('Price history') &&
      hostelHtml.includes('← Back to search'), 'detail control missing');
    ok('detail JS still renders fees, rooms, map, gallery, rental, mess, reviews',
      shellJs['hostel.js'].includes('Fees — every charge') && shellJs['hostel.js'].includes('Room types') &&
      shellJs['hostel.js'].includes('Amenities') && shellJs['hostel.js'].includes('maps_embed_url') &&
      shellJs['hostel.js'].includes('<iframe') && shellJs['hostel.js'].includes('Open in Google Maps') &&
      shellJs['hostel.js'].includes('Photos') && shellJs['hostel.js'].includes('Rental period not stated') &&
      shellJs['hostel.js'].includes('Write a review') && shellJs['hostel.js'].includes('Log in as a student') &&
      shellJs['hostel.js'].includes('escapeHtml'), 'detail render missing');
    // Chooser page: two links, no forms at all. Student page: student
    // login + register only, with the wrong-role box and the approval-free
    // note. Manager page: manager login + register only, approval note.
    const loginHtml = shellPages['/login'].html;
    ok('chooser page has two role links and no form',
      loginHtml.includes('href="/login-student"') && loginHtml.includes('href="/login-manager"') &&
      !loginHtml.includes('<form') && !loginHtml.includes('id="mgrLogin"') && !loginHtml.includes('id="stuLogin"'),
      'chooser control missing');
    const stuHtml = shellPages['/login-student'].html;
    ok('student login page keeps its login + register form, optional phone, wrong-role box',
      stuHtml.includes('Log in as Student') && stuHtml.includes('id="stuLogin"') &&
      stuHtml.includes('id="stuRegister"') && stuHtml.includes('Password (at least 8 characters)') &&
      stuHtml.includes('Display name') && stuHtml.includes('Phone (optional') &&
      stuHtml.includes('value="student"') && stuHtml.includes('id="wrongRoleBox"') &&
      stuHtml.includes('id="wrongRoleLogout"') && stuHtml.includes('href="/login-manager"') &&
      !stuHtml.includes('id="mgrLogin"') && !stuHtml.includes('id="mgrRegister"'),
      'student login control missing');
    const mgrHtml2 = shellPages['/login-manager'].html;
    ok('manager login page keeps its login + register form, optional phone, approval note, wrong-role box',
      mgrHtml2.includes('Log in as Manager') && mgrHtml2.includes('id="mgrLogin"') &&
      mgrHtml2.includes('id="mgrRegister"') && mgrHtml2.includes('Password (at least 8 characters)') &&
      mgrHtml2.includes('Display name') && mgrHtml2.includes('Phone (optional') &&
      mgrHtml2.includes('waiting for master approval') && mgrHtml2.includes('value="manager"') &&
      mgrHtml2.includes('id="wrongRoleBox"') && mgrHtml2.includes('id="wrongRoleLogout"') &&
      mgrHtml2.includes('href="/login-student"') &&
      !mgrHtml2.includes('id="stuLogin"') && !mgrHtml2.includes('id="stuRegister"'),
      'manager login control missing');
    for (const [p, html] of [['/login-student', stuHtml], ['/login-manager', mgrHtml2]]) {
      const phoneTag = (html.match(/<input[^>]*name="phone"[^>]*>/) || [''])[0];
      ok(`register phone stays optional on ${p} (label says optional, field has no required)`,
        html.includes('Phone (optional') && !phoneTag.includes('required'), phoneTag);
    }
    ok('student login JS posts to the auth endpoints, refuses manager accounts, guards the wrong role',
      shellJs['login-student.js'].includes('/api/auth/login') &&
      shellJs['login-student.js'].includes('/api/auth/register') &&
      shellJs['login-student.js'].includes('That account is a Manager account') &&
      shellJs['login-student.js'].includes('wrongRoleBox') &&
      shellJs['login-student.js'].includes("window.location.href = '/'"),
      'student login JS missing');
    ok('manager login JS posts to the auth endpoints, refuses student accounts, guards the wrong role',
      shellJs['login-manager.js'].includes('/api/auth/login') &&
      shellJs['login-manager.js'].includes('/api/auth/register') &&
      shellJs['login-manager.js'].includes('That account is a Student account') &&
      shellJs['login-manager.js'].includes('wrongRoleBox') &&
      shellJs['login-manager.js'].includes("window.location.href = '/manager'"),
      'manager login JS missing');
    ok('shared shell JS carries the avatar + bell + log-out for the login pages',
      shellJs['shell.js'].includes('loadShellUser') && shellJs['shell.js'].includes('/api/auth/me') &&
      shellJs['shell.js'].includes('navLogoutBtn') && shellJs['shell.js'].includes('bellBtn'),
      'shell JS missing');
    // Manager page: my-hostels, form, reviews anchor, photo upload, status line.
    const p4MgrHtml = shellPages['/manager'].html;
    ok('manager page keeps my-hostels, form, reviews anchor, photo note, status line',
      p4MgrHtml.includes('id="reviews"') && p4MgrHtml.includes('My hostels') && p4MgrHtml.includes('id="myList"') &&
      p4MgrHtml.includes('id="newBtn"') && p4MgrHtml.includes('id="hostelForm"') && p4MgrHtml.includes('id="formCard"') &&
      p4MgrHtml.includes('id="accountStatus"') && p4MgrHtml.includes('id="logoutBtn"') &&
      p4MgrHtml.includes('id="loadReviewsBtn"') && p4MgrHtml.includes('id="reviewsList"') &&
      p4MgrHtml.includes('id="feeFields"') && p4MgrHtml.includes('id="amenityFields"') &&
      p4MgrHtml.includes('id="roomTypes"') && p4MgrHtml.includes('id="otherCharges"') &&
      p4MgrHtml.includes('Not available') && p4MgrHtml.includes('5 MB') && p4MgrHtml.includes('8 photos') &&
      p4MgrHtml.includes('Photos are stored on this server and are lost if the site is redeployed'),
      'manager control missing');
    ok('manager JS still builds Not-available fees/amenities, photo upload, reviews queue',
      shellJs['manager.js'].includes('Not available') && shellJs['manager.js'].includes('data-fee') &&
      shellJs['manager.js'].includes('data-am') && shellJs['manager.js'].includes('data-upload') &&
      shellJs['manager.js'].includes('accept=".jpg,.jpeg,.png,.webp"') &&
      shellJs['manager.js'].includes('REJECT_REASONS') && shellJs['manager.js'].includes('data-approve-review') &&
      shellJs['manager.js'].includes('data-reject-review') && shellJs['manager.js'].includes('loadPhotos'),
      'manager JS missing');
    ok('manager account status says "Waiting for master approval" while pending',
      shellJs['manager.js'].includes('Waiting for master approval'), 'pending status text missing');
    // Admin page: code box, pending managers, rejected reviews, audit trail.
    const p4AdminHtml = shellPages['/admin'].html;
    ok('admin page keeps code box, pending managers, rejected reviews, audit trail',
      p4AdminHtml.includes('Admin code') && p4AdminHtml.includes('id="code"') &&
      p4AdminHtml.includes('id="loadBtn"') && p4AdminHtml.includes('Pending managers') &&
      p4AdminHtml.includes('id="loadPendingBtn"') && p4AdminHtml.includes('Rejected reviews') &&
      p4AdminHtml.includes('id="loadRejectedBtn"') && p4AdminHtml.includes('Audit trail') &&
      p4AdminHtml.includes('id="loadAuditBtn"') && p4AdminHtml.includes('id="list"') &&
      p4AdminHtml.includes('id="pendingList"') && p4AdminHtml.includes('id="rejectedList"') &&
      p4AdminHtml.includes('id="auditList"'), 'admin control missing');
    ok('admin JS still does verify/hide/edit + overturn + audit with the master code',
      shellJs['admin.js'].includes('/api/master/managers') && shellJs['admin.js'].includes('/api/master/reviews') &&
      shellJs['admin.js'].includes('/api/master/audit') && shellJs['admin.js'].includes('data-verify') &&
      shellJs['admin.js'].includes('data-hide') && shellJs['admin.js'].includes('data-edit') &&
      shellJs['admin.js'].includes('Source note (required to verify)') &&
      shellJs['admin.js'].includes('X-Master-Code') && shellJs['admin.js'].includes('Overturn — approve') &&
      shellJs['admin.js'].includes('escapeHtml'), 'admin JS missing');
    // Shell JS on all pages: avatar from /api/auth/me + bell + log-out.
    // The two login pages get their shell from the shared shell.js (they
    // load it), so the per-file check covers the files that carry the
    // shell, and a separate check proves the login pages load shell.js.
    for (const [p, js] of Object.entries(shellJs)) {
      if (p === 'login-student.js' || p === 'login-manager.js') continue;
      ok(`Phase 4 shell JS on ${p}: avatar from /api/auth/me + bell + log-out`,
        js.includes('loadShellUser') && js.includes('/api/auth/me') && js.includes('avatarName') &&
        js.includes('bellBtn') && js.includes('navLogoutBtn') && js.includes('/api/auth/logout'),
        'shell JS missing in ' + p);
    }
    ok('Phase 4: both login pages load the shared shell.js (avatar + bell + log-out)',
      stuHtml.includes('<script src="/shell.js"></script>') &&
      mgrHtml2.includes('<script src="/shell.js"></script>') &&
      shellJs['shell.js'].includes('loadShellUser') && shellJs['shell.js'].includes('/api/auth/me') &&
      shellJs['shell.js'].includes('avatarName') && shellJs['shell.js'].includes('bellBtn') &&
      shellJs['shell.js'].includes('navLogoutBtn') && shellJs['shell.js'].includes('/api/auth/logout'),
      'login pages do not load shell.js');
    ok('Phase 4 CSS: page-head + login grid + field grid + nav log-out hidden rule',
      css.includes('.page-head h1') && css.includes('.login-grid') &&
      css.includes('.field-grid') && css.includes('.nav-logout[hidden]'),
      'Phase 4 CSS missing');
    ok('Phase 4 CSS: login + field grids stack to one column at 640px',
      css.includes('.login-grid{grid-template-columns:1fr}') &&
      css.includes('.field-grid{grid-template-columns:1fr}'),
      'mobile grid rules missing');
    ok('Phase 4: the old generic header rule is gone (every page uses the real shell)',
      !css.includes('header:not(.topnav)'), 'dead header rule still in CSS');

    // ---- 19. Phase 5 final review: second pass over everything ----
    // (a) The Phase 3 EXAMPLE/chip inconsistency is fixed: a chip
    // operates on VERIFIED + LISTED hostels only — the same population
    // as the scene and the stat cards — so the chip's status line, the
    // list and the scene can never disagree about EXAMPLE rows.
    const exRows = [
      { id: 1, status: 'VERIFIED', rent_pkr: 20000, price_basis: 'month', monthly_rent_equivalent: 20000, seats_available: 0 },
      { id: 2, status: 'LISTED', rent_pkr: 15000, price_basis: 'month', monthly_rent_equivalent: 15000, seats_available: 3 },
      { id: 3, status: 'EXAMPLE', rent_pkr: 1000, price_basis: 'month', monthly_rent_equivalent: 1000, seats_available: 9 },
      { id: 4, status: 'EXAMPLE', rent_pkr: 500, price_basis: 'month', monthly_rent_equivalent: 500 },
    ];
    ok('Phase 5: chips never pull EXAMPLE rows in (vacant / verified / cheapest)',
      Stats.applyQuickFilter(exRows, 'vacant').map(l => l.id).join(',') === '2' &&
      Stats.applyQuickFilter(exRows, 'verified').map(l => l.id).join(',') === '1' &&
      Stats.applyQuickFilter(exRows, 'cheapest').map(l => l.id).join(',') === '2,1',
      { vacant: Stats.applyQuickFilter(exRows, 'vacant'), cheapest: Stats.applyQuickFilter(exRows, 'cheapest') });
    ok('Phase 5: with no chip active the plain list still shows EXAMPLE rows when ticked',
      Stats.applyQuickFilter(exRows, null).length === 4,
      Stats.applyQuickFilter(exRows, null).length);
    const liveEx = await get('/api/listings?show_examples=1');
    const chipOnFull = Stats.applyQuickFilter(liveEx.listings, 'cheapest').map(l => l.id);
    const chipOnScene = Stats.applyQuickFilter(Scene.sceneListings(liveEx.listings), 'cheapest').map(l => l.id);
    ok('Phase 5: chip on the full server rows (EXAMPLE ticked) agrees with chip on the scene rows',
      liveEx.listings.some(l => l.status === 'EXAMPLE') &&
      !Stats.applyQuickFilter(liveEx.listings, 'cheapest').some(l => l.status === 'EXAMPLE') &&
      JSON.stringify(chipOnFull) === JSON.stringify(chipOnScene),
      { chipOnFull, chipOnScene });
    ok('Phase 5: chip status count equals the scene block count for that filter',
      Scene.layout(Stats.applyQuickFilter(Scene.sceneListings(liveEx.listings), 'cheapest')).count === chipOnFull.length &&
      Stats.quickFilterStatus(chipOnFull.length, 'cheapest') === 'Showing ' + chipOnFull.length + ' hostels, cheapest first.',
      { count: chipOnFull.length, status: Stats.quickFilterStatus(chipOnFull.length, 'cheapest') });

    // (b) End-to-end flow in one chain: manager registers pending ->
    // master approves -> logs in -> creates a listing (scene + stats
    // move); student registers -> logs in -> reviews (pending, invisible)
    // -> manager approves -> public, counted, labelled on the scene.
    const e2eMgrReg = await reg('p5-e2e-mgr@example.com', 'manager', 'mgrpass99', nextIp());
    const e2eMgrLoginBefore = await login('p5-e2e-mgr@example.com', 'mgrpass99', nextIp());
    ok('Phase 5 E2E: manager registers pending and cannot log in yet',
      e2eMgrReg.status === 201 && e2eMgrReg.d.status === 'pending' &&
      e2eMgrLoginBefore.status === 401, { reg: e2eMgrReg.status, login: e2eMgrLoginBefore.status });
    const e2eMgrApprove = await masterPost('/api/master/managers/decide', { user_id: e2eMgrReg.d.id, decision: 'approve' }, MASTER);
    const e2eMgrLogin = await login('p5-e2e-mgr@example.com', 'mgrpass99', nextIp());
    const e2eBefore = await get('/api/listings');
    const e2eStatsBefore = Stats.computeStats(e2eBefore.listings, {});
    const e2eReviewsBeforeById = {};
    await Promise.all(Stats.statListings(e2eBefore.listings).map(async l => {
      const r = await pubReviews(l.id);
      e2eReviewsBeforeById[l.id] = r.reviews || [];
    }));
    const e2eReviewsBefore = Object.values(e2eReviewsBeforeById).reduce((s, rs) => s + rs.length, 0);
    const e2eHostel = await mgrPost(e2eMgrLogin.cookie, { ...fullListing, name: 'P5 E2E Hostel',
      room_types: [{ room: 'single', rent_pkr: 18000, seats: 3, mess_included: false, mess_pkr: 5000 },
        { room: 'double', rent_pkr: 14000, seats: 5, mess_included: true, mess_pkr: null }],
      seats_available: 4 });
    const e2eAfter = await get('/api/listings');
    const e2eStatsAfter = Stats.computeStats(e2eAfter.listings, {});
    ok('Phase 5 E2E: approved manager creates a listing that appears in the scene + stats',
      e2eMgrApprove.status === 200 && e2eMgrLogin.status === 200 && e2eHostel.status === 201 &&
      Scene.sceneListings(e2eAfter.listings).some(l => l.id === e2eHostel.d.listing.id) &&
      Scene.chartData(e2eAfter.listings).rows.some(r => r.id === e2eHostel.d.listing.id && r.monthlyRent === 20000) &&
      e2eStatsAfter.hostels === e2eStatsBefore.hostels + 1 &&
      e2eStatsAfter.rooms === e2eStatsBefore.rooms + 8,
      { hostel: e2eHostel.status, statsBefore: e2eStatsBefore, statsAfter: e2eStatsAfter });
    const e2eStu = await makeStudent('p5-e2e-stu@example.com');
    const e2eRev = await submitReview(e2eStu.cookie, { listing_id: e2eHostel.d.listing.id, rating: 5, body: 'Quiet rooms, good mess.' });
    const e2ePubBefore = await pubReviews(e2eHostel.d.listing.id);
    const e2eDetBefore = await get('/api/listings/' + e2eHostel.d.listing.id);
    ok('Phase 5 E2E: student review submits pending and stays invisible publicly',
      e2eRev.status === 201 && e2eRev.d.review.status === 'pending' &&
      e2ePubBefore.reviews.length === 0 &&
      e2eDetBefore.review_summary.review_count === 0 &&
      e2eDetBefore.review_summary.unpublished_review_count === 1,
      { rev: e2eRev.status, summary: e2eDetBefore.review_summary });
    const e2eApprove = await mgrDecide(e2eMgrLogin.cookie, { review_id: e2eRev.d.review.id, decision: 'approve' });
    const e2ePubAfter = await pubReviews(e2eHostel.d.listing.id);
    const e2eDetAfter = await get('/api/listings/' + e2eHostel.d.listing.id);
    const e2eFresh = await get('/api/listings');
    const e2eFreshReviewsById = {};
    await Promise.all(Stats.statListings(e2eFresh.listings).map(async l => {
      const r = await pubReviews(l.id);
      e2eFreshReviewsById[l.id] = r.reviews || [];
    }));
    const e2eFreshStats = Stats.computeStats(e2eFresh.listings, e2eFreshReviewsById);
    ok('Phase 5 E2E: manager approval makes the review public, counted, and labelled on the scene',
      e2eApprove.status === 200 && e2ePubAfter.reviews.length === 1 &&
      e2ePubAfter.reviews[0].reviewer_name === 'p5-e2e-stu' &&
      e2eDetAfter.review_summary.review_count === 1 && e2eDetAfter.review_summary.average_rating === 5 &&
      Scene.studentLabel(e2ePubAfter.reviews) === 'p5-e2e-stu' &&
      e2eFreshStats.reviews === e2eReviewsBefore + 1,
      { pub: e2ePubAfter.reviews, summary: e2eDetAfter.review_summary, reviewsBefore: e2eReviewsBefore, reviewsAfter: e2eFreshStats.reviews });

    // (c) Home page shell parity: the Log out pill the four sub-pages
    // have was missing on the home page; it is there now and wired.
    const p5HomeRes = await fetch(BASE + '/');
    const p5HomeHtml = await p5HomeRes.text();
    ok('Phase 5: home page serves 200 with the same Log out pill as the sub-pages',
      p5HomeRes.status === 200 && p5HomeHtml.includes('id="navLogoutBtn"') &&
      p5HomeHtml.includes('hidden>Log out</button>'), p5HomeRes.status);
    ok('Phase 5: home-page shell JS wires the log-out pill (avatar + bell + log-out)',
      appJsFile.includes('loadShellUser') && appJsFile.includes('/api/auth/me') &&
      appJsFile.includes('avatarName') && appJsFile.includes('bellBtn') &&
      appJsFile.includes('navLogoutBtn') && appJsFile.includes('/api/auth/logout'),
      'home shell JS missing');

    // (d) No dead controls: the calculator said nothing when no listing
    // was selected; the price-history toggle used a placeholder href.
    ok('Phase 5: calculator with no listing selected says so instead of silently doing nothing',
      appJsFile.includes("if (!$('calcListing').value)") &&
      appJsFile.includes('Pick a listing first — no hostels match the current filters.'),
      'calc empty state missing');
    ok('Phase 5: no placeholder href="#" anywhere (price-history toggle points at the real detail page)',
      !appJsFile.includes('href="#"') &&
      appJsFile.includes('<a href="/hostel?id=${l.id}" data-detail='),
      'placeholder href found');
    const allPagesHtml = [indexHtml, shellPages['/hostel'].html, shellPages['/login'].html,
      shellPages['/login-student'].html, shellPages['/login-manager'].html,
      shellPages['/manager'].html, shellPages['/admin'].html].join('\n');
    const allHrefs = [...allPagesHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const hrefOk = h => h === '/' || h === '/login' || h === '/login-student' || h === '/login-manager' ||
      h === '/manager' || h === '/admin' ||
      h === '/styles.css' || h.startsWith('/#') || h.startsWith('#') || h.startsWith('/hostel?id=');
    ok('Phase 5: every link in every page points at a real route or in-page anchor',
      allHrefs.length > 0 && allHrefs.every(hrefOk), [...new Set(allHrefs)]);
    const httpsCount = Object.values(shellJs).join('\n').split('https://').length - 1 +
      appJsFile.split('https://').length - 1;
    ok('Phase 5: the only external URL any page JS builds is the Google Maps search link',
      httpsCount === 1 && shellJs['hostel.js'].includes('https://www.google.com/maps/search/?api=1&query='),
      'unexpected external URL in page JS');
    const idPairs = [['app.js', indexHtml], ['hostel.js', shellPages['/hostel'].html],
      ['login-student.js', shellPages['/login-student'].html],
      ['login-manager.js', shellPages['/login-manager'].html],
      ['shell.js', shellPages['/login'].html],
      ['manager.js', shellPages['/manager'].html],
      ['admin.js', shellPages['/admin'].html]];
    const jsSrc = { 'app.js': appJsFile, 'hostel.js': shellJs['hostel.js'],
      'login-student.js': shellJs['login-student.js'], 'login-manager.js': shellJs['login-manager.js'],
      'shell.js': shellJs['shell.js'],
      'manager.js': shellJs['manager.js'], 'admin.js': shellJs['admin.js'] };
    const idProblems = [];
    for (const [f, html] of idPairs) {
      const src = jsSrc[f];
      const ids = new Set();
      for (const m of src.matchAll(/\$\('([^']+)'\)/g)) ids.add(m[1]);
      for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) ids.add(m[1]);
      for (const id of ids) {
        if (!html.includes('id="' + id + '"') && !src.includes('id="' + id + '"')) idProblems.push(f + ':' + id);
      }
    }
    ok('Phase 5: every id a page JS looks up exists in that page (or the JS injects it) — no dead control',
      idProblems.length === 0, idProblems);

    // (e) No invented text, no leftover v2 styling, no dead CSS class.
    const publicText = [indexHtml, ...Object.values(shellPages).map(p => p.html),
      appJsFile, ...Object.values(shellJs)].join('\n');
    ok('Phase 5: no invented / placeholder text anywhere (no lorem, TODO, coming soon, TBD, demo names)',
      !/lorem|TODO|FIXME|coming soon|\bTBD\b|John Doe|Sample Hostel/i.test(publicText),
      'placeholder text found');
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const definedClasses = [...new Set([...cssNoComments.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1]))];
    const unusedClasses = definedClasses.filter(c => !publicText.includes(c));
    ok('Phase 5: no leftover v2 styling — no indigo header, no old footer, every CSS class is used',
      !css.includes('#312e81') && !css.includes('header:not(.topnav)') &&
      !publicText.includes('<footer') && unusedClasses.length === 0, unusedClasses);

    // (f) Phase 5 CSS: tablet greeting/actions cannot overlap, the 375px
    // top nav wraps instead of overflowing, checkbox rows are 44px taps.
    ok('Phase 5 CSS: tablet greeting/actions cannot overlap (1100px + 980px caps, none at 640px)',
      css.includes('.scene-actions{max-width:calc(100% - 380px)}') &&
      css.includes('.greeting{max-width:280px}') &&
      css.includes('.scene-actions{max-width:calc(100% - 320px)}') &&
      css.includes('.scene-actions{position:static;order:3;max-width:none;'),
      'tablet overlap rules missing');
    ok('Phase 5 CSS: 375px top nav wraps and the brand name ellipsises instead of overflowing',
      css.includes('.topnav{flex-wrap:wrap}') && css.includes('text-overflow:ellipsis'),
      'mobile topnav rules missing');
    ok('Phase 5 CSS: checkbox rows are 44px tap targets',
      /\.chk\{[^}]*min-height:var\(--tap\)/.test(css),
      'chk tap-target rule missing');

    // ---- 20. Submit removal (2026-11-07): only approved managers list ----
    // The public submit path is gone end to end: no endpoint, no form,
    // no nav link on any page. The manager add-hostel flow still works.
    const noSubmitPages = { '/': indexHtml, '/hostel': shellPages['/hostel'].html,
      '/login': shellPages['/login'].html, '/login-student': shellPages['/login-student'].html,
      '/login-manager': shellPages['/login-manager'].html, '/manager': shellPages['/manager'].html,
      '/admin': shellPages['/admin'].html };
    for (const [p, html] of Object.entries(noSubmitPages)) {
      ok(`Submit removal: no Submit link or form on ${p}`,
        !html.includes('href="#submit"') && !html.includes('href="/#submit"') &&
        !html.includes('Submit a hostel') && !html.includes('id="submitForm"') &&
        !html.includes('Submit listing') && !html.includes('id="submitOut"'),
        'Submit markup still on ' + p);
    }
    ok('Submit removal: app.js has no submit wiring at all',
      !appJsFile.includes('submitForm') && !appJsFile.includes('submitOut') &&
      !appJsFile.includes('subCity') && !appJsFile.includes('subArea') &&
      !appJsFile.includes('facChecks') && !appJsFile.includes('#submit') &&
      !appJsFile.includes('Submit a hostel'),
      'submit wiring still in app.js');
    ok('Submit removal: the empty-scene action points at the Manager portal, not a submit form',
      appJsFile.includes("a.href = '/manager'") && appJsFile.includes('List your hostel — Manager portal') &&
      !appJsFile.includes("a.href = '#submit'"),
      'empty-scene action still points at submit');
    const remPost = await post('/api/listings', { name: 'Still Gone Hostel', city: 'Lahore', area: 'Gulberg',
      type: 'boys', room: 'single', rent_pkr: 12000 });
    ok('Submit removal: POST /api/listings is 404 for a valid manager-style body too',
      remPost.status === 404, remPost);
    const remMgr = await makeManager('removal-mgr@example.com');
    const remCreate = await mgrPost(remMgr.cookie, { ...fullListing, name: 'Removal Check Hostel' });
    ok('Submit removal: an approved manager can still add a hostel (201 LISTED)',
      remCreate.status === 201 && remCreate.d.listing.status === 'LISTED', remCreate);
    const remSearch = await get('/api/listings?city=Peshawar');
    ok('Submit removal: the manager-added hostel shows in public search',
      remSearch.listings.some(l => l.id === remCreate.d.listing.id), remSearch.listings.map(l => l.id));

    // ---- 21. Login split (2026-11-07) + testing-only single session ----
    // Student and manager login live on totally separate pages now:
    // /login-student (student login + register only) and /login-manager
    // (manager login + register only); /login is a chooser with two links
    // and no form. SINGLE_SESSION=1 (testing only, default off) makes
    // every login kill all other sessions; off, a login touches nobody
    // else's session.
    const getText = async p => (await fetch(BASE + p)).text();
    const splitStu = await getText('/login-student');
    const splitMgr = await getText('/login-manager');
    const splitChooser = await getText('/login');
    ok('login split: student page has exactly one login form (student) + one register form',
      (splitStu.match(/<form/g) || []).length === 2 &&
      splitStu.includes('id="stuLogin"') && splitStu.includes('id="stuRegister"'),
      (splitStu.match(/<form/g) || []).length);
    ok('login split: manager page has exactly one login form (manager) + one register form',
      (splitMgr.match(/<form/g) || []).length === 2 &&
      splitMgr.includes('id="mgrLogin"') && splitMgr.includes('id="mgrRegister"'),
      (splitMgr.match(/<form/g) || []).length);
    ok('login split: chooser has zero forms',
      !splitChooser.includes('<form'), splitChooser.slice(0, 120));
    ok('login split: no page says "Manager / Student" any more (avatar or link)',
      !splitStu.includes('Manager / Student') && !splitMgr.includes('Manager / Student') &&
      !splitChooser.includes('Manager / Student') && !indexHtml.includes('Manager / Student') &&
      !shellPages['/manager'].html.includes('Manager / Student') &&
      !shellPages['/admin'].html.includes('Manager / Student') &&
      !shellPages['/hostel'].html.includes('Manager / Student'),
      'mixed-role label still present');
    // Fresh accounts for the split tests (own Gmails, no interference
    // with earlier sections).
    const splitStuReg = await reg('split-stu@example.com', 'student', 'splitpass1', nextIp());
    ok('login split: student test account registers active',
      splitStuReg.status === 201 && splitStuReg.d.status === 'active', splitStuReg);
    const splitMgrReg = await reg('split-mgr@example.com', 'manager', 'splitpass1', nextIp());
    ok('login split: manager test account registers pending',
      splitMgrReg.status === 201 && splitMgrReg.d.status === 'pending', splitMgrReg);
    await masterPost('/api/master/managers/decide', { user_id: splitMgrReg.d.id, decision: 'approve' }, MASTER);
    const splitStuLogin = await login('split-stu@example.com', 'splitpass1', nextIp());
    const splitMgrLogin = await login('split-mgr@example.com', 'splitpass1', nextIp());
    ok('login split: both test accounts can log in',
      splitStuLogin.status === 200 && splitMgrLogin.status === 200,
      { s: splitStuLogin.status, m: splitMgrLogin.status });
    // (d) Flag OFF (this server): the other session survives a new login.
    const splitMeStu = await me(splitStuLogin.cookie);
    ok('login split: with SINGLE_SESSION off, the student session survives the manager login',
      splitMeStu.status === 200 && splitMeStu.d.role === 'student', splitMeStu);
    const splitMeMgr = await me(splitMgrLogin.cookie);
    ok('login split: with SINGLE_SESSION off, the manager session is live too',
      splitMeMgr.status === 200 && splitMeMgr.d.role === 'manager', splitMeMgr);
    // (c) Flag ON: a second server with SINGLE_SESSION=1 — logging in as
    // one role kills the other role's session, and vice versa.
    const SS_PORT = 3098;
    const SS_DB = '/tmp/hostel-test-ss-' + process.pid + '.sqlite';
    const SS_UPLOADS = '/tmp/hostel-test-ss-uploads-' + process.pid;
    const SS_BASE = 'http://127.0.0.1:' + SS_PORT;
    const ssReq = (method, p, opts = {}) => new Promise((resolve, reject) => {
      const r = httpMod.request({ host: '127.0.0.1', port: SS_PORT, path: p, method,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }, res => {
        let s = ''; res.on('data', c => { s += c; }); res.on('end', () => {
          let d; try { d = JSON.parse(s); } catch { d = s; }
          const sc = res.headers['set-cookie'];
          resolve({ status: res.statusCode, d,
            cookie: Array.isArray(sc) && sc[0] ? sc[0].split(';')[0] : (sc ? sc.split(';')[0] : null) });
        });
      });
      r.on('error', reject);
      if (opts.body !== undefined) r.write(JSON.stringify(opts.body));
      r.end();
    });
    const ssSrv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(SS_PORT), DB_FILE: SS_DB, UPLOADS_DIR: SS_UPLOADS,
        ADMIN_CODE: 'test-admin-code', LOGIN_LOCK_SECONDS: '2', SINGLE_SESSION: '1' },
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 50; i++) {
        try { const r = await fetch(SS_BASE + '/'); if (r.ok) break; } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
      const ssReg = (gmail, role) => ssReq('POST', '/api/auth/register',
        { body: { gmail, password: 'splitpass1', display_name: gmail.split('@')[0], phone: '03001234567', role },
          headers: { 'X-Forwarded-For': nextIp() } });
      const ssLogin = gmail => ssReq('POST', '/api/auth/login',
        { body: { gmail, password: 'splitpass1' }, headers: { 'X-Forwarded-For': nextIp() } });
      const ssMe = cookie => ssReq('GET', '/api/auth/me', { headers: cookie ? { Cookie: cookie } : {} });
      const ssRegStu = await ssReg('ss-stu@example.com', 'student');
      const ssRegMgr = await ssReg('ss-mgr@example.com', 'manager');
      ok('single session ON: both accounts register on the flag-on server',
        ssRegStu.status === 201 && ssRegMgr.status === 201, { s: ssRegStu.status, m: ssRegMgr.status });
      await ssReq('POST', '/api/master/managers/decide',
        { body: { user_id: ssRegMgr.d.id, decision: 'approve' }, headers: { 'X-Master-Code': MASTER } });
      const ssStu1 = await ssLogin('ss-stu@example.com');
      ok('single session ON: student logs in', ssStu1.status === 200 && !!ssStu1.cookie, ssStu1);
      const ssMeBefore = await ssMe(ssStu1.cookie);
      ok('single session ON: student session is live before the manager login',
        ssMeBefore.status === 200, ssMeBefore);
      const ssMgr1 = await ssLogin('ss-mgr@example.com');
      ok('single session ON: manager logs in', ssMgr1.status === 200 && !!ssMgr1.cookie, ssMgr1);
      const ssMeStuAfter = await ssMe(ssStu1.cookie);
      ok('single session ON: manager login kills the student session (me -> 401)',
        ssMeStuAfter.status === 401, ssMeStuAfter);
      const ssMeMgrAfter = await ssMe(ssMgr1.cookie);
      ok('single session ON: the manager session itself is live',
        ssMeMgrAfter.status === 200 && ssMeMgrAfter.d.role === 'manager', ssMeMgrAfter);
      const ssStu2 = await ssLogin('ss-stu@example.com');
      const ssMeMgrAfter2 = await ssMe(ssMgr1.cookie);
      ok('single session ON: student login kills the manager session back (me -> 401)',
        ssStu2.status === 200 && ssMeMgrAfter2.status === 401, ssMeMgrAfter2);
      const ssMeStuAfter2 = await ssMe(ssStu2.cookie);
      ok('single session ON: the new student session is live',
        ssMeStuAfter2.status === 200 && ssMeStuAfter2.d.role === 'student', ssMeStuAfter2);
    } finally {
      ssSrv.kill();
      try { fs.unlinkSync(SS_DB); fs.unlinkSync(SS_DB + '-wal'); fs.unlinkSync(SS_DB + '-shm'); } catch {}
      try { fs.rmSync(SS_UPLOADS, { recursive: true, force: true }); } catch {}
    }
    // (b) + (e) Browser flows (jsdom): the right login redirects to the
    // right place, the wrong role gets the log-out box, and a wrong-role
    // account typed into a page is refused with a plain message.
    let jsdomMod = null;
    try { jsdomMod = require('/home/hatch/workspace/register-bug-repro/node_modules/jsdom'); }
    catch (e1) { try { jsdomMod = require('jsdom'); } catch (e2) { /* jsdom not installed */ } }
    if (!jsdomMod) {
      console.log('  SKIP - login-split jsdom tests (jsdom not installed on this machine)');
    } else {
      const { JSDOM, VirtualConsole } = jsdomMod;
      const pageErrors = [];
      process.on('unhandledRejection', e => pageErrors.push(e && e.message ? e.message : String(e)));
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      function stubNavigation(html) {
        const out = html.replace(/window\.location\.href = ('[^']+');/g, 'window.__redirectTo($1);');
        return { html: out, stubbed: out.includes('__redirectTo') };
      }
      function inlineScripts(html, files) {
        let out = html;
        for (const f of files) {
          const src = fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
          out = out.replace(`<script src="/${f}"></script>`, '<script>\n' + src + '\n</script>');
        }
        return out;
      }
      // Mock /api/auth/me for the guard tests; everything else goes to
      // the real test server with its own IP (rate limits stay out of
      // the way). Node fetch keeps no cookies, so a login inside jsdom
      // never leaks a live session into later checks.
      function drivePage(html, pageUrl, meObj, ip) {
        const redirects = [];
        const jsdomErrors = [];
        const vc = new VirtualConsole();
        vc.on('jsdomError', e => jsdomErrors.push(e && e.message ? e.message : String(e)));
        const dom = new JSDOM(html, { url: pageUrl, runScripts: 'dangerously', virtualConsole: vc,
          beforeParse(window) {
            window.__redirects = redirects;
            window.__redirectTo = u => redirects.push(String(u));
            window.fetch = (input, init) => {
              const u = typeof input === 'string' ? new URL(input, pageUrl).toString() : String(input);
              if (u.endsWith('/api/auth/me')) {
                return Promise.resolve(meObj
                  ? { ok: true, status: 200, json: async () => meObj }
                  : { ok: false, status: 401, json: async () => ({ error: 'not logged in' }) });
              }
              const headers = { ...(init && init.headers ? init.headers : {}), 'X-Forwarded-For': ip };
              return fetch(u, { ...init, headers });
            };
          } });
        return { dom, redirects, jsdomErrors };
      }
      const stuRaw = fs.readFileSync(path.join(__dirname, 'public', 'login-student.html'), 'utf8');
      const stuStub = stubNavigation(inlineScripts(stuRaw, ['shell.js', 'login-student.js']));
      ok('login split: student page navigation sink stubbed (test harness)', stuStub.stubbed,
        'window.location.href not found in login-student page');
      const mgrRaw = fs.readFileSync(path.join(__dirname, 'public', 'login-manager.html'), 'utf8');
      const mgrStub = stubNavigation(inlineScripts(mgrRaw, ['shell.js', 'login-manager.js']));
      ok('login split: manager page navigation sink stubbed (test harness)', mgrStub.stubbed,
        'window.location.href not found in login-manager page');
      const stuMe = { id: 901, display_name: 'Split Stu', role: 'student', status: 'active' };
      const mgrMe = { id: 902, display_name: 'Split Mgr', role: 'manager', status: 'active' };
      // (e1) Student page, logged out: forms visible, no wrong-role box.
      {
        const p = drivePage(stuStub.html, BASE + '/login-student', null, nextIp());
        await sleep(500);
        const doc = p.dom.window.document;
        ok('login split: student page while logged out shows the forms, no wrong-role box',
          doc.getElementById('loginForms').hidden === false &&
          doc.getElementById('wrongRoleBox').hidden === true && p.redirects.length === 0 &&
          p.jsdomErrors.length === 0, 'redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (e2) Student page, logged in as a manager: forms hidden, box shown.
      {
        const p = drivePage(stuStub.html, BASE + '/login-student', mgrMe, nextIp());
        await sleep(500);
        const doc = p.dom.window.document;
        ok('login split: student page while logged in as a manager shows the log-out box, not the forms',
          doc.getElementById('loginForms').hidden === true &&
          doc.getElementById('wrongRoleBox').hidden === false &&
          doc.getElementById('wrongRoleText').textContent.includes('Manager') &&
          doc.getElementById('wrongRoleText').textContent.includes('Log out to log in as a Student') &&
          p.redirects.length === 0 && p.jsdomErrors.length === 0,
          'text=' + JSON.stringify(doc.getElementById('wrongRoleText').textContent) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (e3) Student page, logged in as a student: sent home.
      {
        const p = drivePage(stuStub.html, BASE + '/login-student', stuMe, nextIp());
        await sleep(500);
        ok('login split: student page while logged in as a student redirects home',
          p.redirects.length === 1 && p.redirects[0] === '/' && p.jsdomErrors.length === 0,
          'redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (e4) Manager page, logged in as a student: forms hidden, box shown.
      {
        const p = drivePage(mgrStub.html, BASE + '/login-manager', stuMe, nextIp());
        await sleep(500);
        const doc = p.dom.window.document;
        ok('login split: manager page while logged in as a student shows the log-out box, not the forms',
          doc.getElementById('loginForms').hidden === true &&
          doc.getElementById('wrongRoleBox').hidden === false &&
          doc.getElementById('wrongRoleText').textContent.includes('Student') &&
          doc.getElementById('wrongRoleText').textContent.includes('Log out to log in as a Manager') &&
          p.redirects.length === 0 && p.jsdomErrors.length === 0,
          'text=' + JSON.stringify(doc.getElementById('wrongRoleText').textContent) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (e5) Manager page, logged in as a manager: sent to the portal.
      {
        const p = drivePage(mgrStub.html, BASE + '/login-manager', mgrMe, nextIp());
        await sleep(500);
        ok('login split: manager page while logged in as a manager redirects to the portal',
          p.redirects.length === 1 && p.redirects[0] === '/manager' && p.jsdomErrors.length === 0,
          'redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (b1) Student login on the student page redirects home.
      {
        const p = drivePage(stuStub.html, BASE + '/login-student', null, nextIp());
        await sleep(300);
        const doc = p.dom.window.document;
        doc.querySelector('#stuLogin input[name="gmail"]').value = 'split-stu@example.com';
        doc.querySelector('#stuLogin input[name="password"]').value = 'splitpass1';
        doc.getElementById('stuLogin').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await sleep(800);
        ok('login split: student login on the student page redirects home',
          p.redirects.length === 1 && p.redirects[0] === '/' && p.jsdomErrors.length === 0,
          'redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (b2) Manager account typed into the student page is refused.
      {
        const p = drivePage(stuStub.html, BASE + '/login-student', null, nextIp());
        await sleep(300);
        const doc = p.dom.window.document;
        doc.querySelector('#stuLogin input[name="gmail"]').value = 'split-mgr@example.com';
        doc.querySelector('#stuLogin input[name="password"]').value = 'splitpass1';
        doc.getElementById('stuLogin').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await sleep(800);
        ok('login split: manager account on the student page is refused, no redirect',
          p.redirects.length === 0 &&
          doc.getElementById('stuMsg').textContent.includes('Manager account') &&
          p.jsdomErrors.length === 0,
          'msg=' + JSON.stringify(doc.getElementById('stuMsg').textContent) + ' redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (b3) Manager login on the manager page redirects to the portal.
      {
        const p = drivePage(mgrStub.html, BASE + '/login-manager', null, nextIp());
        await sleep(300);
        const doc = p.dom.window.document;
        doc.querySelector('#mgrLogin input[name="gmail"]').value = 'split-mgr@example.com';
        doc.querySelector('#mgrLogin input[name="password"]').value = 'splitpass1';
        doc.getElementById('mgrLogin').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await sleep(800);
        ok('login split: manager login on the manager page redirects to the portal',
          p.redirects.length === 1 && p.redirects[0] === '/manager' && p.jsdomErrors.length === 0,
          'redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (b4) Student account typed into the manager page is refused.
      {
        const p = drivePage(mgrStub.html, BASE + '/login-manager', null, nextIp());
        await sleep(300);
        const doc = p.dom.window.document;
        doc.querySelector('#mgrLogin input[name="gmail"]').value = 'split-stu@example.com';
        doc.querySelector('#mgrLogin input[name="password"]').value = 'splitpass1';
        doc.getElementById('mgrLogin').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await sleep(800);
        ok('login split: student account on the manager page is refused, no redirect',
          p.redirects.length === 0 &&
          doc.getElementById('mgrMsg').textContent.includes('Student account') &&
          p.jsdomErrors.length === 0,
          'msg=' + JSON.stringify(doc.getElementById('mgrMsg').textContent) + ' redirects=' + JSON.stringify(p.redirects) + ' errors=' + JSON.stringify(p.jsdomErrors));
        p.dom.window.close();
      }
      // (b5) Register as a student from the student page, then log in.
      {
        const p = drivePage(stuStub.html, BASE + '/login-student', null, nextIp());
        await sleep(300);
        const doc = p.dom.window.document;
        doc.querySelector('#stuRegister input[name="gmail"]').value = 'split-reg-stu@example.com';
        doc.querySelector('#stuRegister input[name="password"]').value = 'splitpass1';
        doc.querySelector('#stuRegister input[name="display_name"]').value = 'Split Reg Stu';
        doc.getElementById('stuRegister').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await sleep(800);
        const regOk = doc.getElementById('regMsg').textContent.includes('You can log in now.');
        p.dom.window.close();
        const l = await login('split-reg-stu@example.com', 'splitpass1', nextIp());
        const m = await me(l.cookie);
        ok('login split: student register on the student page creates a student account',
          regOk && l.status === 200 && m.d.role === 'student', { regOk, login: l.status, role: m.d && m.d.role });
      }
      // (b6) Register as a manager from the manager page: pending, cannot log in yet.
      {
        const p = drivePage(mgrStub.html, BASE + '/login-manager', null, nextIp());
        await sleep(300);
        const doc = p.dom.window.document;
        doc.querySelector('#mgrRegister input[name="gmail"]').value = 'split-reg-mgr@example.com';
        doc.querySelector('#mgrRegister input[name="password"]').value = 'splitpass1';
        doc.querySelector('#mgrRegister input[name="display_name"]').value = 'Split Reg Mgr';
        doc.getElementById('mgrRegister').dispatchEvent(new p.dom.window.Event('submit', { bubbles: true, cancelable: true }));
        await sleep(800);
        const regOk = doc.getElementById('regMsg').textContent.includes('waiting for master approval');
        p.dom.window.close();
        const l = await login('split-reg-mgr@example.com', 'splitpass1', nextIp());
        ok('login split: manager register on the manager page creates a pending account (cannot log in yet)',
          regOk && l.status === 401, { regOk, login: l.status });
      }
      ok('login split: no unhandled rejection from any page handler', pageErrors.length === 0, JSON.stringify(pageErrors));
    }

    // ---- 22. Review (2026-11-07): fixes from the full review ----
    // 22a. City-only edit must not leave a stale area from another city.
    const cityMgr = await makeManager('r22-city@example.com');
    const cityHostel = await mgrPost(cityMgr.cookie, { ...fullListing, name: 'R22 City Hostel', city: 'Lahore', area: 'Gulberg' });
    ok('review: city test hostel created', cityHostel.status === 201, cityHostel.status);
    const cityOnly = await mgrPut(cityMgr.cookie, cityHostel.d.listing.id, { city: 'Islamabad' });
    ok('review: city-only edit is 400 when the area belongs to the old city',
      cityOnly.status === 400 && cityOnly.d.error && cityOnly.d.error.includes('area'), cityOnly);
    const cityWithArea = await mgrPut(cityMgr.cookie, cityHostel.d.listing.id, { city: 'Islamabad', area: 'H-8' });
    ok('review: city + matching area edit is 200', cityWithArea.status === 200 && cityWithArea.d.listing.city === 'Islamabad' && cityWithArea.d.listing.area === 'H-8', cityWithArea.d.listing);
    const citySame = await mgrPut(cityMgr.cookie, cityHostel.d.listing.id, { city: 'Peshawar', area: 'Hayatabad' });
    ok('review: city + area edit back is 200', citySame.status === 200, citySame.status);

    // 22b. Maps: the short link the Google Maps app shares (maps.app.goo.gl)
    // is accepted; its embed falls back to the street address (a short link
    // cannot be embedded directly). Place URLs embed their @lat,lng.
    const gooCreate = await mgrPost(cityMgr.cookie, { ...fullListing, name: 'R22 Goo Link Hostel',
      address: 'House 12, Street 3, University Road, Peshawar', maps_url: 'https://maps.app.goo.gl/AbC123xYz' });
    ok('review: maps.app.goo.gl share link is accepted (201)', gooCreate.status === 201, gooCreate);
    const gooDet = await get('/api/listings/' + gooCreate.d.listing.id);
    ok('review: goo.gl link falls back to the address embed (no broken q=<url>)',
      gooDet.listing.maps_embed_url.includes('maps.google.com/maps?q=House%2012') && !gooDet.listing.maps_embed_url.includes('goo.gl'), gooDet.listing.maps_embed_url);
    ok('review: the saved goo.gl link still opens in Google Maps',
      gooDet.listing.maps_url === 'https://maps.app.goo.gl/AbC123xYz', gooDet.listing.maps_url);
    const placeCreate = await mgrPost(cityMgr.cookie, { ...fullListing, name: 'R22 Place URL Hostel',
      maps_url: 'https://www.google.com/maps/place/UET+Lahore/@31.5779,74.3555,17z' });
    ok('review: Maps place URL is accepted (201)', placeCreate.status === 201, placeCreate.status);
    const placeDet = await get('/api/listings/' + placeCreate.d.listing.id);
    ok('review: place URL embeds its @lat,lng',
      placeDet.listing.maps_embed_url.includes('maps.google.com/maps?q=31.5779,74.3555'), placeDet.listing.maps_embed_url);
    const badGoo = await mgrPost(cityMgr.cookie, { ...fullListing, name: 'R22 Bad Goo', maps_url: 'https://goo.gl/maps/abc123' });
    ok('review: plain goo.gl short links are still rejected (only maps.app.goo.gl)',
      badGoo.status === 400, badGoo.status);

    // 22c. Master can see a pending photo (header auth); the public still cannot.
    const pendMasterName = 'photo-' + 'b'.repeat(32) + '.jpg';
    fs.writeFileSync(path.join(UPLOADS, pendMasterName), JPEG);
    const tdb2 = new DatabaseSync(DB);
    tdb2.prepare(`INSERT INTO photos(listing_id, uploader_id, kind, filename, caption, status)
      VALUES(?,?,?,?,?,'pending')`).run(phId, mgr1.id, 'hostel', pendMasterName, 'master-view');
    tdb2.close();
    const pendMaster = await req('GET', '/api/photos/file/' + pendMasterName, { headers: { 'X-Master-Code': MASTER } });
    ok('review: pending photo IS served to the master code (200)', pendMaster.status === 200, pendMaster.status);
    const pendAnon2 = await fileGet('/api/photos/file/' + pendMasterName);
    ok('review: pending photo is still NOT public (404)', pendAnon2.status === 404, pendAnon2.status);

    // 22d. Compare needs 2 or 3 DIFFERENT ids.
    const cmpDup = await get('/api/compare?ids=1,1');
    ok('review: compare with duplicate ids (1,1) is 400', cmpDup.error && cmpDup.error.includes('2 or 3'), cmpDup);
    const cmpDup2 = await get('/api/compare?ids=1,1,2');
    ok('review: compare with ids 1,1,2 returns the 2 distinct listings',
      cmpDup2.listings && cmpDup2.listings.length === 2, cmpDup2.listings && cmpDup2.listings.length);

    // 22e. Frontend fixes are present in the served files.
    const hostelJs22 = fs.readFileSync(path.join(__dirname, 'public', 'hostel.js'), 'utf8');
    ok('review: detail page labels amenities + mess status in plain words',
      hostelJs22.includes('AMENITY_LABELS') && hostelJs22.includes("'Security guard'") &&
      hostelJs22.includes('MESS_STATUS_LABELS') && hostelJs22.includes("'Not available'") &&
      !hostelJs22.includes('escapeHtml(k)}: ${escapeHtml(v.state)}'), 'labels missing');
    const managerJs22 = fs.readFileSync(path.join(__dirname, 'public', 'manager.js'), 'utf8');
    ok('review: manager portal maps active status to Approved + has the change-password form handler',
      managerJs22.includes("u.status === 'active' ? 'Approved'") &&
      managerJs22.includes("'/api/auth/change-password'") &&
      managerJs22.includes("$('pwForm')"), 'manager.js fix missing');
    ok('review: manager portal HTML has the change-password form',
      mgrHtml.includes('id="pwForm"') && mgrHtml.includes('name="old_password"') && mgrHtml.includes('name="new_password"'),
      'pwForm missing from manager.html');
    const adminJs22 = fs.readFileSync(path.join(__dirname, 'public', 'admin.js'), 'utf8');
    ok('review: admin hide/edit check the response before claiming success',
      adminJs22.includes("r.ok ? 'Hidden.'") && adminJs22.includes("r.ok ? 'Price change saved"),
      'admin.js still claims success unconditionally');
    ok('review: home page labels the rent cap as per month',
      indexHtml.includes('Max rent per month (PKR)'), 'index.html label unchanged');

    // 22f. Per-IP upload limit: a second server with UPLOAD_IP_LIMIT_PER_HOUR=3
    // lets 3 uploads through and answers 429 on the 4th.
    const UL_PORT = 3099;
    const UL_DB = '/tmp/hostel-test-ul-' + process.pid + '.sqlite';
    const UL_UPLOADS = '/tmp/hostel-test-ul-uploads-' + process.pid;
    const UL_BASE = 'http://127.0.0.1:' + UL_PORT;
    const ulReq = (method, p, opts = {}) => new Promise((resolve, reject) => {
      const r = httpMod.request({ host: '127.0.0.1', port: UL_PORT, path: p, method,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }, res => {
        let s = ''; res.on('data', c => { s += c; }); res.on('end', () => {
          let d; try { d = JSON.parse(s); } catch { d = s; }
          const sc = res.headers['set-cookie'];
          resolve({ status: res.statusCode, d,
            cookie: Array.isArray(sc) && sc[0] ? sc[0].split(';')[0] : (sc ? sc.split(';')[0] : null) });
        });
      });
      r.on('error', reject);
      if (opts.body !== undefined) r.write(JSON.stringify(opts.body));
      r.end();
    });
    const ulSrv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(UL_PORT), DB_FILE: UL_DB, UPLOADS_DIR: UL_UPLOADS,
        ADMIN_CODE: 'test-admin-code', LOGIN_LOCK_SECONDS: '2', UPLOAD_IP_LIMIT_PER_HOUR: '3' },
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 50; i++) {
        try { const r = await fetch(UL_BASE + '/'); if (r.ok) break; } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
      const ulReg = await ulReq('POST', '/api/auth/register',
        { body: { gmail: 'ul-mgr@example.com', password: 'ulpass99', display_name: 'ul-mgr', phone: '03001234567', role: 'manager' },
          headers: { 'X-Forwarded-For': nextIp() } });
      await ulReq('POST', '/api/master/managers/decide',
        { body: { user_id: ulReg.d.id, decision: 'approve' }, headers: { 'X-Master-Code': MASTER } });
      const ulLogin = await ulReq('POST', '/api/auth/login',
        { body: { gmail: 'ul-mgr@example.com', password: 'ulpass99' }, headers: { 'X-Forwarded-For': nextIp() } });
      const ulCreate = await ulReq('POST', '/api/manager/listings',
        { body: { name: 'UL Hostel', city: 'Lahore', area: 'Gulberg', type: 'boys', room: 'single', rent_pkr: 12000 },
          headers: { Cookie: ulLogin.cookie } });
      const ulHostelId = ulCreate.d.listing.id;
      const ulUpload = () => {
        const { body, boundary } = multipart({ listing_id: String(ulHostelId), kind: 'hostel', caption: '' }, jpegFile);
        return new Promise((resolve, reject) => {
          const r = httpMod.request({ host: '127.0.0.1', port: UL_PORT, path: '/api/manager/photos', method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, Cookie: ulLogin.cookie } }, res => {
            let s = ''; res.on('data', c => { s += c; }); res.on('end', () => {
              let d; try { d = JSON.parse(s); } catch { d = s; } resolve({ status: res.statusCode, d });
            });
          });
          r.on('error', reject); r.write(body); r.end();
        });
      };
      const u1 = await ulUpload();
      const u2 = await ulUpload();
      const u3 = await ulUpload();
      ok('review: per-IP upload limit allows the first 3 uploads',
        u1.status === 200 && u2.status === 200 && u3.status === 200, [u1.status, u2.status, u3.status]);
      const u4 = await ulUpload();
      ok('review: per-IP upload limit answers 429 on the 4th upload in the hour',
        u4.status === 429, u4);
    } finally {
      ulSrv.kill();
      try { fs.unlinkSync(UL_DB); fs.unlinkSync(UL_DB + '-wal'); fs.unlinkSync(UL_DB + '-shm'); } catch {}
      try { fs.rmSync(UL_UPLOADS, { recursive: true, force: true }); } catch {}
    }

    // 23. Completeness round 2: read-only-dir fallback, Secure cookie,
    // plain-HTTP login, student change-password UI.
    // 23a. Fallback helper: requiring server.js as a module starts no
    // listener (require.main guard) and exports writableBase +
    // resolveDataPaths. A writable app dir keeps the original paths;
    // a non-writable dir (/proc/1 is unwritable even as root) and a
    // missing dir both fall back to os.tmpdir()/hostel; explicit
    // DB_FILE / UPLOADS_DIR env vars always win.
    const FB_DB = '/tmp/hostel-test-fb-' + process.pid + '.sqlite';
    const FB_UPLOADS = '/tmp/hostel-test-fb-uploads-' + process.pid;
    const fbScript = [
      "const path = require('node:path');",
      "const os = require('node:os');",
      "const m = require(process.argv[1]);",
      "const srvDir = process.argv[2];",
      "const tmpHostel = path.join(os.tmpdir(), 'hostel');",
      "const noEnv = m.resolveDataPaths({});",
      "const withEnv = m.resolveDataPaths({ DB_FILE: '/tmp/fb-x.sqlite', UPLOADS_DIR: '/tmp/fb-x-up' });",
      "console.log(JSON.stringify({",
      "  selfWritable: m.writableBase(srvDir) === srvDir,",
      "  procFallback: m.writableBase('/proc/1') === tmpHostel,",
      "  missingFallback: m.writableBase('/nonexistent-hostel-xyz') === tmpHostel,",
      "  noEnvDb: noEnv.dbFile === path.join(srvDir, 'data', 'hostel.sqlite'),",
      "  noEnvUploads: noEnv.uploadsDir === path.join(srvDir, 'uploads'),",
      "  envDbWins: withEnv.dbFile === '/tmp/fb-x.sqlite',",
      "  envUploadsWins: withEnv.uploadsDir === '/tmp/fb-x-up',",
      "}));",
    ].join('\n');
    const fbOut = await new Promise(resolve => {
      const child = spawn(process.execPath, ['-e', fbScript,
        path.join(__dirname, 'server.js'), __dirname], {
        env: { ...process.env, ADMIN_CODE: 'test-admin-code', DB_FILE: FB_DB, UPLOADS_DIR: FB_UPLOADS },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      child.stdout.on('data', c => { out += c; });
      child.stderr.on('data', c => { err += c; });
      const to = setTimeout(() => { child.kill(); resolve({ out, err, timedOut: true }); }, 15000);
      child.on('exit', () => { clearTimeout(to); resolve({ out, err, timedOut: false }); });
    });
    let fb = null;
    try { fb = JSON.parse(fbOut.out.trim().split('\n').pop()); } catch {}
    ok('fallback: helper child exits on its own (no listener when required)', fbOut.timedOut === false, fbOut);
    ok('fallback: writable app dir keeps its own path', !!(fb && fb.selfWritable), fb);
    ok('fallback: non-writable dir falls back to tmp hostel dir', !!(fb && fb.procFallback), fb);
    ok('fallback: missing dir falls back to tmp hostel dir', !!(fb && fb.missingFallback), fb);
    ok('fallback: no env keeps data/hostel.sqlite + uploads/ next to server', !!(fb && fb.noEnvDb && fb.noEnvUploads), fb);
    ok('fallback: explicit DB_FILE / UPLOADS_DIR env vars win', !!(fb && fb.envDbWins && fb.envUploadsWins), fb);
    try { fs.unlinkSync(FB_DB); fs.unlinkSync(FB_DB + '-wal'); fs.unlinkSync(FB_DB + '-shm'); } catch {}
    try { fs.rmSync(FB_UPLOADS, { recursive: true, force: true }); } catch {}

    // 23b. Secure flag: the login Set-Cookie carries Secure (and
    // HttpOnly); the logout cookie does too. The flag was already in
    // the code — this test pins it so a regression is caught.
    const secReg = await reg('stu-sec@example.com', 'student', 'secpass99', nextIp());
    ok('secure: student registers for the cookie test', secReg.status === 201, secReg.status);
    const secLogin = await req('POST', '/api/auth/login',
      { body: { gmail: 'stu-sec@example.com', password: 'secpass99' }, headers: { 'X-Forwarded-For': nextIp() } });
    ok('secure: login Set-Cookie carries Secure', secLogin.status === 200 && secLogin.setCookie.includes('Secure'), secLogin.setCookie);
    ok('secure: login Set-Cookie carries HttpOnly', secLogin.setCookie.includes('HttpOnly'), secLogin.setCookie);
    // 23b2. Real plain-HTTP login on 127.0.0.1: the cookie the server
    // returns over plain HTTP authenticates the next request. (A real
    // browser over plain HTTP would NOT store a Secure cookie — that
    // is why live sites are HTTPS-only. The server side still works.)
    const secMe = await me(secLogin.cookie);
    ok('secure: plain-HTTP login cookie authenticates /api/auth/me', secMe.status === 200, secMe.status);
    const secLogout = await req('POST', '/api/auth/logout', { headers: { Cookie: secLogin.cookie } });
    ok('secure: logout Set-Cookie carries Secure + Max-Age=0',
      secLogout.setCookie.includes('Secure') && secLogout.setCookie.includes('Max-Age=0'), secLogout.setCookie);

    // 23c. Student change-password via the student flow: a fresh
    // student changes their own password, the old one stops, the new
    // one logs in.
    const stuPw = await reg('stu-pw@example.com', 'student', 'stupwpass1', nextIp());
    const stuPwLogin = await login('stu-pw@example.com', 'stupwpass1', nextIp());
    const stuChg = await req('POST', '/api/auth/change-password',
      { body: { old_password: 'stupwpass1', new_password: 'stupwpass2' }, headers: { Cookie: stuPwLogin.cookie } });
    ok('student change-password succeeds for a student account', stuChg.status === 200 && stuChg.d.ok === true, stuChg);
    const stuOldPw = await login('stu-pw@example.com', 'stupwpass1', nextIp());
    ok('student change-password: old password stops working', stuOldPw.status === 401, stuOldPw.status);
    const stuNewPw = await login('stu-pw@example.com', 'stupwpass2', nextIp());
    ok('student change-password: new password logs in', stuNewPw.status === 200, stuNewPw.status);

    // 23d. Student change-password UI exists on BOTH student pages
    // (home + hostel detail), wired to the same endpoint, with a
    // confirm field checked client-side before the request.
    const appJs23 = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    const hostelJs23 = fs.readFileSync(path.join(__dirname, 'public', 'hostel.js'), 'utf8');
    ok('student UI: home page has the change-password form with confirm',
      indexHtml.includes('id="pwForm"') && indexHtml.includes('name="old_password"') &&
      indexHtml.includes('name="new_password"') && indexHtml.includes('name="confirm_password"') &&
      indexHtml.includes('id="pwMsg"'), 'index.html pwForm missing');
    ok('student UI: hostel detail page has the change-password form with confirm',
      fs.readFileSync(path.join(__dirname, 'public', 'hostel.html'), 'utf8').includes('id="pwForm"') &&
      fs.readFileSync(path.join(__dirname, 'public', 'hostel.html'), 'utf8').includes('name="confirm_password"'),
      'hostel.html pwForm missing');
    ok('student UI: home JS wires the form to the endpoint + checks confirm first',
      appJs23.includes("'/api/auth/change-password'") && appJs23.includes("do not match") &&
      appJs23.includes('showStudentAccount'), 'app.js student pw handler missing');
    ok('student UI: detail JS wires the form to the endpoint + checks confirm first',
      hostelJs23.includes("'/api/auth/change-password'") && hostelJs23.includes("do not match") &&
      hostelJs23.includes('showStudentAccount'), 'hostel.js student pw handler missing');

    console.log(`\n${pass} passed, ${fail} failed.`);
    if (fail) process.exitCode = 1; else console.log('ALL TESTS PASS');
  } finally {
    srv.kill();
    try { fs.unlinkSync(DB); fs.unlinkSync(DB + '-wal'); fs.unlinkSync(DB + '-shm'); } catch {}
    try { fs.rmSync(UPLOADS, { recursive: true, force: true }); } catch {}
  }
}
main();

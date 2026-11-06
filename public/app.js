'use strict';
let META = null;
const $ = id => document.getElementById(id);
const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');
// Escape every user-derived string before it goes into innerHTML.
// Listing names/sources, reference rows and history fields all come from
// user or manager input and must never be inserted as raw HTML.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadMeta() {
  META = await (await fetch('/api/meta')).json();
  for (const c of META.cities) {
    $('city').insertAdjacentHTML('beforeend', `<option>${escapeHtml(c)}</option>`);
  }
  fillAreas($('city').value, $('area'));
}
function fillAreas(city, sel) {
  const areas = city ? META.areas[city] : Object.values(META.areas).flat();
  sel.innerHTML = '<option value="">All areas</option>' +
    areas.map(a => `<option>${escapeHtml(a)}</option>`).join('');
}
$('city').addEventListener('change', () => fillAreas($('city').value, $('area')));

function badge(l) {
  if (l.status === 'VERIFIED') return `<span class="b v">✓ VERIFIED${l.last_verified ? ' · ' + escapeHtml(l.last_verified) : ''}</span>`;
  if (l.status === 'EXAMPLE') return '<span class="b e">EXAMPLE — demo only</span>';
  return '<span class="b l">LISTED — unverified manager listing</span>';
}
function card(l) {
  const basis = l.price_basis === 'semester' ? 'per semester' : 'per month';
  const mess = l.mess_included ? 'Mess included' : (l.mess_pkr ? fmt(l.mess_pkr) + '/month mess' : 'Mess price unknown');
  const fac = l.facilities.length ? l.facilities.map(escapeHtml).join(' · ') : 'Facilities not listed';
  return `<article class="listing"><h3>${escapeHtml(l.name)}</h3>${badge(l)}
  <p>${escapeHtml(l.city)} · ${escapeHtml(l.area)}${l.near_university ? ' · near ' + escapeHtml(l.near_university) : ''}</p>
  <p>${escapeHtml(l.type)} · ${escapeHtml(l.room)} room · <b>${fmt(l.rent_pkr)} ${basis}</b>${l.price_basis === 'semester' ? ` (≈ ${fmt(l.monthly_rent_equivalent)}/month)` : ''}</p>
  <p>${mess}${l.meals_per_day ? ' · ' + l.meals_per_day + ' meals/day' : ''}</p>
  <p>${fac}</p><p class="src">Source: ${escapeHtml(l.source) || '—'}</p>
  ${l.manager_suspended ? '<p><b>Manager suspended — contact the site admin.</b></p>' : ''}
  <p><a href="/hostel?id=${l.id}">Full details &amp; reviews</a> · <a href="/hostel?id=${l.id}">Write a review</a> · <a href="/hostel?id=${l.id}" data-detail="${l.id}">Price history &amp; details</a> · <label class="chk"><input type="checkbox" class="cmp" value="${l.id}"> Compare</label></p>
  <div id="det-${l.id}"></div></article>`;
}

async function search() {
  const q = new URLSearchParams();
  for (const [k, el] of [['city', $('city')], ['area', $('area')], ['type', $('type')], ['room', $('room')], ['mess', $('mess')], ['sort', $('sort')]])
    if (el.value) q.set(k, el.value);
  if ($('maxRent').value) q.set('max_rent', $('maxRent').value);
  if ($('showExamples').checked) q.set('show_examples', '1');
  const d = await (await fetch('/api/listings?' + q)).json();
  // Phase 3 quick filter (Ask Hostel AI chips): applied on top of the
  // server-filtered rows, so it composes with city/area/type/room/mess/
  // max-rent/sort instead of building a second filtering system.
  // getQuickFilter / applyQuickFilter live in the STATS section below;
  // function declarations hoist, so they exist by the time search runs.
  let rows = d.listings;
  const qf = typeof getQuickFilter === 'function' ? getQuickFilter() : null;
  if (qf && typeof applyQuickFilter === 'function') rows = applyQuickFilter(rows, qf);
  $('counts').textContent = `${d.counts.total} listings (${d.counts.verified} verified, ${d.counts.listed} listed — examples never counted)` +
    (qf ? ` — showing ${rows.length}` : '');
  // Greeting sub-line shows the same real counts — never a made-up number.
  $('greetingSub').textContent = `${d.counts.total} listings · ${d.counts.verified} verified · ${d.counts.listed} listed`;
  $('results').innerHTML = rows.length ? rows.map(card).join('') : '<p>No hostels match — try widening the filters.</p>';
  $('calcListing').innerHTML = rows.map(l => `<option value="${l.id}">${escapeHtml(l.name)} — ${fmt(l.rent_pkr)}</option>`).join('');
  document.querySelectorAll('[data-detail]').forEach(a => a.addEventListener('click', async ev => {
    ev.preventDefault();
    const det = await (await fetch('/api/listings/' + a.dataset.detail)).json();
    document.getElementById('det-' + a.dataset.detail).innerHTML =
      det.history.length ? '<h4>Price history</h4><ul>' + det.history.map(h =>
        `<li>${escapeHtml(h.changed_date)}: ${escapeHtml(h.field)} ${fmt(h.old_value)} → ${fmt(h.new_value)}</li>`).join('') + '</ul>'
      : '<p>No price changes recorded yet.</p>';
  }));
}
$('searchBtn').addEventListener('click', search);

$('calcBtn').addEventListener('click', async () => {
  if (!$('calcListing').value) { $('calcOut').textContent = 'Pick a listing first — no hostels match the current filters.'; return; }
  const d = await (await fetch(`/api/calc?listing_id=${$('calcListing').value}&extras=${$('calcExtras').value || 0}`)).json();
  if (d.error) { $('calcOut').textContent = 'Error: ' + d.error; return; }
  $('calcOut').textContent = `Rent ${fmt(d.rent)} (${d.rent_basis}) + Mess ${fmt(d.mess)} + Extras ${fmt(d.extras)} = ${fmt(d.total)} per month.`;
});

$('compareBtn').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.cmp:checked')].map(c => c.value);
  if (ids.length < 2 || ids.length > 3) { $('compareOut').textContent = 'Tick 2 or 3 listings to compare.'; return; }
  const d = await (await fetch('/api/compare?ids=' + ids.join(',') + ($('showExamples').checked ? '&show_examples=1' : ''))).json();
  $('compareOut').innerHTML = '<table><tr><th></th>' + d.listings.map(l => `<th>${escapeHtml(l.name)}</th>`).join('') + '</tr>' +
    `<tr><td>Status</td>${d.listings.map(l => `<td>${escapeHtml(l.status)}</td>`).join('')}</tr>` +
    `<tr><td>Rent</td>${d.listings.map(l => `<td>${fmt(l.rent_pkr)} ${l.price_basis === 'semester' ? 'per semester' : 'per month'}</td>`).join('')}</tr>` +
    `<tr><td>Mess</td>${d.listings.map(l => `<td>${l.mess_included ? 'Included' : (l.mess_pkr ? fmt(l.mess_pkr) : 'Unknown')}</td>`).join('')}</tr>` +
    `<tr><td>Monthly total (no extras)</td>${d.listings.map(l => `<td>${fmt(l.monthly_rent_equivalent + (l.mess_included ? 0 : l.mess_pkr))}</td>`).join('')}</tr>` +
    `<tr><td>Facilities</td>${d.listings.map(l => `<td>${l.facilities.map(escapeHtml).join(', ') || '—'}</td>`).join('')}</tr></table>`;
});

async function loadRefs() {
  const d = await (await fetch('/api/reference')).json();
  $('refs').innerHTML = '<ul>' + d.references.map(r =>
    `<li><b>${escapeHtml(r.scope)}:</b> ${escapeHtml(r.figure)} — <i>${escapeHtml(r.source)}</i> (${escapeHtml(r.date_label)})${r.note ? ' — ' + escapeHtml(r.note) : ''}</li>`).join('') + '</ul>';
}
// --- Phase 1 shell: greeting + avatar from /api/auth/me, scene zoom,
// notifications popover (honest empty state), nav search shortcut. ---
function timeGreeting() {
  const h = new Date().getHours();
  if (h >= 17 || h < 5) return 'Good evening';
  if (h >= 12) return 'Good afternoon';
  return 'Good morning';
}
function roleLabel(role) {
  return role === 'manager' ? 'Manager' : role === 'student' ? 'Student' : role;
}
async function loadShellUser() {
  let me;
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) return; // logged out: keep the logged-out greeting + Log in button
    me = await r.json();
  } catch { return; } // offline: shell keeps its logged-out defaults
  $('greetingTitle').textContent = timeGreeting() + ', ' + roleLabel(me.role);
  $('avatarInitial').textContent = (me.display_name || '?').trim().charAt(0).toUpperCase() || '?';
  $('avatarName').textContent = me.display_name || roleLabel(me.role);
  $('avatarRole').textContent = roleLabel(me.role);
  $('avatarLink').href = me.role === 'manager' ? '/manager' : '/';
  const out = $('navLogoutBtn');
  if (out) out.hidden = false;
}

let sceneScale = 1;
function setZoom(s) {
  sceneScale = Math.min(1.5, Math.max(0.7, Math.round(s * 10) / 10));
  $('sceneInner').style.transform = 'scale(' + sceneScale + ')';
  $('zoomLevel').textContent = Math.round(sceneScale * 100) + '%';
}
$('zoomIn').addEventListener('click', () => setZoom(sceneScale + 0.1));
$('zoomOut').addEventListener('click', () => setZoom(sceneScale - 0.1));

$('bellBtn').addEventListener('click', () => {
  const open = $('bellPop').hidden;
  $('bellPop').hidden = !open;
  $('bellBtn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', ev => {
  if (!$('bellPop').hidden && !ev.target.closest('.bell-wrap')) {
    $('bellPop').hidden = true;
    $('bellBtn').setAttribute('aria-expanded', 'false');
  }
});

$('navSearchBtn').addEventListener('click', () => {
  $('find').scrollIntoView({ behavior: 'smooth' });
  $('city').focus({ preventScroll: true });
});

// Log out from the home page, like the four sub-pages (Phase 4 shell):
// POST /api/auth/logout, then reload as a logged-out visitor.
const navLogoutBtn = $('navLogoutBtn');
if (navLogoutBtn) navLogoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

loadMeta().then(() => { search(); loadRefs(); });
loadShellUser();
// --- Phase 2: the 3D scene (app.js scene section, below) is the map on the home page.

// ---- BEGIN SCENE (Phase 2: the 3D hostel scene) ----
// The scene lives in app.js (not a separate file) because server.js
// serves static files from a fixed per-file list and this phase
// does not change server.js. Tests extract this section by the
// markers and evaluate it standalone in Node (see test.js §16).
'use strict';
// Phase 2 — the 3D hostel scene on the home page (in public/app.js, BEGIN/END SCENE markers).
// Pure CSS 3D (isometric floor: rotateX/rotateZ; room-blocks, wall screen,
// clock, sofa, round table, plants — all CSS shapes, no images, no CDN,
// no canvas). The scene IS the map: one room-block per VERIFIED/LISTED
// hostel from /api/listings (EXAMPLE rows never render), each block
// linking to the hostel detail page (/hostel?id=N, the same URL app.js
// uses). The wall screen charts real monthly rents; each student figure
// is labelled only with the display name of an approved reviewer on that
// hostel (from /api/listings/:id/reviews) — no name label when there is
// none. Every user string is set with textContent, never as raw HTML.
//
// The pure data functions are exported for Node (test.js extracts this
// section by the markers and evaluates it standalone) as well as
// attached to window for the browser. Nothing in this section touches
// the DOM at definition time.

// ---- Layout constants (floor-local pixels) ----
const FLOOR_W = 640;
const COLS = 3;
const BLOCK_W = 170;
const BLOCK_H = 105;
const COL_X = [15, 235, 455];
const ROW_Y0 = 40;
const ROW_PITCH = 140;
const BOTTOM_STRIP = 140; // dressing strip (sofa, round table, plants)
const MAX_BAR_PX = 56;
const PERSON_COLORS = ['#c2410a', '#166534', '#3730a3', '#0e7490', '#a16207', '#9a3412'];
const sceneFmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');

// ---- Pure data functions (unit-tested in test.js) ----

// Only VERIFIED + LISTED hostels belong on the map. EXAMPLE rows are
// excluded exactly as they are excluded from search.
function sceneListings(listings) {
  return (Array.isArray(listings) ? listings : [])
    .filter(l => l && (l.status === 'VERIFIED' || l.status === 'LISTED'));
}
// Detail URL — identical to the link app.js builds in its listing cards.
function detailUrl(l) { return '/hostel?id=' + encodeURIComponent(l.id); }
// Monthly rent. Semester rows use the same /6 monthly equivalent the
// rest of the app uses (labelled as an estimate wherever it is shown).
function monthlyRent(l) {
  if (!l) return 0;
  if (typeof l.monthly_rent_equivalent === 'number') return l.monthly_rent_equivalent;
  return l.price_basis === 'semester' ? Math.round(Number(l.rent_pkr) / 6) : Number(l.rent_pkr) || 0;
}
// The real rent as the block label shows it: semester rows keep their
// real per-semester figure, monthly rows show per month.
function rentLabel(l) {
  if (!l) return '';
  return l.price_basis === 'semester'
    ? sceneFmt(l.rent_pkr) + ' /semester'
    : sceneFmt(l.rent_pkr) + ' /month';
}
// Wall-screen chart data: one bar per listed hostel, real monthly rents.
function chartData(listings) {
  const rows = sceneListings(listings).map(l => ({
    id: l.id, name: l.name, monthlyRent: monthlyRent(l),
    semester: l.price_basis === 'semester',
  }));
  const max = rows.reduce((m, r) => Math.max(m, r.monthlyRent), 0);
  return { rows, max, hasSemester: rows.some(r => r.semester) };
}
// Bar height in px, scaled to the tallest rent. Zero rent draws no bar.
function barHeight(value, max, maxPx) {
  const top = maxPx === undefined ? MAX_BAR_PX : maxPx;
  if (!max || max <= 0 || !value || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * top));
}
// The student-figure label: the first approved review's display name.
// The reviews endpoint only ever returns approved reviews, and the
// server falls back to the generic word "Student" when a review has no
// student behind it — that is not a real name, so no label either.
function studentLabel(reviews) {
  const rs = Array.isArray(reviews) ? reviews : [];
  if (!rs.length) return null;
  const name = rs[0].reviewer_name;
  if (!name || name === 'Student') return null;
  return name;
}
// Block grid: 3 columns, rows as needed; floor grows with the rows so
// every listed hostel gets a block (never capped at the seed's 6).
function layout(listings) {
  const rows = sceneListings(listings);
  const rowCount = Math.max(1, Math.ceil(rows.length / COLS));
  const floorH = ROW_Y0 + (rowCount - 1) * ROW_PITCH + BLOCK_H + BOTTOM_STRIP;
  const blocks = rows.map((l, i) => ({
    listing: l,
    x: COL_X[i % COLS],
    y: ROW_Y0 + Math.floor(i / COLS) * ROW_PITCH,
  }));
  return { count: rows.length, rows: rowCount, floorH, blocks };
}
// Section height the scene needs: floor on screen is (W+H)*0.707 wide
// and *cos60 tall, the wall stands ~140 above the back edge, labels
// float above the blocks; +320 covers the scene padding and margins.
function sceneMinHeight(floorH) {
  return Math.ceil((FLOOR_W + floorH) * 0.36) + 320;
}

// ---- DOM builders (browser only; createElement + textContent only) ----
function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function buildWallScreen(chart) {
  const screen = el('div', 'wall-screen');
  el('p', 'wall-screen-title', screen, 'Monthly rent (Rs)');
  const bars = el('div', 'wall-bars', screen);
  for (const r of chart.rows) {
    const wrap = el('div', 'wall-bar-wrap', bars);
    const bar = el('div', 'wall-bar', wrap);
    bar.style.height = barHeight(r.monthlyRent, chart.max) + 'px';
    bar.title = r.name + ' — ' + sceneFmt(r.monthlyRent) + '/month';
    const lab = el('div', 'wall-bar-label', wrap);
    el('span', 'wall-bar-name', lab, r.name).title = r.name;
    el('b', null, lab, sceneFmt(r.monthlyRent));
  }
  if (chart.hasSemester) {
    el('p', 'wall-screen-note', screen,
      'Semester hostels shown as monthly equivalent (÷6).');
  }
  return screen;
}

function buildBlock(b, index, reviewerName) {
  const l = b.listing;
  const a = el('a', 'room-block' + (l.status === 'VERIFIED' ? ' is-verified' : ' is-listed'));
  a.href = detailUrl(l);
  a.style.left = b.x + 'px';
  a.style.top = b.y + 'px';
  a.setAttribute('aria-label',
    l.name + ' — ' + rentLabel(l) + ', ' + l.status + '. Open details.');
  el('div', 'room-bed', a);
  el('div', 'room-desk', a);
  const person = el('div', 'person', a);
  person.style.setProperty('--person-color', PERSON_COLORS[index % PERSON_COLORS.length]);
  el('div', 'person-head', person);
  el('div', 'person-body', person);
  if (reviewerName) {
    const nm = el('span', 'person-name', a, reviewerName);
    nm.title = 'Reviewed by ' + reviewerName;
  }
  const label = el('div', 'room-label', a);
  const dot = el('span', 'st ' + (l.status === 'VERIFIED' ? 'v' : 'l'), label);
  dot.title = l.status;
  const nameEl = el('span', 'room-label-name', label, l.name);
  nameEl.title = l.name;
  el('span', 'room-label-rent', label, rentLabel(l));
  return a;
}

function buildDressing(floor) {
  // Black sofa + coffee table, bottom-left (like the reel's lounge corner).
  const sofa = el('div', 'iso-box sofa', floor);
  sofa.style.left = '15px';
  sofa.style.top = '320px';
  el('div', 'sofa-seat', sofa);
  const coffee = el('div', 'coffee-table', floor);
  coffee.style.left = '97px';
  coffee.style.top = '379px';
  // Round white meeting table + chairs, bottom-right.
  const table = el('div', 'round-table-wrap', floor);
  table.style.left = '495px';
  table.style.top = '280px';
  el('div', 'round-table-base', table);
  el('div', 'round-table', table);
  const chairs = [[627, 340], [591, 402], [519, 402], [483, 340], [519, 278], [591, 278]];
  for (const [x, y] of chairs) {
    const c = el('div', 'round-chair', floor);
    c.style.left = (x - 9) + 'px';
    c.style.top = (y - 7) + 'px';
  }
  // Small green plants: two against the back wall, one at the front.
  for (const [x, y] of [[30, 18], [612, 18], [320, 408]]) {
    const p = el('div', 'plant', floor);
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    el('div', 'plant-pot', p);
    el('div', 'plant-top', p);
  }
}

function buildScene(listings, reviewsById) {
  const lay = layout(listings);
  const chart = chartData(listings);
  const scene = el('div', 'scene3d');
  const floor = el('div', 'iso-floor', scene);
  floor.style.height = lay.floorH + 'px';
  floor.style.marginTop = (-lay.floorH / 2) + 'px';
  const wall = el('div', 'iso-wall', floor);
  wall.appendChild(buildWallScreen(chart));
  const clock = el('div', 'wall-clock', wall);
  clock.setAttribute('aria-hidden', 'true');
  el('div', 'clock-hand hour', clock);
  el('div', 'clock-hand minute', clock);
  lay.blocks.forEach((b, i) => {
    floor.appendChild(buildBlock(b, i,
      reviewsById ? studentLabel(reviewsById[b.listing.id]) : null));
  });
  buildDressing(floor);
  return scene;
}

function renderEmpty(inner, title, sub, action) {
  inner.textContent = '';
  const box = el('div', 'scene-empty', inner);
  el('h3', null, box, title);
  el('p', null, box, sub);
  // Default action is the Manager portal link: only approved managers
  // add hostels. A caller may pass a button action instead (Phase 3:
  // the quick-filter empty state offers "Show all").
  if (action && typeof action.onClick === 'function') {
    const b = el('button', 'pill pill-dark', box, action.text);
    b.type = 'button';
    b.addEventListener('click', action.onClick);
    return;
  }
  const a = el('a', 'pill pill-dark', box, 'List your hostel — Manager portal');
  a.href = '/manager';
}

async function loadScene() {
  if (typeof document === 'undefined') return;
  const inner = document.getElementById('sceneInner');
  if (!inner) return;
  let data;
  try {
    const r = await fetch('/api/listings');
    if (!r.ok) throw new Error('listings HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    renderEmpty(inner, 'The hostel map could not be loaded',
      'The listing list below still works — try reloading the page.');
    return;
  }
  const listed = sceneListings(data && data.listings);
  if (!listed.length) {
    renderEmpty(inner, 'No hostels listed yet',
      'No VERIFIED or LISTED hostels are on the map yet. Approved managers add hostels from the Manager portal.');
    return;
  }
  // Phase 3 quick filter (Ask Hostel AI chips): the same filter the list
  // uses, applied here so the map shows what the list shows. A filter
  // that matches nothing is an honest empty state, not "no hostels".
  const qf = (typeof getQuickFilter === 'function') ? getQuickFilter() : null;
  const shown = (qf && typeof applyQuickFilter === 'function') ? applyQuickFilter(listed, qf) : listed;
  if (!shown.length) {
    renderEmpty(inner, 'No hostels match this filter',
      'Use “Show all” in the Ask Hostel AI panel to see every hostel again.',
      { text: 'Show all hostels', onClick: () => { if (typeof setQuickFilter === 'function') setQuickFilter(null); } });
    return;
  }
  // Approved-review names per hostel, best-effort: a failed fetch just
  // means that hostel's figure gets no name label.
  const reviewsById = {};
  await Promise.all(shown.map(async l => {
    try {
      const r = await fetch('/api/listings/' + l.id + '/reviews');
      if (r.ok) reviewsById[l.id] = (await r.json()).reviews || [];
    } catch { /* no label for this hostel */ }
  }));
  inner.textContent = '';
  inner.appendChild(buildScene(shown, reviewsById));
  const section = document.querySelector('.scene');
  if (section) section.style.minHeight = sceneMinHeight(layout(shown).floorH) + 'px';
}

const Scene = {
  sceneListings, detailUrl, monthlyRent, rentLabel, chartData, barHeight,
  studentLabel, layout, sceneMinHeight, buildScene, loadScene, renderEmpty,
};
if (typeof window !== 'undefined') window.Scene = Scene;
if (typeof module !== 'undefined' && module.exports) module.exports = Scene;
// ---- END SCENE ----

// --- Phase 2: the 3D scene (above) is the map on the home page.
Scene.loadScene();

// ---- BEGIN STATS (Phase 3: stat cards + Ask Hostel AI panel) ----
// The stat cards and the panel live in app.js (not a separate file)
// because server.js serves static files from a fixed per-file list and
// this phase does not change server.js. Tests extract this section by
// the markers and evaluate it standalone in Node (see test.js §17).
'use strict';
// Phase 3 — real numbers on the home page, and a panel of honest
// shortcuts. Every number is computed from live /api/listings data
// (plus the public approved-reviews endpoints) — nothing is hardcoded
// and nothing is invented. The panel mirrors the reel's Neon panel
// (slides in from the right, header + close button, quick chips at the
// bottom) but holds only shortcuts that do real things: there is no
// chat behind it, no input that pretends to answer, and the panel says
// so in plain words. The chips set the same quick-filter state the
// listing search already uses (see search() above and loadScene() in
// the scene section), so the list and the map always agree.
//
// The pure data functions are exported for Node (test.js extracts this
// section by the markers and evaluates it standalone) as well as
// attached to window for the browser. Nothing in this section touches
// the DOM at definition time.

// ---- State (one quick filter at a time; null = show everything) ----
let quickFilter = null; // null | 'vacant' | 'verified' | 'cheapest'
let myRole = null;
let myRoleChecked = false;

const statFmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');

// ---- Pure data functions (unit-tested in test.js) ----

// Only VERIFIED + LISTED hostels count anywhere on this page — the
// same rule as the scene. EXAMPLE rows are demo-only, never counted.
function statListings(listings) {
  return (Array.isArray(listings) ? listings : [])
    .filter(l => l && (l.status === 'VERIFIED' || l.status === 'LISTED'));
}
// Monthly rent. Semester rows use the same /6 monthly equivalent the
// rest of the app uses (labelled as an estimate wherever it is shown).
function statMonthlyRent(l) {
  if (!l) return 0;
  if (typeof l.monthly_rent_equivalent === 'number') return l.monthly_rent_equivalent;
  return l.price_basis === 'semester' ? Math.round(Number(l.rent_pkr) / 6) : Number(l.rent_pkr) || 0;
}
// Rooms: the sum of room_types seats where a seat number is actually
// stated. A room type with no stated seats contributes 0, and `stated`
// records whether any seat number was stated at all, so the card can
// say so instead of presenting a missing number as zero rooms.
function roomSeatsTotal(listings) {
  let total = 0;
  let stated = false;
  for (const l of statListings(listings)) {
    const types = Array.isArray(l.room_types) ? l.room_types : [];
    for (const t of types) {
      if (t && typeof t.seats === 'number' && Number.isFinite(t.seats)) {
        stated = true;
        if (t.seats > 0) total += t.seats;
      }
    }
  }
  return { total, stated };
}
// The four stat-card numbers, from the same API data the page shows.
// reviewsById maps listing id -> the approved reviews for that hostel
// (the public reviews endpoint only ever returns approved reviews).
function computeStats(listings, reviewsById) {
  const listed = statListings(listings);
  const rooms = roomSeatsTotal(listed);
  let reviews = 0;
  if (reviewsById) {
    for (const l of listed) {
      const rs = reviewsById[l.id];
      if (Array.isArray(rs)) reviews += rs.length;
    }
  }
  let cheapest = null;
  let cheapestSemester = false;
  for (const l of listed) {
    const m = statMonthlyRent(l);
    if (m > 0 && (cheapest === null || m < cheapest)) {
      cheapest = m;
      cheapestSemester = l.price_basis === 'semester';
    }
  }
  return { hostels: listed.length, rooms: rooms.total, roomsStated: rooms.stated,
    reviews, cheapest, cheapestSemester };
}
// One quick filter, applied on top of whatever rows the caller already
// has (the server-filtered list, or the scene's listed hostels). Vacant
// means seats_available is a stated number above zero — a hostel that
// does not state seats is never counted as vacant. Cheapest sorts by
// monthly-equivalent rent ascending, semester rows at rent / 6.
// One rule everywhere (Phase 5): a chip operates on VERIFIED + LISTED
// hostels only — the same population as the scene and the stat cards.
// EXAMPLE rows are demo-only: with "Show EXAMPLE demo listings" ticked
// they still appear in the plain list, but a chip never pulls them into
// its result, so the chip's status line, the list and the scene can
// never disagree about them.
function applyQuickFilter(listings, filter) {
  const rows = Array.isArray(listings) ? listings.slice() : [];
  if (!filter) return rows;
  const listed = rows.filter(l => l && (l.status === 'VERIFIED' || l.status === 'LISTED'));
  if (filter === 'vacant') {
    return listed.filter(l => typeof l.seats_available === 'number' && l.seats_available > 0);
  }
  if (filter === 'verified') return listed.filter(l => l.status === 'VERIFIED');
  if (filter === 'cheapest') {
    return listed.sort((a, b) => statMonthlyRent(a) - statMonthlyRent(b));
  }
  return rows;
}
// What the panel says after a chip acts — plain words, real counts.
function quickFilterStatus(count, filter) {
  const n = Number(count) || 0;
  if (filter === 'vacant') {
    if (n === 0) return 'No hostels state vacant rooms — seats not stated are never counted as vacant.';
    return n === 1 ? 'Showing 1 hostel with vacant rooms.' : 'Showing ' + n + ' hostels with vacant rooms.';
  }
  if (filter === 'verified') {
    if (n === 0) return 'No verified hostels yet.';
    return n === 1 ? 'Showing 1 verified hostel.' : 'Showing ' + n + ' verified hostels.';
  }
  if (filter === 'cheapest') {
    if (n === 0) return 'No hostels to sort yet.';
    return n === 1 ? 'Showing 1 hostel, cheapest first.' : 'Showing ' + n + ' hostels, cheapest first.';
  }
  return 'Showing all hostels.';
}
// Pending reviews: only a logged-in manager has a queue to open.
// Everyone else gets the plain login message — never a fake count or
// a fake list.
function pendingReviewsAction(role) {
  if (role === 'manager') {
    return { action: 'open-queue', url: '/manager#reviews', message: 'Opening the manager review queue…' };
  }
  return { action: 'login-message', url: '/login-manager', message: 'Log in as a manager to see pending reviews.' };
}
function getQuickFilter() { return quickFilter; }

// ---- DOM rendering + actions (browser only) ----

function renderStats(stats) {
  if (typeof document === 'undefined') return;
  const setText = (id, text) => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };
  if (!stats) {
    setText('statHostels', '—');
    setText('statHostelsNote', 'could not load — try reloading');
    setText('statRooms', '—');
    setText('statRoomsNote', 'could not load — try reloading');
    setText('statReviews', '—');
    setText('statReviewsNote', 'could not load — try reloading');
    setText('statCheapest', '—');
    setText('statCheapestNote', 'could not load — try reloading');
    return;
  }
  setText('statHostels', stats.hostels > 0 ? String(stats.hostels) : '—');
  setText('statHostelsNote', stats.hostels > 0 ? 'verified + listed' : 'No hostels listed yet');
  setText('statRooms', String(stats.rooms));
  setText('statRoomsNote', stats.roomsStated ? 'seats stated only' : 'seats stated only — none stated yet');
  setText('statReviews', String(stats.reviews));
  setText('statReviewsNote', 'approved reviews');
  if (stats.cheapest === null || stats.cheapest === undefined) {
    setText('statCheapest', '—');
    setText('statCheapestNote', 'No hostels listed yet');
  } else {
    setText('statCheapest', 'from ' + statFmt(stats.cheapest) + '/month');
    setText('statCheapestNote', stats.cheapestSemester
      ? 'cheapest listed · monthly equivalent (semester ÷ 6)'
      : 'cheapest listed hostel');
  }
}

async function loadStats() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('statHostels')) return;
  let data;
  try {
    const r = await fetch('/api/listings');
    if (!r.ok) throw new Error('listings HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    renderStats(null);
    return;
  }
  const listed = statListings(data && data.listings);
  // Approved-review counts per hostel, best-effort: a failed fetch just
  // means that hostel's reviews stay uncounted.
  const reviewsById = {};
  await Promise.all(listed.map(async l => {
    try {
      const r = await fetch('/api/listings/' + l.id + '/reviews');
      if (r.ok) reviewsById[l.id] = (await r.json()).reviews || [];
    } catch { /* uncounted for this hostel */ }
  }));
  renderStats(computeStats(data.listings, reviewsById));
}

// The caller's role, from /api/auth/me, fetched once at most.
async function getMyRole() {
  if (myRoleChecked) return myRole;
  myRoleChecked = true;
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) {
      const me = await r.json();
      myRole = me.role || null;
    }
  } catch { /* logged out or offline: stays null */ }
  return myRole;
}

// Set the quick filter, re-run the list + the scene under it, and say
// what happened in the panel. The "Show all" reset is setQuickFilter(null).
async function setQuickFilter(filter) {
  quickFilter = filter;
  if (typeof document !== 'undefined') {
    if (filter === 'cheapest') {
      const s = document.getElementById('sort');
      if (s) s.value = 'asc';
    }
    const msg = document.getElementById('aiPendingMsg');
    if (msg) msg.hidden = true;
  }
  if (typeof search === 'function') { try { await search(); } catch {} }
  if (typeof Scene !== 'undefined' && Scene.loadScene) { try { await Scene.loadScene(); } catch {} }
  if (typeof document !== 'undefined') {
    const status = document.getElementById('aiStatus');
    const count = document.querySelectorAll('#results .listing').length;
    if (status) status.textContent = quickFilterStatus(count, filter);
    const showAll = document.getElementById('aiShowAll');
    if (showAll) showAll.hidden = !filter;
  }
}

async function handleChip(name) {
  if (typeof document === 'undefined') return;
  if (name === 'pending') {
    const act = pendingReviewsAction(await getMyRole());
    const status = document.getElementById('aiStatus');
    if (status) status.textContent = act.message;
    if (act.action === 'open-queue') {
      if (typeof window !== 'undefined') window.location.href = act.url;
    } else {
      const msg = document.getElementById('aiPendingMsg');
      if (msg) msg.hidden = false;
    }
    return;
  }
  await setQuickFilter(name);
}

function openAiPanel() {
  if (typeof document === 'undefined') return;
  const p = document.getElementById('aiPanel');
  if (!p) return;
  p.hidden = false;
  const show = () => p.classList.add('is-open');
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(show);
  else show();
  const b = document.getElementById('askAiBtn');
  if (b) b.setAttribute('aria-expanded', 'true');
}
function closeAiPanel() {
  if (typeof document === 'undefined') return;
  const p = document.getElementById('aiPanel');
  if (!p) return;
  p.classList.remove('is-open');
  const b = document.getElementById('askAiBtn');
  if (b) b.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!p.classList.contains('is-open')) p.hidden = true; }, 260);
}

const Stats = {
  statListings, statMonthlyRent, roomSeatsTotal, computeStats,
  applyQuickFilter, quickFilterStatus, pendingReviewsAction,
  getQuickFilter, setQuickFilter, handleChip, getMyRole,
  renderStats, loadStats, openAiPanel, closeAiPanel,
};
if (typeof window !== 'undefined') window.Stats = Stats;
if (typeof module !== 'undefined' && module.exports) module.exports = Stats;
// ---- END STATS ----

// --- Phase 3: wire the Ask Hostel AI panel (browser only) and load the
// stat cards. Guarded so the extracted STATS section above stays
// DOM-free at definition time.
if (typeof document !== 'undefined') {
  const askBtn = document.getElementById('askAiBtn');
  if (askBtn) askBtn.addEventListener('click', () => {
    const p = document.getElementById('aiPanel');
    if (p && p.hidden) openAiPanel();
    else closeAiPanel();
  });
  const closeBtn = document.getElementById('aiClose');
  if (closeBtn) closeBtn.addEventListener('click', closeAiPanel);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeAiPanel(); });
  document.querySelectorAll('#aiPanel [data-chip]').forEach(b =>
    b.addEventListener('click', () => handleChip(b.getAttribute('data-chip'))));
  const showAllBtn = document.getElementById('aiShowAll');
  if (showAllBtn) showAllBtn.addEventListener('click', () => setQuickFilter(null));
  loadStats();
}

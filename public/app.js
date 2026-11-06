'use strict';
let META = null;
const $ = id => document.getElementById(id);
const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');
// Escape every user-derived string before it goes into innerHTML.
// Listing names/sources, reference rows and history fields all come from
// user or community input and must never be inserted as raw HTML.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadMeta() {
  META = await (await fetch('/api/meta')).json();
  for (const c of META.cities) {
    $('city').insertAdjacentHTML('beforeend', `<option>${escapeHtml(c)}</option>`);
    $('subCity').insertAdjacentHTML('beforeend', `<option>${escapeHtml(c)}</option>`);
  }
  $('facChecks').innerHTML = META.facilities.map(f =>
    `<label class="chk"><input type="checkbox" name="fac" value="${escapeHtml(f)}"> ${escapeHtml(f)}</label>`).join(' ');
  fillAreas($('city').value, $('area'));
  fillAreas($('subCity').value, $('subArea'));
}
function fillAreas(city, sel) {
  const areas = city ? META.areas[city] : Object.values(META.areas).flat();
  sel.innerHTML = '<option value="">All areas</option>' +
    areas.map(a => `<option>${escapeHtml(a)}</option>`).join('');
}
$('city').addEventListener('change', () => fillAreas($('city').value, $('area')));
$('subCity').addEventListener('change', () => fillAreas($('subCity').value, $('subArea')));

function badge(l) {
  if (l.status === 'VERIFIED') return `<span class="b v">✓ VERIFIED${l.last_verified ? ' · ' + escapeHtml(l.last_verified) : ''}</span>`;
  if (l.status === 'EXAMPLE') return '<span class="b e">EXAMPLE — demo only</span>';
  return '<span class="b l">LISTED — unverified community claim</span>';
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
  <p><a href="/hostel?id=${l.id}">Full details &amp; reviews</a> · <a href="/hostel?id=${l.id}">Write a review</a> · <a href="#" data-detail="${l.id}">Price history &amp; details</a> · <label class="chk"><input type="checkbox" class="cmp" value="${l.id}"> Compare</label></p>
  <div id="det-${l.id}"></div></article>`;
}

async function search() {
  const q = new URLSearchParams();
  for (const [k, el] of [['city', $('city')], ['area', $('area')], ['type', $('type')], ['room', $('room')], ['mess', $('mess')], ['sort', $('sort')]])
    if (el.value) q.set(k, el.value);
  if ($('maxRent').value) q.set('max_rent', $('maxRent').value);
  if ($('showExamples').checked) q.set('show_examples', '1');
  const d = await (await fetch('/api/listings?' + q)).json();
  $('counts').textContent = `${d.counts.total} listings (${d.counts.verified} verified, ${d.counts.listed} listed — examples never counted)`;
  $('results').innerHTML = d.listings.length ? d.listings.map(card).join('') : '<p>No hostels match — try widening the filters.</p>';
  $('calcListing').innerHTML = d.listings.map(l => `<option value="${l.id}">${escapeHtml(l.name)} — ${fmt(l.rent_pkr)}</option>`).join('');
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
  if (!$('calcListing').value) return;
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

$('submitForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const body = Object.fromEntries(f.entries());
  body.mess_included = f.has('mess_included');
  body.facilities = f.getAll('fac');
  const r = await fetch('/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  $('submitOut').textContent = r.ok ? `Submitted as LISTED (unverified), id ${d.id}. It will show as a community claim until an admin verifies it.`
    : 'Error: ' + (d.error || 'could not submit');
  if (r.ok) { ev.target.reset(); search(); }
});

async function loadRefs() {
  const d = await (await fetch('/api/reference')).json();
  $('refs').innerHTML = '<ul>' + d.references.map(r =>
    `<li><b>${escapeHtml(r.scope)}:</b> ${escapeHtml(r.figure)} — <i>${escapeHtml(r.source)}</i> (${escapeHtml(r.date_label)})${r.note ? ' — ' + escapeHtml(r.note) : ''}</li>`).join('') + '</ul>';
}
loadMeta().then(() => { search(); loadRefs(); });

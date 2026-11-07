'use strict';
// Manager portal: "My hostels" list + create/edit form with every fee field
// (each charge has a "Not available" choice) and every amenity with
// included / charged / not_available, plus a photo uploader per hostel
// (Phase 3: JPG/PNG/WebP, 5 MB, 8 per hostel, approved on upload).
let META = null;
let editingId = null;
const $ = id => document.getElementById(id);
const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FEE_LABELS = { security_deposit_pkr: 'Security deposit', advance_pkr: 'Advance',
  admission_fee_pkr: 'Admission fee', wifi_pkr: 'WiFi', laundry_pkr: 'Laundry',
  ac_pkr: 'AC', electricity_pkr: 'Electricity' };

function fillAreas(city) {
  const areas = city ? META.areas[city] : Object.values(META.areas).flat();
  $('fArea').innerHTML = areas.map(a => `<option>${escapeHtml(a)}</option>`).join('');
}

function buildForm() {
  for (const c of META.cities) $('fCity').insertAdjacentHTML('beforeend', `<option>${escapeHtml(c)}</option>`);
  $('fRental').innerHTML = '<option value="">Not stated</option>' +
    META.rental_periods.map(r => `<option value="${r}">${escapeHtml(META.rental_period_labels[r] || r)}</option>`).join('');
  $('facChecks').innerHTML = META.facilities.map(f =>
    `<label class="chk"><input type="checkbox" name="fac" value="${escapeHtml(f)}"> ${escapeHtml(f)}</label>`).join(' ');
  // Each fee: a "Not available" / "Set amount" choice + a number input.
  $('feeFields').innerHTML = META.fee_fields.map(f =>
    `<label>${escapeHtml(FEE_LABELS[f] || f)} (PKR)
      <select data-fee="${f}"><option value="na">Not available</option><option value="set">Set amount</option></select>
      <input data-fee-amt="${f}" type="number" min="0" disabled></label>`).join('');
  document.querySelectorAll('[data-fee]').forEach(sel => sel.addEventListener('change', () => {
    const inp = document.querySelector(`[data-fee-amt="${sel.dataset.fee}"]`);
    inp.disabled = sel.value !== 'set';
    if (sel.value !== 'set') inp.value = '';
  }));
  // Other charges: 3 label + amount rows.
  $('otherCharges').innerHTML = [0, 1, 2].map(i =>
    `<label>Charge ${i + 1} <input data-oc-label="${i}" placeholder="e.g. Generator"><input data-oc-amt="${i}" type="number" min="0" placeholder="Amount (PKR)"></label>`).join('');
  // Room types: one row per room type (rent empty = not offered).
  $('roomTypes').innerHTML = META.rooms.map(room =>
    `<label>${escapeHtml(room)} room — rent (PKR)
      <input data-rt-rent="${room}" type="number" min="0" placeholder="Leave empty if not offered">
      Seats <input data-rt-seats="${room}" type="number" min="0">
      Mess price (PKR) <input data-rt-mess="${room}" type="number" min="0">
      <span class="chk"><input data-rt-messinc="${room}" type="checkbox"> Mess included</span></label>`).join('');
  // Amenities: tri-state select + price (only when charged).
  $('amenityFields').innerHTML = META.amenities.map(a =>
    `<label>${escapeHtml(META.amenity_labels[a] || a)}
      <select data-am="${a}"><option value="not_available">Not available</option><option value="included">Included</option><option value="charged">Charged extra</option></select>
      <input data-am-price="${a}" type="number" min="0" placeholder="Price (PKR) if charged" disabled></label>`).join('');
  document.querySelectorAll('[data-am]').forEach(sel => sel.addEventListener('change', () => {
    const inp = document.querySelector(`[data-am-price="${sel.dataset.am}"]`);
    inp.disabled = sel.value !== 'charged';
    if (sel.value !== 'charged') inp.value = '';
  }));
  fillAreas($('fCity').value);
  $('fCity').addEventListener('change', () => fillAreas($('fCity').value));
}

async function loadMy() {
  const d = await (await fetch('/api/manager/listings')).json();
  const list = d.listings || [];
  $('myCount').textContent = list.length ? `${list.length} hostel${list.length === 1 ? '' : 's'} under your account.` : 'No hostels yet — add your first one below.';
  $('myList').innerHTML = list.map(l => `<article class="listing"><h3>${escapeHtml(l.name)} — ${escapeHtml(l.status)}${l.hidden ? ' (HIDDEN)' : ''}</h3>
  <p>${escapeHtml(l.city)} · ${escapeHtml(l.area)} · ${escapeHtml(l.type)} · ${escapeHtml(l.room)} · <b>${fmt(l.rent_pkr)}</b> ${l.price_basis === 'semester' ? 'per semester' : 'per month'}</p>
  <p>${escapeHtml(l.contact_phone || 'No public phone set yet')}</p>
  <button data-edit="${l.id}">Edit</button>
  <div data-photos="${l.id}"><p>Loading photos…</p></div></article>`).join('');
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const l = list.find(x => x.id === Number(b.dataset.edit));
    if (l) openForm(l);
  }));
  list.forEach(l => loadPhotos(l.id));
}

// Photos for one hostel: thumbnails + delete, and the upload form.
// The honest storage note lives here, next to the uploader.
async function loadPhotos(listingId) {
  const box = document.querySelector(`[data-photos="${listingId}"]`);
  if (!box) return;
  const d = await (await fetch('/api/manager/photos?listing_id=' + listingId)).json();
  const photos = d.photos || [];
  box.innerHTML = `<h4>Photos (${photos.length}/8)</h4>
  <p>Photos are stored on this server and are lost if the site is redeployed — keep your originals.</p>
  <div>${photos.map(ph => `<figure><img src="${escapeHtml(ph.url)}" alt="${escapeHtml(ph.caption || ph.kind)}" style="max-width:160px">
  <figcaption>${escapeHtml(ph.kind)}${ph.caption ? ' — ' + escapeHtml(ph.caption) : ''} (${escapeHtml(ph.status)})</figcaption>
  <button data-del-photo="${ph.id}">Delete</button></figure>`).join('') || '<p>No photos yet.</p>'}</div>
  <form data-upload="${listingId}">
    <label>Photo <input type="file" name="photo" accept=".jpg,.jpeg,.png,.webp" required></label>
    <label>Kind <select name="kind"><option value="hostel">Hostel</option><option value="location">Location</option><option value="room">Room</option><option value="mess">Mess</option></select></label>
    <label>Caption (max 120 characters) <input name="caption" maxlength="120" placeholder="e.g. Front gate"></label>
    <button>Upload photo</button>
  </form><p data-upload-msg="${listingId}"></p>`;
  box.querySelectorAll('[data-del-photo]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this photo? The file is removed too.')) return;
    const rr = await fetch('/api/manager/photos/' + b.dataset.delPhoto + '/delete', { method: 'POST' });
    const dd = await rr.json();
    if (!rr.ok) { alert('Error: ' + (dd.error || 'could not delete')); return; }
    loadPhotos(listingId);
  }));
  const form = box.querySelector('[data-upload]');
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = box.querySelector(`[data-upload-msg="${listingId}"]`);
    const fd = new FormData(form);
    fd.append('listing_id', String(listingId));
    const rr = await fetch('/api/manager/photos', { method: 'POST', body: fd });
    const dd = await rr.json();
    if (!rr.ok) { msg.textContent = 'Error: ' + (dd.error || 'could not upload'); return; }
    msg.textContent = 'Photo uploaded — it shows on your listing now.';
    form.reset();
    loadPhotos(listingId);
  });
}

// Reviews queue (Phase 4): pending first, approve/reject with the fixed
// reason list + optional note, public reply box. Every user string escaped.
const REJECT_REASONS = ['spam', 'abusive language', 'personal data', 'off-topic', 'fake or staged'];
async function loadReviews() {
  const box = $('reviewsList');
  if (!box) return;
  const d = await (await fetch('/api/manager/reviews')).json();
  const reviews = d.reviews || [];
  $('reviewsMsg').textContent = reviews.length ? reviews.length + ' review(s) on your hostels (pending first).' : 'No reviews on your hostels yet.';
  box.innerHTML = reviews.map(r => `<article class="listing"><h3>${escapeHtml(r.title || 'Review')} — ${r.rating} ★ · ${escapeHtml(r.status)}</h3>
  <p>Hostel: ${escapeHtml(r.listing_name || '')} · By ${escapeHtml(r.reviewer_name)} · ${escapeHtml(r.created_at || '')}</p>
  <p>${escapeHtml(r.body)}</p>
  ${(r.photos || []).map(p => `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || 'Review photo')}" style="max-width:120px">`).join('')}
  ${r.decide_reason ? `<p>Decision reason: ${escapeHtml(r.decide_reason)}</p>` : ''}
  ${r.manager_reply ? `<p><b>Your reply:</b> ${escapeHtml(r.manager_reply)}</p>` : ''}
  ${r.status === 'pending' ? `<label>Reject reason <select data-reason="${r.id}"><option value="">— choose a reason —</option>${REJECT_REASONS.map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select></label>
  <label>Note (optional) <input data-note="${r.id}" maxlength="500" placeholder="Optional note for the master"></label>
  <button data-approve-review="${r.id}">Approve</button>
  <button data-reject-review="${r.id}">Reject</button>` : ''}
  <label>Public reply (max 1000 characters) <textarea data-reply="${r.id}" rows="2" maxlength="1000">${escapeHtml(r.manager_reply || '')}</textarea></label>
  <button data-reply-review="${r.id}">Save reply</button></article>`).join('');
  box.querySelectorAll('[data-approve-review]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/manager/reviews/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: Number(b.dataset.approveReview), decision: 'approve' }) });
    const dd = await r.json();
    $('reviewsMsg').textContent = r.ok ? 'Review approved — it is public now.' : 'Error: ' + (dd.error || 'could not approve');
    if (r.ok) loadReviews();
  }));
  box.querySelectorAll('[data-reject-review]').forEach(b => b.addEventListener('click', async () => {
    const id = Number(b.dataset.rejectReview);
    const reason = document.querySelector(`[data-reason="${id}"]`).value;
    const note = document.querySelector(`[data-note="${id}"]`).value;
    if (!reason) { $('reviewsMsg').textContent = 'Pick a reject reason from the list first.'; return; }
    const r = await fetch('/api/manager/reviews/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: id, decision: 'reject', reason, note }) });
    const dd = await r.json();
    $('reviewsMsg').textContent = r.ok ? 'Review rejected — it stays in the database with the reason; the master can overturn it.' : 'Error: ' + (dd.error || 'could not reject');
    if (r.ok) loadReviews();
  }));
  box.querySelectorAll('[data-reply-review]').forEach(b => b.addEventListener('click', async () => {
    const id = Number(b.dataset.replyReview);
    const reply = document.querySelector(`[data-reply="${id}"]`).value;
    const r = await fetch('/api/manager/reviews/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: id, reply }) });
    const dd = await r.json();
    $('reviewsMsg').textContent = r.ok ? 'Reply saved — it shows under the review.' : 'Error: ' + (dd.error || 'could not save reply');
    if (r.ok) loadReviews();
  }));
}
$('loadReviewsBtn').addEventListener('click', loadReviews);

function setFee(f, value) {
  const sel = document.querySelector(`[data-fee="${f}"]`);
  const inp = document.querySelector(`[data-fee-amt="${f}"]`);
  if (value === null || value === undefined || value === 'Not available') { sel.value = 'na'; inp.value = ''; inp.disabled = true; }
  else { sel.value = 'set'; inp.value = value; inp.disabled = false; }
}
function setAmenity(a, val) {
  const sel = document.querySelector(`[data-am="${a}"]`);
  const inp = document.querySelector(`[data-am-price="${a}"]`);
  const state = val ? val.state : 'not_available';
  sel.value = state;
  inp.disabled = state !== 'charged';
  inp.value = state === 'charged' && val && val.price !== null && val.price !== undefined ? val.price : '';
}

function openForm(l) {
  editingId = l ? l.id : null;
  $('formTitle').textContent = l ? 'Edit: ' + l.name : 'Add a hostel';
  $('hideBtn').hidden = !l;
  $('formCard').hidden = false;
  $('formMsg').textContent = '';
  const f = $('hostelForm');
  f.reset();
  // Reset dynamic controls to their defaults first.
  META.fee_fields.forEach(x => setFee(x, null));
  META.amenities.forEach(a => setAmenity(a, null));
  if (!l) { fillAreas($('fCity').value); window.scrollTo(0, $('formCard').offsetTop); return; }
  const set = (name, v) => { if (f.elements[name] && v !== null && v !== undefined) f.elements[name].value = v; };
  set('name', l.name); set('city', l.city); fillAreas(l.city); set('area', l.area);
  set('near_university', l.near_university); set('type', l.type); set('room', l.room);
  set('rent_pkr', l.rent_pkr); set('price_basis', l.price_basis);
  f.elements['mess_included'].checked = !!l.mess_included;
  set('mess_pkr', l.mess_pkr); set('meals_per_day', l.meals_per_day);
  set('source', l.source);
  document.querySelectorAll('[name="fac"]').forEach(c => { c.checked = (l.facilities || []).includes(c.value); });
  set('contact_gmail', l.contact_gmail); set('contact_phone', l.contact_phone); set('whatsapp', l.whatsapp);
  set('address', l.address); set('maps_url', l.maps_url); set('maps_lat', l.maps_lat); set('maps_lng', l.maps_lng);
  set('plus_code', l.plus_code); set('distance_text', l.distance_text);
  META.fee_fields.forEach(x => setFee(x, l[x]));
  (l.other_charges || []).slice(0, 3).forEach((oc, i) => {
    document.querySelector(`[data-oc-label="${i}"]`).value = oc.label || '';
    document.querySelector(`[data-oc-amt="${i}"]`).value = oc.amount_pkr ?? '';
  });
  (l.room_types || []).forEach(rt => {
    const rent = document.querySelector(`[data-rt-rent="${rt.room}"]`);
    if (!rent) return;
    rent.value = rt.rent_pkr ?? '';
    document.querySelector(`[data-rt-seats="${rt.room}"]`).value = rt.seats ?? '';
    document.querySelector(`[data-rt-mess="${rt.room}"]`).value = rt.mess_pkr ?? '';
    document.querySelector(`[data-rt-messinc="${rt.room}"]`).checked = !!rt.mess_included;
  });
  META.amenities.forEach(a => setAmenity(a, (l.amenities || {})[a]));
  set('rules', l.rules); set('gate_open', l.gate_open); set('gate_close', l.gate_close);
  set('visit_hours', l.visit_hours); set('rental_period', l.rental_period || '');
  set('available_from', l.available_from); set('available_until', l.available_until);
  set('min_stay', l.min_stay); set('deposit_refund_note', l.deposit_refund_note);
  set('season_note', l.season_note); set('seats_total', l.seats_total); set('seats_available', l.seats_available);
  set('mess_status', l.mess_status || ''); set('mess_menu', l.mess_menu);
  window.scrollTo(0, $('formCard').offsetTop);
}

function collectBody() {
  const f = $('hostelForm');
  const fd = new FormData(f);
  const body = {};
  const text = name => { const v = fd.get(name); if (v !== null && v !== undefined && String(v).trim() !== '') body[name] = String(v).trim(); };
  const num = name => { const v = fd.get(name); if (v !== null && v !== undefined && String(v).trim() !== '') body[name] = Number(v); };
  const optText = name => { body[name] = String(fd.get(name) || ''); };
  text('name'); text('city'); text('area'); text('near_university'); text('type'); text('room');
  num('rent_pkr'); text('price_basis');
  body.mess_included = f.elements['mess_included'].checked;
  num('mess_pkr'); num('meals_per_day');
  body.facilities = fd.getAll('fac');
  text('source');
  optText('contact_gmail'); optText('contact_phone'); optText('whatsapp');
  optText('address'); optText('maps_url');
  num('maps_lat'); num('maps_lng');
  optText('plus_code'); optText('distance_text');
  META.fee_fields.forEach(x => {
    const sel = document.querySelector(`[data-fee="${x}"]`);
    const inp = document.querySelector(`[data-fee-amt="${x}"]`);
    body[x] = sel.value === 'set' && inp.value !== '' ? Number(inp.value) : null;
  });
  body.other_charges = [0, 1, 2].map(i => ({
    label: document.querySelector(`[data-oc-label="${i}"]`).value.trim(),
    amount_pkr: Number(document.querySelector(`[data-oc-amt="${i}"]`).value || 0),
  })).filter(oc => oc.label !== '');
  body.room_types = META.rooms.map(room => {
    const rent = document.querySelector(`[data-rt-rent="${room}"]`).value;
    if (rent === '') return null;
    const seats = document.querySelector(`[data-rt-seats="${room}"]`).value;
    const mess = document.querySelector(`[data-rt-mess="${room}"]`).value;
    return { room, rent_pkr: Number(rent), seats: seats === '' ? null : Number(seats),
      mess_included: document.querySelector(`[data-rt-messinc="${room}"]`).checked,
      mess_pkr: mess === '' ? null : Number(mess) };
  }).filter(Boolean);
  body.amenities = {};
  META.amenities.forEach(a => {
    const sel = document.querySelector(`[data-am="${a}"]`);
    const inp = document.querySelector(`[data-am-price="${a}"]`);
    body.amenities[a] = { state: sel.value, price: sel.value === 'charged' && inp.value !== '' ? Number(inp.value) : null };
  });
  optText('rules'); optText('gate_open'); optText('gate_close'); optText('visit_hours');
  optText('rental_period'); optText('available_from'); optText('available_until');
  optText('min_stay'); optText('deposit_refund_note'); optText('season_note');
  num('seats_total'); num('seats_available');
  optText('mess_status'); optText('mess_menu');
  return body;
}

$('hostelForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const body = collectBody();
  const url = editingId ? '/api/manager/listings/' + editingId : '/api/manager/listings';
  const r = await fetch(url, { method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { $('formMsg').textContent = 'Error: ' + (d.error || 'could not save'); return; }
  $('formMsg').textContent = editingId ? 'Saved. Your listing stays at its current status — edits never verify it.' : 'Saved as LISTED (unverified).';
  $('formCard').hidden = true;
  loadMy();
});
$('newBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', () => { $('formCard').hidden = true; });
$('hideBtn').addEventListener('click', async () => {
  if (!editingId || !confirm('Hide this listing from public search? The master can restore it.')) return;
  const r = await fetch('/api/manager/listings/' + editingId + '/delete', { method: 'POST' });
  const d = await r.json();
  $('formMsg').textContent = r.ok ? 'Hidden.' : 'Error: ' + (d.error || 'could not hide');
  $('formCard').hidden = true;
  loadMy();
});
$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login-manager';
});
// Change password (POST /api/auth/change-password): the endpoint used
// to have no UI anywhere, so nobody could reach it. The server rotates
// the session — this browser stays logged in on a fresh cookie, every
// other browser/device is signed out at once.
$('pwForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const r = await fetch('/api/auth/change-password', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: fd.get('old_password'), new_password: fd.get('new_password') }) });
  const d = await r.json().catch(() => ({}));
  $('pwMsg').textContent = r.ok ? 'Password changed — every other browser and device is signed out.' : 'Error: ' + (d.error || 'could not change password');
  if (r.ok) ev.target.reset();
});

async function init() {
  META = await (await fetch('/api/meta')).json();
  buildForm();
  const me = await fetch('/api/auth/me');
  if (!me.ok) {
    $('accountStatus').textContent = 'You are not logged in.';
    $('notLoggedIn').hidden = false;
    return;
  }
  const u = await me.json();
  if (u.role !== 'manager') {
    $('accountStatus').textContent = `You are logged in as ${u.display_name} (${u.role}). This portal is for managers — students use the student login page.`;
    return;
  }
  const statusText = u.status === 'pending' ? 'Waiting for master approval'
    : u.status === 'active' ? 'Approved'
    : u.status === 'suspended' ? 'Suspended — contact the site admin'
    : 'status: ' + u.status;
  $('accountStatus').textContent = `Logged in as ${u.display_name} — Manager · ${statusText}.`;
  $('logoutBtn').hidden = false;
  $('pwForm').hidden = false;
  $('portal').hidden = false;
  loadMy();
  loadReviews();
}
init();

// ---- Phase 4 shell: topnav avatar + bell + log-out (same shell as home). ----
// Logged out: the avatar keeps its "Log in" defaults and the log-out
// button stays hidden. Logged in: name + role, avatar links to the
// manager portal for managers, and the log-out button appears.
function roleLabel(role) {
  return role === 'manager' ? 'Manager' : role === 'student' ? 'Student' : role;
}
async function loadShellUser() {
  let me;
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) return;
    me = await r.json();
  } catch { return; }
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('avatarInitial', (me.display_name || '?').trim().charAt(0).toUpperCase() || '?');
  setText('avatarName', me.display_name || roleLabel(me.role));
  setText('avatarRole', roleLabel(me.role));
  const link = document.getElementById('avatarLink');
  if (link) link.href = me.role === 'manager' ? '/manager' : '/';
  const out = document.getElementById('navLogoutBtn');
  if (out) out.hidden = false;
}
const bellBtn = document.getElementById('bellBtn');
if (bellBtn) bellBtn.addEventListener('click', () => {
  const pop = document.getElementById('bellPop');
  const open = pop.hidden;
  pop.hidden = !open;
  bellBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', ev => {
  const pop = document.getElementById('bellPop');
  if (pop && !pop.hidden && !ev.target.closest('.bell-wrap')) {
    pop.hidden = true;
    if (bellBtn) bellBtn.setAttribute('aria-expanded', 'false');
  }
});
const navLogoutBtn = document.getElementById('navLogoutBtn');
if (navLogoutBtn) navLogoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});
loadShellUser();

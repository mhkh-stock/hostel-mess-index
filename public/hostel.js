'use strict';
// Hostel detail page: full fee breakdown (every charge or "Not available"),
// map embed + "Open in Google Maps" link, photo gallery, rental period +
// availability, rules + timings, approved reviews + manager replies,
// "Write a review" (login first), price history. Every user string is
// escaped on render — review text, replies, titles, captions.
const $ = id => document.getElementById(id);
const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABELS = { security_deposit_pkr: 'Security deposit', advance_pkr: 'Advance',
  admission_fee_pkr: 'Admission fee', wifi_pkr: 'WiFi', laundry_pkr: 'Laundry',
  ac_pkr: 'AC', electricity_pkr: 'Electricity' };
// Human labels for the amenity keys / states the API returns — the
// detail page used to show raw keys ("security_guard: not_available").
const AMENITY_LABELS = { wifi: 'WiFi', mess: 'Mess', laundry: 'Laundry', ac: 'AC',
  generator: 'Generator / UPS', geyser: 'Geyser', parking: 'Parking', cctv: 'CCTV',
  security_guard: 'Security guard', attached_bath: 'Attached bath', fridge: 'Fridge',
  tv_lounge: 'TV lounge', library: 'Library', mineral_water: 'Mineral water',
  daily_cleaning: 'Daily cleaning', kitchen_access: 'Kitchen access', gym: 'Gym' };
const AMENITY_STATE_LABELS = { included: 'Included', charged: 'Charged extra', not_available: 'Not available' };
const MESS_STATUS_LABELS = { active: 'Active', not_available: 'Not available', seasonal: 'Seasonal' };
const id = new URLSearchParams(location.search).get('id');

function feeLine(l, f) {
  const v = l.fees ? l.fees[f] : null;
  return `<li>${escapeHtml(LABELS[f] || f)}: ${v === 'Not available' ? 'Not available' : fmt(v)}</li>`;
}
function openMapsUrl(l) {
  if (l.maps_url) return l.maps_url;
  const q = l.address || (l.name + ' ' + l.city);
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

async function load() {
  if (!id) { $('detail').innerHTML = '<p>No hostel selected. <a href="/">Back to search</a></p>'; return; }
  const d = await (await fetch('/api/listings/' + id)).json();
  if (!d.listing) { $('detail').innerHTML = '<p>Hostel not found.</p>'; return; }
  const l = d.listing;
  const s = d.review_summary || { average_rating: null, review_count: 0, unpublished_review_count: 0 };
  const gallery = (d.photos || []).filter(p => p.kind !== 'review');
  const basis = l.price_basis === 'semester' ? 'per semester' : 'per month';
  const amenities = Object.entries(l.amenities || {}).map(([k, v]) =>
    `<li>${escapeHtml(AMENITY_LABELS[k] || k)}: ${escapeHtml(AMENITY_STATE_LABELS[v.state] || v.state)}${v.state === 'charged' && v.price !== null && v.price !== undefined ? ' — ' + fmt(v.price) : ''}</li>`).join('');
  $('detail').innerHTML = `<article class="listing"><h2>${escapeHtml(l.name)}</h2>
  <p>${escapeHtml(l.city)} · ${escapeHtml(l.area)}${l.near_university ? ' · near ' + escapeHtml(l.near_university) : ''}</p>
  <p>${escapeHtml(l.type)} · ${escapeHtml(l.room)} room · <b>${fmt(l.rent_pkr)} ${basis}</b>${l.price_basis === 'semester' ? ` (≈ ${fmt(l.monthly_rent_equivalent)}/month)` : ''}</p>
  <p>Status: ${escapeHtml(l.status)}${l.last_verified ? ' · verified ' + escapeHtml(l.last_verified) : ''}</p>
  ${l.manager_suspended ? '<p><b>Manager suspended — contact the site admin.</b> This listing stays visible so students can still see the information, but the manager cannot edit it until reinstated.</p>' : ''}
  <h3>Fees — every charge, or “Not available”</h3>
  <ul>${Object.keys(LABELS).map(f => feeLine(l, f)).join('')}
  ${(l.other_charges || []).map(oc => `<li>${escapeHtml(oc.label)}: ${fmt(oc.amount_pkr)}</li>`).join('')}</ul>
  <h3>Room types</h3>
  <p>${(l.room_types || []).length ? (l.room_types || []).map(rt =>
    `${escapeHtml(rt.room)}: ${fmt(rt.rent_pkr)}${rt.seats ? ' · ' + rt.seats + ' seats' : ''}${rt.mess_included ? ' · mess included' : (rt.mess_pkr ? ' · mess ' + fmt(rt.mess_pkr) : '')}`).join('<br>') : 'Not stated'}</p>
  <h3>Amenities</h3><ul>${amenities || '<li>Not stated</li>'}</ul>
  <h3>Contact</h3>
  <p>${escapeHtml(l.contact_phone || 'No public phone set yet')}${l.contact_gmail ? ' · ' + escapeHtml(l.contact_gmail) : ''}${l.whatsapp_url ? ` · <a href="${escapeHtml(l.whatsapp_url)}">WhatsApp</a>` : ''}</p>
  <h3>Location</h3>
  <p>${escapeHtml(l.address || 'Address not stated')}${l.plus_code ? ' · Plus Code ' + escapeHtml(l.plus_code) : ''}${l.distance_text ? ' · ' + escapeHtml(l.distance_text) + ' (as stated by the hostel)' : ''}</p>
  ${l.maps_embed_url ? `<iframe src="${escapeHtml(l.maps_embed_url)}" width="100%" height="300" style="border:0" loading="lazy"></iframe>` : '<p>No map yet.</p>'}
  <p><a href="${escapeHtml(openMapsUrl(l))}" target="_blank" rel="noopener">Open in Google Maps</a></p>
  <h3>Photos</h3>
  <div>${gallery.length ? gallery.map(p => `<figure><img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || p.kind)}" style="max-width:200px"><figcaption>${escapeHtml(p.kind)}${p.caption ? ' — ' + escapeHtml(p.caption) : ''}</figcaption></figure>`).join('') : '<p>No photos yet.</p>'}</div>
  <h3>Rental period &amp; availability</h3>
  <p>${escapeHtml(l.rental_period_display || 'Rental period not stated')}${l.available_from ? ' · from ' + escapeHtml(l.available_from) : ''}${l.available_until ? ' · until ' + escapeHtml(l.available_until) : ''}${l.min_stay ? ' · minimum stay: ' + escapeHtml(l.min_stay) : ''}</p>
  <p>${l.seats_total !== null && l.seats_total !== undefined ? 'Seats: ' + (l.seats_available ?? '—') + ' available of ' + l.seats_total + ' total' : 'Seats not stated'}</p>
  ${l.deposit_refund_note ? `<p>Deposit refund: ${escapeHtml(l.deposit_refund_note)}</p>` : ''}
  ${l.season_note ? `<p>${escapeHtml(l.season_note)}</p>` : ''}
  <h3>Rules &amp; timings</h3>
  <p>${l.rules ? escapeHtml(l.rules).replace(/\n/g, '<br>') : 'No rules stated'}</p>
  <p>${l.gate_open || l.gate_close ? 'Gate: ' + escapeHtml(l.gate_open || '—') + ' – ' + escapeHtml(l.gate_close || '—') : 'Gate timings not stated'}${l.visit_hours ? ' · Visit hours: ' + escapeHtml(l.visit_hours) : ''}</p>
  <h3>Mess</h3>
  <p>${l.mess_status ? 'Mess: ' + escapeHtml(MESS_STATUS_LABELS[l.mess_status] || l.mess_status) : 'Mess status not stated'}${l.mess_included ? ' · included in rent' : (l.mess_pkr ? ' · ' + fmt(l.mess_pkr) + '/month' : '')}${l.meals_per_day ? ' · ' + l.meals_per_day + ' meals/day' : ''}</p>
  ${l.mess_menu ? `<p>Menu: ${escapeHtml(l.mess_menu).replace(/\n/g, '<br>')}</p>` : ''}
  <p class="src">Source: ${escapeHtml(l.source) || '—'}</p></article>`;

  // Reviews.
  $('reviewSummary').textContent = s.average_rating === null
    ? 'No student reviews yet.'
    : `${s.average_rating} ★ from ${s.review_count} student review${s.review_count === 1 ? '' : 's'}` +
      (s.unpublished_review_count ? ` · ${s.unpublished_review_count} review${s.unpublished_review_count === 1 ? '' : 's'} ${s.unpublished_review_count === 1 ? 'was' : 'were'} not published after the manager's check.` : '');
  const reviews = d.reviews || [];
  $('reviewList').innerHTML = reviews.length ? reviews.map(r => `<article class="listing"><h3>${escapeHtml(r.title || 'Review')} — ${r.rating} ★</h3>
  <p>By ${escapeHtml(r.reviewer_name)} · ${escapeHtml(r.created_at || '')}</p>
  ${Object.entries(r.categories || {}).map(([k, v]) => `<span>${escapeHtml(k)}: ${v}/5</span>`).join(' ')}
  <p>${escapeHtml(r.body)}</p>
  ${(r.photos || []).map(p => `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || 'Review photo')}" style="max-width:160px">`).join('')}
  ${r.manager_reply ? `<p><b>Hostel reply:</b> ${escapeHtml(r.manager_reply)}</p>` : ''}
  <p class="src">${escapeHtml(r.honest_label || 'Student review — the site has not verified this student lived here.')}</p></article>`).join('')
    : '<p>No approved reviews yet.</p>';

  // Price history.
  $('history').innerHTML = (d.history || []).length
    ? '<ul>' + d.history.map(h => `<li>${escapeHtml(h.changed_date)}: ${escapeHtml(h.field)} ${fmt(h.old_value)} → ${fmt(h.new_value)}</li>`).join('') + '</ul>'
    : '<p>No price changes recorded yet.</p>';

  // Write a review: students only; everyone else goes to the login page.
  const meRes = await fetch('/api/auth/me');
  if (!meRes.ok) {
    $('writeReview').innerHTML = '<p><a href="/login">Log in as a student</a> to write a review. Reviews are checked by the hostel manager before they are published.</p>';
    return;
  }
  const me = await meRes.json();
  if (me.role !== 'student') {
    $('writeReview').innerHTML = '<p>Only students can write reviews. You are logged in as ' + escapeHtml(me.role) + '.</p>';
    return;
  }
  const mine = await (await fetch('/api/student/reviews')).json();
  const own = (mine.reviews || []).find(r => r.listing_id === Number(id));
  $('writeReview').innerHTML = own
    ? `<h3>Your review</h3><p>Status: ${escapeHtml(own.status)}${own.status === 'pending' ? ' — waiting for the hostel manager\'s check.' : ''}</p>
       <p>${escapeHtml(own.title || '')} — ${own.rating} ★</p><p>${escapeHtml(own.body)}</p>
       <form id="editReview"><label>Rating (1–5) <input name="rating" type="number" min="1" max="5" value="${own.rating}" required></label>
       <label>Title <input name="title" maxlength="120" value="${escapeHtml(own.title || '')}"></label>
       <label>Your review <textarea name="body" rows="4" maxlength="2000" required>${escapeHtml(own.body)}</textarea></label>
       <p>One review per hostel. Editing an approved review sends it back for re-check. No phone numbers or CNIC in the text; links are removed.</p>
       <button>Save changes</button></form><p id="reviewMsg"></p>
       <button id="deleteReviewBtn">Delete my review</button>`
    : `<h3>Write a review</h3>
       <form id="newReview"><label>Rating (1–5) <input name="rating" type="number" min="1" max="5" required></label>
       <label>Title <input name="title" maxlength="120" placeholder="Short title (optional)"></label>
       <label>Your review <textarea name="body" rows="4" maxlength="2000" required placeholder="How was the hostel?"></textarea></label>
       <p>One review per hostel. Your review is checked by the hostel manager before it is published. No phone numbers or CNIC in the text; links are removed.</p>
       <button>Submit review</button></form><p id="reviewMsg"></p>`;
  const form = $('newReview') || $('editReview');
  if (form) form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(form);
    const body = { rating: Number(fd.get('rating')), title: String(fd.get('title') || ''), body: String(fd.get('body') || '') };
    const url = own ? '/api/reviews/' + own.id : '/api/reviews';
    const payload = own ? body : { ...body, listing_id: Number(id) };
    const r = await fetch(url, { method: own ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const dd = await r.json();
    $('reviewMsg').textContent = r.ok ? (own ? 'Saved — your review is waiting for the manager\'s check again.' : 'Submitted — your review is waiting for the hostel manager\'s check.') : 'Error: ' + (dd.error || 'could not save');
    if (r.ok) load();
  });
  const delBtn = $('deleteReviewBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Delete your review? Its photos are deleted too.')) return;
    const r = await fetch('/api/reviews/' + own.id + '/delete', { method: 'POST' });
    const dd = await r.json();
    $('reviewMsg').textContent = r.ok ? 'Review deleted.' : 'Error: ' + (dd.error || 'could not delete');
    if (r.ok) load();
  });
}
load();

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
  if (link) link.href = me.role === 'manager' ? '/manager' : '/login';
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

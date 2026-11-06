'use strict';
const $ = id => document.getElementById(id);
const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');
const H = () => ({ 'Content-Type': 'application/json', 'X-Admin-Code': $('code').value });
// Master endpoints use the X-Master-Code header (same code value).
const HM = () => ({ 'Content-Type': 'application/json', 'X-Master-Code': $('code').value });
// Escape every user-derived string before it goes into innerHTML.
// Listing names/sources come from manager submissions and must never be
// inserted as raw HTML.
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('loadBtn').addEventListener('click', async () => {
  const r = await fetch('/api/admin/listings', { headers: H() });
  const d = await r.json();
  if (!r.ok) { $('msg').textContent = 'Error: ' + d.error; return; }
  $('msg').textContent = d.listings.length + ' listings (including hidden and examples).';
  $('list').innerHTML = d.listings.map(l => `<article class="listing"><h3>${escapeHtml(l.name)} — ${escapeHtml(l.status)}${l.hidden ? ' (HIDDEN)' : ''}</h3>
  <p>${escapeHtml(l.city)} · ${escapeHtml(l.area)} · ${escapeHtml(l.type)} · ${escapeHtml(l.room)} · ${fmt(l.rent_pkr)} ${l.price_basis === 'semester' ? 'per semester' : 'per month'} · mess ${l.mess_included ? 'included' : fmt(l.mess_pkr)}</p>
  <p>Source: ${escapeHtml(l.source) || '—'}${l.last_verified ? ' · verified ' + escapeHtml(l.last_verified) : ''}</p>
  <label>Source note (required to verify) <input id="src-${l.id}" placeholder="e.g. hostel website, dated 2026-11-04"></label>
  <button data-verify="${l.id}">Verify</button>
  <button data-hide="${l.id}">Hide</button>
  <label>New rent <input id="rent-${l.id}" type="number"></label>
  <label>New mess <input id="mess-${l.id}" type="number"></label>
  <button data-edit="${l.id}">Save price change</button></article>`).join('');
  document.querySelectorAll('[data-verify]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/admin/verify', { method: 'POST', headers: H(), body: JSON.stringify({ id: Number(b.dataset.verify), source_note: $('src-' + b.dataset.verify).value }) });
    const d = await r.json();
    $('msg').textContent = r.ok ? 'Verified.' : 'Error: ' + d.error;
    if (r.ok) $('loadBtn').click();
  }));
  document.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', async () => {
    await fetch('/api/admin/hide', { method: 'POST', headers: H(), body: JSON.stringify({ id: Number(b.dataset.hide) }) });
    $('msg').textContent = 'Hidden.'; $('loadBtn').click();
  }));
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const body = { id: Number(b.dataset.edit) };
    if ($('rent-' + b.dataset.edit).value) body.rent_pkr = Number($('rent-' + b.dataset.edit).value);
    if ($('mess-' + b.dataset.edit).value) body.mess_pkr = Number($('mess-' + b.dataset.edit).value);
    await fetch('/api/admin/edit', { method: 'POST', headers: H(), body: JSON.stringify(body) });
    $('msg').textContent = 'Price change saved (history row written).'; $('loadBtn').click();
  }));
});

// Pending managers: approve or reject with the Phase 1 master endpoints.
$('loadPendingBtn').addEventListener('click', async () => {
  const r = await fetch('/api/master/managers?status=pending', { headers: HM() });
  const d = await r.json();
  if (!r.ok) { $('pendingMsg').textContent = 'Error: ' + d.error; return; }
  $('pendingMsg').textContent = d.managers.length ? d.managers.length + ' manager(s) waiting for approval.' : 'No managers waiting for approval.';
  $('pendingList').innerHTML = d.managers.map(m => `<article class="listing"><h3>${escapeHtml(m.display_name)}</h3>
  <p>Phone: ${escapeHtml(m.phone || '—')} · Registered: ${escapeHtml(m.created_at || '')}</p>
  <button data-approve="${m.id}">Approve</button>
  <button data-reject="${m.id}">Reject</button></article>`).join('');
  document.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/master/managers/decide', { method: 'POST', headers: HM(),
      body: JSON.stringify({ user_id: Number(b.dataset.approve), decision: 'approve' }) });
    const d = await r.json();
    $('pendingMsg').textContent = r.ok ? 'Approved — the manager can now log in.' : 'Error: ' + d.error;
    if (r.ok) $('loadPendingBtn').click();
  }));
  document.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/master/managers/decide', { method: 'POST', headers: HM(),
      body: JSON.stringify({ user_id: Number(b.dataset.reject), decision: 'reject', reason: 'Rejected by master' }) });
    const d = await r.json();
    $('pendingMsg').textContent = r.ok ? 'Rejected (final for that Gmail).' : 'Error: ' + d.error;
    if (r.ok) $('loadPendingBtn').click();
  }));
});

// Rejected reviews (Phase 4): master overturn — approve a rejected review
// or hide an approved one; remove a manager reply. Every string escaped.
$('loadRejectedBtn').addEventListener('click', async () => {
  const r = await fetch('/api/master/reviews?status=rejected', { headers: HM() });
  const d = await r.json();
  if (!r.ok) { $('rejectedMsg').textContent = 'Error: ' + d.error; return; }
  $('rejectedMsg').textContent = d.reviews.length ? d.reviews.length + ' rejected review(s).' : 'No rejected reviews.';
  $('rejectedList').innerHTML = d.reviews.map(v => `<article class="listing"><h3>${escapeHtml(v.title || 'Review')} — ${v.rating} ★ · ${escapeHtml(v.status)}</h3>
  <p>Hostel: ${escapeHtml(v.listing_name || '')} · By ${escapeHtml(v.reviewer_name)} · ${escapeHtml(v.created_at || '')}</p>
  <p>${escapeHtml(v.body)}</p>
  <p>Reject reason: <b>${escapeHtml(v.decide_reason || '—')}</b></p>
  ${v.manager_reply ? `<p>Manager reply: ${escapeHtml(v.manager_reply)}</p>` : ''}
  <button data-overturn-approve="${v.id}">Overturn — approve</button>
  <button data-overturn-hide="${v.id}">Overturn — hide</button>
  ${v.manager_reply ? `<button data-del-reply="${v.id}">Remove manager reply</button>` : ''}</article>`).join('');
  document.querySelectorAll('[data-overturn-approve]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/master/reviews/overturn', { method: 'POST', headers: HM(),
      body: JSON.stringify({ review_id: Number(b.dataset.overturnApprove), decision: 'approve', reason: 'Master overturn' }) });
    const dd = await r.json();
    $('rejectedMsg').textContent = r.ok ? 'Overturned — the review is approved and public.' : 'Error: ' + dd.error;
    if (r.ok) $('loadRejectedBtn').click();
  }));
  document.querySelectorAll('[data-overturn-hide]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/master/reviews/overturn', { method: 'POST', headers: HM(),
      body: JSON.stringify({ review_id: Number(b.dataset.overturnHide), decision: 'hide', reason: 'Master overturn' }) });
    const dd = await r.json();
    $('rejectedMsg').textContent = r.ok ? 'Hidden.' : 'Error: ' + dd.error;
    if (r.ok) $('loadRejectedBtn').click();
  }));
  document.querySelectorAll('[data-del-reply]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch('/api/master/reviews/reply/delete', { method: 'POST', headers: HM(),
      body: JSON.stringify({ review_id: Number(b.dataset.delReply) }) });
    const dd = await r.json();
    $('rejectedMsg').textContent = r.ok ? 'Manager reply removed.' : 'Error: ' + dd.error;
    if (r.ok) $('loadRejectedBtn').click();
  }));
});

// Audit trail: newest first, every row escaped on render.
$('loadAuditBtn').addEventListener('click', async () => {
  const r = await fetch('/api/master/audit', { headers: HM() });
  const d = await r.json();
  if (!r.ok) { $('auditMsg').textContent = 'Error: ' + d.error; return; }
  $('auditMsg').textContent = (d.audit || []).length + ' audit rows (newest first).';
  $('auditList').innerHTML = '<ul>' + (d.audit || []).map(a =>
    `<li>${escapeHtml(a.created_at)} — <b>${escapeHtml(a.action)}</b> · ${escapeHtml(a.actor_role || '—')} · ${escapeHtml(a.target_type || '')} ${a.target_id ?? ''}${a.detail ? ' — ' + escapeHtml(a.detail) : ''}</li>`).join('') + '</ul>';
});

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

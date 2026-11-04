'use strict';
const $ = id => document.getElementById(id);
const fmt = n => 'Rs ' + Number(n).toLocaleString('en-PK');
const H = () => ({ 'Content-Type': 'application/json', 'X-Admin-Code': $('code').value });

$('loadBtn').addEventListener('click', async () => {
  const r = await fetch('/api/admin/listings', { headers: H() });
  const d = await r.json();
  if (!r.ok) { $('msg').textContent = 'Error: ' + d.error; return; }
  $('msg').textContent = d.listings.length + ' listings (including hidden and examples).';
  $('list').innerHTML = d.listings.map(l => `<article class="listing"><h3>${l.name} — ${l.status}${l.hidden ? ' (HIDDEN)' : ''}</h3>
  <p>${l.city} · ${l.area} · ${l.type} · ${l.room} · ${fmt(l.rent_pkr)} ${l.price_basis === 'semester' ? 'per semester' : 'per month'} · mess ${l.mess_included ? 'included' : fmt(l.mess_pkr)}</p>
  <p>Source: ${l.source || '—'}${l.last_verified ? ' · verified ' + l.last_verified : ''}</p>
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

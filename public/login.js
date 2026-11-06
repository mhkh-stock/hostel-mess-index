'use strict';
const $ = id => document.getElementById(id);

async function doLogin(form, msgEl) {
  const f = new FormData(form);
  const r = await fetch('/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gmail: f.get('gmail'), password: f.get('password') }) });
  const d = await r.json();
  if (!r.ok) { $(msgEl).textContent = 'Error: ' + (d.error || 'could not log in'); return; }
  // Managers go to their portal; students go back to search.
  window.location.href = d.user.role === 'manager' ? '/manager' : '/';
}
$('mgrLogin').addEventListener('submit', ev => { ev.preventDefault(); doLogin(ev.target, 'mgrMsg'); });
$('stuLogin').addEventListener('submit', ev => { ev.preventDefault(); doLogin(ev.target, 'stuMsg'); });

$('registerForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const body = Object.fromEntries(f.entries());
  const r = await fetch('/api/auth/register', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { $('regMsg').textContent = 'Error: ' + (d.error || 'could not register'); return; }
  $('regMsg').textContent = d.role === 'manager'
    ? 'Registered. Your account is waiting for master approval — you can log in after the master approves it.'
    : 'Registered. You can log in now.';
  ev.target.reset();
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

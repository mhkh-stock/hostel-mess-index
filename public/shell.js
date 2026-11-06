// Shared topnav shell for the login pages (chooser, student, manager):
// topnav avatar + bell + log-out. Wires NO forms — each login page has
// its own script for its own form. Logged out: the avatar keeps its
// "Log in" defaults and the log-out button stays hidden. Logged in:
// name + role; the avatar links to the manager portal for managers
// and to the home page for students.
'use strict';
function roleLabel(role) {
  return role === 'manager' ? 'Manager' : role === 'student' ? 'Student' : role;
}
async function loadShellUser() {
  let me;
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) return null;
    me = await r.json();
  } catch { return null; }
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('avatarInitial', (me.display_name || '?').trim().charAt(0).toUpperCase() || '?');
  setText('avatarName', me.display_name || roleLabel(me.role));
  setText('avatarRole', roleLabel(me.role));
  const link = document.getElementById('avatarLink');
  if (link) link.href = me.role === 'manager' ? '/manager' : '/';
  const out = document.getElementById('navLogoutBtn');
  if (out) out.hidden = false;
  return me;
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

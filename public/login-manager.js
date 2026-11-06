// Manager login page only. Wires ONLY the manager login + manager
// register forms on this page — there is no student form here, and a
// student account cannot log in through this page (it is logged out
// again at once with a plain message pointing at the student page).
'use strict';
const $ = id => document.getElementById(id);
const PAGE_ROLE = 'manager';
const OTHER_ROLE = 'student';

async function doLogin(form) {
  const f = new FormData(form);
  const msgEl = $('mgrMsg');
  let r;
  try {
    r = await fetch('/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gmail: f.get('gmail'), password: f.get('password') }) });
  } catch { msgEl.textContent = 'Could not reach the server. Please try again.'; return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { msgEl.textContent = 'Error: ' + (d.error || 'could not log in'); return; }
  if (!d.user || d.user.role !== PAGE_ROLE) {
    // A student account typed its Gmail here by mistake: log it out
    // again at once and send it to the student page.
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    msgEl.textContent = 'That account is a Student account. Please use the Student login page.';
    return;
  }
  window.location.href = '/manager';
}
$('mgrLogin').addEventListener('submit', ev => { ev.preventDefault(); doLogin(ev.target); });

$('mgrRegister').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const body = { gmail: f.get('gmail'), password: f.get('password'),
    display_name: f.get('display_name'), phone: f.get('phone'), role: PAGE_ROLE };
  let r;
  try {
    r = await fetch('/api/auth/register', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { $('regMsg').textContent = 'Could not reach the server. Please try again.'; return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { $('regMsg').textContent = 'Error: ' + (d.error || 'could not register'); return; }
  $('regMsg').textContent = 'Registered. Your account is waiting for master approval — you can log in after the master approves it.';
  ev.target.reset();
});

// Wrong-role guard: this page is for managers only. Logged in as the
// same role -> the manager portal. Logged in as the other role -> hide
// both forms and show the plain "log out to log in as a manager" box.
$('wrongRoleLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});
(async function guardRole() {
  const me = await loadShellUser();
  if (!me) return; // logged out: the forms stay visible.
  if (me.role === PAGE_ROLE) { window.location.href = '/manager'; return; }
  $('loginForms').hidden = true;
  $('wrongRoleText').textContent = 'You are logged in as a ' + (OTHER_ROLE === 'student' ? 'Student' : 'Manager')
    + ' (' + (me.display_name || me.role) + '). Log out to log in as a Manager.';
  $('wrongRoleBox').hidden = false;
})();

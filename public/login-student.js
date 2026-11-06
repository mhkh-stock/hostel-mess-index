// Student login page only. Wires ONLY the student login + student
// register forms on this page — there is no manager form here, and a
// manager account cannot log in through this page (it is logged out
// again at once with a plain message pointing at the manager page).
'use strict';
const $ = id => document.getElementById(id);
const PAGE_ROLE = 'student';
const OTHER_ROLE = 'manager';

async function doLogin(form) {
  const f = new FormData(form);
  const msgEl = $('stuMsg');
  let r;
  try {
    r = await fetch('/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gmail: f.get('gmail'), password: f.get('password') }) });
  } catch { msgEl.textContent = 'Could not reach the server. Please try again.'; return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { msgEl.textContent = 'Error: ' + (d.error || 'could not log in'); return; }
  if (!d.user || d.user.role !== PAGE_ROLE) {
    // A manager account typed its Gmail here by mistake: log it out
    // again at once and send it to the manager page.
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    msgEl.textContent = 'That account is a Manager account. Please use the Manager login page.';
    return;
  }
  window.location.href = '/';
}
$('stuLogin').addEventListener('submit', ev => { ev.preventDefault(); doLogin(ev.target); });

$('stuRegister').addEventListener('submit', async ev => {
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
  $('regMsg').textContent = 'Registered. You can log in now.';
  ev.target.reset();
});

// Wrong-role guard: this page is for students only. Logged in as the
// same role -> home. Logged in as the other role -> hide both forms
// and show the plain "log out to log in as a student" box instead.
$('wrongRoleLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});
(async function guardRole() {
  const me = await loadShellUser();
  if (!me) return; // logged out: the forms stay visible.
  if (me.role === PAGE_ROLE) { window.location.href = '/'; return; }
  $('loginForms').hidden = true;
  $('wrongRoleText').textContent = 'You are logged in as a ' + (OTHER_ROLE === 'manager' ? 'Manager' : 'Student')
    + ' (' + (me.display_name || me.role) + '). Log out to log in as a Student.';
  $('wrongRoleBox').hidden = false;
})();

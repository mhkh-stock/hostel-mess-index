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

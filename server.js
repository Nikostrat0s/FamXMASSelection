const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeDraw } = require('./draw');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD || 'dev-secret';

if (!ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set. The organizer page is locked until you set it.');

// ---------- storage ----------
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { title: 'Family Christmas Gift Draw', people: [], assignments: null, drawnAt: null }; }
}
function save(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
let state = load();

const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(16).toString('base64url');

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const adminCookieValue = () => crypto.createHmac('sha256', SECRET).update('admin:' + ADMIN_PASSWORD).digest('hex');

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const got = Buffer.from(cookies(req).admin || '');
  const want = Buffer.from(adminCookieValue());
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
  });
}
function send(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  res.end(html);
}
const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...headers }); res.end(); };
const baseUrl = req => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const nameOf = id => (state.people.find(p => p.id === id) || {}).name || '?';

// ---------- page layout ----------
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f3d2e;color:#1d1d1d;min-height:100vh;
background-image:radial-gradient(circle at 20% 10%,#1b5e45 0,transparent 40%),radial-gradient(circle at 80% 90%,#7a1d1d 0,transparent 45%)}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px}
.card{background:#fffdf7;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.25);margin-bottom:16px}
h1{color:#fff;text-align:center;font-size:1.9rem;margin:8px 0 20px}h2{margin-top:0;color:#8b1e1e}
.btn{display:inline-block;background:#b22222;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:1rem;cursor:pointer;text-decoration:none}
.btn:hover{background:#951b1b}.btn.green{background:#1f7a55}.btn.green:hover{background:#196447}.btn.grey{background:#666}.btn.small{padding:6px 10px;font-size:.85rem}
.btn.big{font-size:1.3rem;padding:16px 28px}
input[type=text],input[type=password]{padding:10px;border:1px solid #ccc;border-radius:10px;font-size:1rem;width:100%}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.row input{flex:1;min-width:140px}
table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:middle}
.muted{color:#666;font-size:.9rem}.ok{color:#1f7a55;font-weight:600}.warn{color:#b22222}
.link{font-family:ui-monospace,monospace;font-size:.8rem;word-break:break-all;background:#f3f1ea;padding:4px 6px;border-radius:6px}
.center{text-align:center}.names{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin:20px 0}
.gift{background:#b22222;color:#fff;border-radius:14px;padding:22px 26px;font-size:1.6rem;font-weight:700;min-width:180px;text-align:center;box-shadow:0 6px 0 #7a1414}
.gift.spin{animation:pulse .12s infinite alternate}@keyframes pulse{from{transform:scale(.97)}to{transform:scale(1.03)}}
.msg{padding:10px 14px;border-radius:10px;background:#fdecea;color:#8b1e1e;margin-bottom:12px}
form.inline{display:inline}
</style></head><body><div class="wrap"><h1>🎄 ${esc(state.title)} 🎁</h1>${body}</div></body></html>`;

// ---------- PINs ----------
const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const pinOk = (p, pin) => {
  const a = Buffer.from(hashPin(pin, p.salt), 'hex'), b = Buffer.from(p.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const validPin = pin => /^\d{4,8}$/.test(pin);
const failures = new Map(); // personId -> { count, until }

function currentPerson(req) {
  const t = cookies(req).person;
  return t ? state.people.find(p => p.session && p.session === t) : null;
}
const started = () => !!state.assignments;
const footer = '<p class="center"><a href="/admin" style="color:#fff;opacity:.7;font-size:.85rem">Organizer</a></p>';

// ---------- family pages ----------
function loginForm(msg, selectedId) {
  if (state.people.length < 3) return page('Not yet', `<div class="card center"><h2>Hi! 👋</h2><p>The organizer is still setting up the family list. Check back soon.</p></div>${footer}`);
  const opts = state.people.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return page('Log in', `<div class="card"><h2>Log in 🎅</h2>
    ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
    <form method="post" action="/login-person">
      <p><label>Your name<br><select name="id" required style="padding:10px;border-radius:10px;font-size:1rem;width:100%"><option value="">Choose your name</option>${opts}</select></label></p>
      <p><label>PIN<br><input type="password" name="pin" inputmode="numeric" pattern="\\d{4,8}" placeholder="4 to 8 digits" required></label></p>
      <p class="muted">First time? Make up a PIN now and remember it. You'll use it to log back in.</p>
      <button class="btn green">Log in</button>
    </form></div>${footer}`);
}

function personPage(p, justRolled) {
  const rolled = p.rolled || 0;
  const mine = started() ? state.assignments[p.id].slice(0, rolled).map(nameOf) : [];
  const pool = state.people.filter(x => x.id !== p.id).map(x => x.name);
  const slots = [0, 1].map(i => i < mine.length
    ? `<div class="gift" ${justRolled && i === mine.length - 1 ? 'data-new="1"' : ''}>${esc(mine[i])}</div>`
    : `<div class="gift" style="background:#ccc;box-shadow:0 6px 0 #999">?</div>`).join('');
  return page('My recipients', `<div class="card center"><h2>Hi ${esc(p.name)}! 🎄</h2>
    <p>${rolled === 0 ? "You haven't picked anyone yet." : rolled === 1 ? 'You have 1 of 2. Roll again for your second person.' : "You're all set! You're buying for:"}</p>
    <div class="names">${slots}</div>
    ${rolled < 2 ? `<form method="post" action="/roll" id="f"><button class="btn green big" id="b">🎲 Roll for gift recipient</button></form>` : '<p class="muted">🤫 Keep it secret!</p>'}
    </div><p class="center"><a href="/logout-person" style="color:#fff">Log out</a></p>
    <script>
    const pool=${JSON.stringify(pool).replace(/</g, '\\u003c')};
    const f=document.getElementById('f');
    if(f) f.addEventListener('submit',e=>{e.preventDefault();document.getElementById('b').disabled=true;
      const el=[...document.querySelectorAll('.gift')].find(x=>x.textContent==='?');if(!el)return f.submit();
      el.style.background='';el.style.boxShadow='';el.classList.add('spin');let n=0;
      const t=setInterval(()=>{el.textContent=pool[Math.floor(Math.random()*pool.length)];if(++n>20){clearInterval(t);f.submit();}},90);});
    </script>`);
}

// ---------- organizer page ----------
function adminPage(req, msg) {
  const locked = started();
  const url = baseUrl(req);
  const rows = state.people.map(p => `<tr>
    <td>${locked ? `<strong>${esc(p.name)}</strong>` : `<form method="post" action="/admin/rename" class="row"><input type="hidden" name="id" value="${p.id}"><input type="text" name="name" value="${esc(p.name)}" maxlength="40" required><button class="btn small grey">Save</button></form>`}</td>
    <td>${p.pinHash ? '<span class="ok">Has PIN</span>' : '<span class="muted">No login yet</span>'}</td>
    <td>${p.rolled || 0} / 2 rolled</td>
    <td>${p.pinHash ? `<form method="post" action="/admin/resetpin" class="inline" onsubmit="return confirm('Reset PIN for ${esc(p.name).replace(/'/g, '')}? They will make a new one next time they log in.')"><input type="hidden" name="id" value="${p.id}"><button class="btn small grey">Reset PIN</button></form>` : ''}
      ${locked ? '' : `<form method="post" action="/admin/remove" class="inline" onsubmit="return confirm('Remove ${esc(p.name).replace(/'/g, '')}?')"><input type="hidden" name="id" value="${p.id}"><button class="btn small">Remove</button></form>`}</td>
  </tr>`).join('');

  const pairs = locked ? state.people.map(p => {
    const r = p.rolled || 0;
    const names = r ? state.assignments[p.id].slice(0, r).map(id => esc(nameOf(id))).join(' &amp; ') : '<span class="muted">nobody yet</span>';
    return `<tr><td><strong>${esc(p.name)}</strong></td><td>→ ${names}</td></tr>`;
  }).join('') : '';

  return page('Organizer', `
  ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
  <div class="card"><h2>Organizer</h2>
    <p>Send everyone this link: <span class="link">${esc(url)}/</span></p>
    <p class="muted">Each person logs in, then rolls twice to get 2 different people. Everyone ends up picked by exactly 2 people, and nobody gets themselves.</p>
    <form method="post" action="/admin/title" class="row"><input type="text" name="title" value="${esc(state.title)}" maxlength="60"><button class="btn small grey">Rename event</button></form>
  </div>
  <div class="card"><h2>Family members (${state.people.length})</h2>
    ${state.people.length ? `<table><tbody>${rows}</tbody></table>` : '<p class="muted">No one added yet.</p>'}
    ${locked ? '<p class="muted">The list is locked because rolling has started. To change it, use "Start over" below.</p>'
      : `<form method="post" action="/admin/add" class="row" style="margin-top:12px"><input type="text" name="name" placeholder="Add a name (or several, separated by commas)" required><button class="btn green">Add</button></form>
         <p class="muted">Add everyone before sharing the link. The list locks as soon as the first person rolls. You need at least 3 people.</p>`}
  </div>
  ${locked ? `<div class="card"><h2>Who has who</h2>
    <details><summary style="cursor:pointer;font-weight:600">🔒 Show (spoilers!)</summary><table style="margin-top:8px">${pairs}</table></details>
    <p class="muted" style="margin-top:16px">"Start over" clears everyone's rolls so they can roll again. PINs are kept.</p>
    <form method="post" action="/admin/reset" onsubmit="return confirm('Start over? Everyone loses the names they rolled.')"><button class="btn">Start over</button></form></div>` : ''}
  <p class="center"><a href="/" style="color:#fff">Family page</a> · <a href="/logout" style="color:#fff">Log out</a></p>`);
}

const loginPage = msg => page('Organizer login', `<div class="card"><h2>Organizer login</h2>
  ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
  ${ADMIN_PASSWORD ? `<form method="post" action="/login" class="row"><input type="password" name="password" placeholder="Organizer password" required autofocus><button class="btn green">Log in</button></form>`
  : '<p class="warn">Set the <code>ADMIN_PASSWORD</code> environment variable on the server to unlock this page.</p>'}</div>`);

// ---------- router ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';

  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p === '/' && req.method === 'GET') {
    const me = currentPerson(req);
    return send(res, 200, me ? personPage(me, url.searchParams.has('rolled')) : loginForm());
  }

  if (p === '/login-person' && req.method === 'POST') {
    const { id, pin = '' } = await readBody(req);
    const who = state.people.find(x => x.id === id);
    if (!who) return send(res, 400, loginForm('Please choose your name.'));
    const f = failures.get(who.id);
    if (f && f.until > Date.now()) return send(res, 429, loginForm('Too many wrong PINs. Try again in a few minutes.', id));
    if (!validPin(pin)) return send(res, 400, loginForm('Your PIN must be 4 to 8 digits.', id));
    if (!who.pinHash) { who.salt = crypto.randomBytes(16).toString('hex'); who.pinHash = hashPin(pin, who.salt); }
    else if (!pinOk(who, pin)) {
      const c = (f ? f.count : 0) + 1;
      failures.set(who.id, { count: c, until: c >= 5 ? Date.now() + 10 * 60 * 1000 : 0 });
      return send(res, 401, loginForm('Wrong PIN. If you forgot it, ask the organizer to reset it.', id));
    }
    failures.delete(who.id);
    if (!who.session) who.session = newToken();
    save(state);
    return redirect(res, '/', { 'Set-Cookie': `person=${who.session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}` });
  }
  if (p === '/logout-person') return redirect(res, '/', { 'Set-Cookie': 'person=; Path=/; Max-Age=0' });

  if (p === '/roll' && req.method === 'POST') {
    const me = currentPerson(req);
    if (!me) return redirect(res, '/');
    if (!started()) {
      // First roll by anyone: build the full, balanced plan and lock the list.
      try { state.assignments = makeDraw(state.people.map(q => q.id)); state.drawnAt = new Date().toISOString(); }
      catch (e) { return send(res, 400, page('Not yet', `<div class="card center"><p>${esc(e.message)}</p><a class="btn" href="/">Back</a></div>`)); }
    }
    if ((me.rolled || 0) < 2) { me.rolled = (me.rolled || 0) + 1; save(state); }
    return redirect(res, '/?rolled');
  }

  if (p === '/admin' && req.method === 'GET')
    return isAdmin(req) ? send(res, 200, adminPage(req, url.searchParams.get('msg'))) : send(res, 200, loginPage());
  if (p === '/login' && req.method === 'POST') {
    const { password = '' } = await readBody(req);
    const a = crypto.createHash('sha256').update(password).digest(), b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (ADMIN_PASSWORD && crypto.timingSafeEqual(a, b))
      return redirect(res, '/admin', { 'Set-Cookie': `admin=${adminCookieValue()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
    return send(res, 401, loginPage('Wrong password.'));
  }
  if (p === '/logout') return redirect(res, '/admin', { 'Set-Cookie': 'admin=; Path=/; Max-Age=0' });

  if (p.startsWith('/admin/') && req.method === 'POST') {
    if (!isAdmin(req)) return redirect(res, '/admin');
    const body = await readBody(req);
    const back = msg => redirect(res, '/admin' + (msg ? '?msg=' + encodeURIComponent(msg) : ''));
    const clean = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const lockedMsg = 'Rolling has started, so the list is locked. Use "Start over" to change it.';
    switch (p) {
      case '/admin/title': state.title = clean(body.title) || state.title; break;
      case '/admin/add': {
        if (started()) return back(lockedMsg);
        for (const n of String(body.name || '').split(',').map(clean).filter(Boolean)) {
          if (state.people.some(x => x.name.toLowerCase() === n.toLowerCase())) return back(`"${n}" is already on the list.`);
          state.people.push({ id: newId(), name: n, rolled: 0 });
        }
        break;
      }
      case '/admin/rename': {
        if (started()) return back(lockedMsg);
        const x = state.people.find(q => q.id === body.id), n = clean(body.name);
        if (x && n) {
          if (state.people.some(q => q !== x && q.name.toLowerCase() === n.toLowerCase())) return back(`"${n}" is already on the list.`);
          x.name = n;
        }
        break;
      }
      case '/admin/remove':
        if (started()) return back(lockedMsg);
        state.people = state.people.filter(q => q.id !== body.id); break;
      case '/admin/resetpin': {
        const x = state.people.find(q => q.id === body.id);
        if (x) { delete x.pinHash; delete x.salt; delete x.session; failures.delete(x.id); }
        break;
      }
      case '/admin/reset':
        state.assignments = null; state.drawnAt = null; state.people.forEach(q => { q.rolled = 0; });
        break;
      default: return send(res, 404, 'Not found');
    }
    save(state);
    return back();
  }
  send(res, 404, page('Not found', '<div class="card center"><h2>Page not found</h2></div>'));
}

http.createServer((req, res) => handle(req, res).catch(err => { console.error(err); if (!res.headersSent) send(res, 500, 'Something went wrong'); }))
  .listen(PORT, () => console.log(`Gift draw running on port ${PORT} (data: ${DATA_FILE})`));

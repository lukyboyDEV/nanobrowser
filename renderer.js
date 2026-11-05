const $ = id => document.getElementById(id);
const tabsEl = $('tabs'), urlEl = $('url'), engineEl = $('engine');
const els = new Map();
let lastActive = null;

engineEl.onchange = () => window.api.setEngine(engineEl.value);

function makeTab(t) {
  const el = document.createElement('div');
  const title = document.createElement('span'); title.className = 'title';
  const close = document.createElement('button'); close.className = 'close'; close.textContent = '×';
  close.onclick = e => { e.stopPropagation(); window.api.closeTab(t.id); };
  el.onclick = () => window.api.selectTab(t.id);
  el.append(title, close);
  return el;
}

window.api.onState(({ activeId, tabs, engine }) => {
  engineEl.value = engine || 'nano';
  const ids = new Set(tabs.map(t => t.id));
  for (const [id, el] of els) if (!ids.has(id)) { el.remove(); els.delete(id); }
  tabs.forEach((t, i) => {
    let el = els.get(t.id);
    if (!el) { el = makeTab(t); els.set(t.id, el); }
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);
    el.className = 'tab' + (t.id === activeId ? ' active' : '') + (t.loading ? ' loading' : '');
    el.firstChild.textContent = t.title;
    if (t.id === activeId && (document.activeElement !== urlEl || lastActive !== activeId)) urlEl.value = t.url;
  });
  lastActive = activeId;
});

urlEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { window.api.navigate({ input: urlEl.value }); urlEl.blur(); }
});
urlEl.addEventListener('focus', () => urlEl.select());
window.api.onFocusUrl(() => { urlEl.focus(); urlEl.select(); });
$('back').onclick = () => window.api.back();
$('forward').onclick = () => window.api.forward();
$('reload').onclick = () => window.api.reload();
$('newtab').onclick = () => { window.api.newTab(); urlEl.focus(); };
window.api.ready();

// ---- Sidebar ----
const side = $('side'), nav = $('nav'), PANELS = ['account', 'history', 'bookmarks', 'settings'];
let sideOpen = false, sideNow = 0, curPanel = 'account', user = null, authMode = 'in', anim = 0;
const ease = t => 1 - Math.pow(1 - t, 3);
function slide(to) {
  const from = sideNow, t0 = performance.now(), id = ++anim;
  (function step(now) {
    if (id !== anim) return;
    const k = Math.min(1, (now - t0) / 280);
    sideNow = from + (to - from) * ease(k);
    side.style.width = sideNow + 'px'; window.api.sidebarWidth(sideNow);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
$('menu').onclick = () => { sideOpen = !sideOpen; slide(sideOpen ? 300 : 0); if (sideOpen) show(curPanel); };
function show(p) {
  curPanel = p;
  const i = PANELS.indexOf(p);
  $('ind').style.transform = 'translateX(' + i * 100 + '%)';
  [...nav.querySelectorAll('button')].forEach(b => b.classList.toggle('on', b.dataset.p === p));
  PANELS.forEach(n => $('p-' + n).classList.toggle('on', n === p));
  if (p === 'account') renderAccount(); else if (p === 'history') loadHistory(); else if (p === 'bookmarks') loadBookmarks();
}
nav.querySelectorAll('button').forEach(b => b.onclick = () => show(b.dataset.p));
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

function renderAccount() {
  const box = $('p-account'); box.textContent = '';
  if (user) {
    const me = mk('div', 'me'); me.append(mk('div', 'av', user.handle[0].toUpperCase()), mk('b', '', '@' + user.handle), mk('p', 'muted', 'Signed in. History and bookmarks are saved to your account.'));
    const out = mk('button', 'btn ghost', 'Sign out'); out.onclick = () => window.api.logout();
    box.append(me, out); return;
  }
  const seg = mk('div', 'seg' + (authMode === 'up' ? ' up' : '')), bi = mk('button', authMode === 'in' ? 'on' : '', 'Sign in'), bu = mk('button', authMode === 'up' ? 'on' : '', 'Sign up');
  seg.append(mk('i'), bi, bu);
  const u = mk('input', 'field'), p = mk('input', 'field'), err = mk('p', 'err'), go = mk('button', 'btn', authMode === 'in' ? 'Sign in' : 'Create account');
  u.placeholder = 'Username'; u.autocomplete = 'off'; u.spellcheck = false; p.type = 'password'; p.placeholder = 'Password (min 6 characters)';
  const sw = m => { authMode = m; seg.classList.toggle('up', m === 'up'); bi.classList.toggle('on', m === 'in'); bu.classList.toggle('on', m === 'up'); go.textContent = m === 'in' ? 'Sign in' : 'Create account'; err.textContent = ''; };
  bi.onclick = () => sw('in'); bu.onclick = () => sw('up');
  const submit = async () => {
    if (authMode === 'up' && p.value.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; }
    const r = await (authMode === 'in' ? window.api.login : window.api.signup)(u.value, p.value);
    if (r.error) err.textContent = r.error;
  };
  go.onclick = submit; [u, p].forEach(i => i.addEventListener('keydown', e => e.key === 'Enter' && submit()));
  box.append(seg, u, p, err, go);
}

function fillList(el, items, onOpen, onDel, emptyMsg) {
  el.textContent = '';
  if (!items.length) { el.append(mk('div', 'empty', emptyMsg)); return; }
  items.forEach(it => {
    const row = mk('div', 'item'), tx = mk('div', 'tx'), x = mk('button', 'x', '×');
    tx.append(mk('b', '', it.title || it.url), mk('small', '', it.url));
    row.onclick = () => window.api.navigate({ input: it.url });
    x.onclick = async e => { e.stopPropagation(); row.remove(); await onDel(it.id); if (!el.children.length) el.append(mk('div', 'empty', emptyMsg)); };
    row.append(tx, x); el.append(row);
  });
}
let histCache = [];
function drawHistory() {
  const q = $('hq').value.toLowerCase();
  fillList($('hlist'), histCache.filter(h => (h.title + h.url).toLowerCase().includes(q)).slice(0, 100), null, id => window.api.delHistory(id), 'No history yet');
}
async function loadHistory() { histCache = await window.api.getHistory(); drawHistory(); }
$('hq').oninput = drawHistory;
$('hclear').onclick = async () => { await window.api.clearHistory(); loadHistory(); };
async function loadBookmarks(list) { fillList($('blist'), list || await window.api.getBookmarks(), null, id => window.api.delBookmark(id), 'No bookmarks yet'); }
$('badd').onclick = async () => loadBookmarks(await window.api.addBookmark());
$('engine2').onchange = e => window.api.setEngine(e.target.value);
window.api.onState(s => {
  $('engine2').value = s.engine || 'nano';
  const changed = (s.user && s.user.handle) !== (user && user.handle);
  user = s.user;
  if (changed) { renderAccount(); if (curPanel === 'history') loadHistory(); if (curPanel === 'bookmarks') loadBookmarks(); }
});
show('account');

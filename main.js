const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const nanoSearch = require('./search');

// Look like normal Chrome so sites (Google login etc.) don't block us
app.userAgentFallback = app.userAgentFallback
  .replace(/\s*Electron\/\S+/, '')
  .replace(new RegExp('\\s*' + app.getName() + '\\/\\S+', 'i'), '');

const CHROME_H = 80; // tab bar (40) + toolbar (40)
const START = pathToFileURL(path.join(__dirname, 'start.html')).href;
const RESULTS = pathToFileURL(path.join(__dirname, 'results.html')).href;
const CHAT = pathToFileURL(path.join(__dirname, 'chat.html')).href;
const ENGINES = {
  nano: 'nano',
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q='
};
let settings = { engine: null };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { settings = { engine: null, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {} }
function saveSettings() { try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch {} }
const isStart = url => url === START || url.endsWith('/start.html');
let win, tabs = [], active = null, nextId = 1, sideW = 0;
let db = { users: {}, data: {}, session: null };
const dbFile = () => path.join(app.getPath('userData'), 'accounts.json');
function loadDb() { try { db = { users: {}, data: {}, session: null, ...JSON.parse(fs.readFileSync(dbFile(), 'utf8')) }; } catch {} }
function saveDb() { try { fs.writeFileSync(dbFile(), JSON.stringify(db)); } catch {} }
const who = () => db.session || 'guest';
const bucket = () => (db.data[who()] = db.data[who()] || { history: [], bookmarks: [], memory: [], model: 'lite' });
const hashPw = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
const userInfo = () => db.session ? { handle: db.users[db.session].handle } : null;
function addHistory(url, title) {
  if (!/^https?:/i.test(url)) return;
  const h = bucket().history;
  if (h[0] && h[0].url === url) { if (title) h[0].title = title; }
  else h.unshift({ id: crypto.randomUUID(), url, title: title || url, t: Date.now() });
  if (h.length > 500) h.length = 500;
  saveDb();
}

function toUrl(input) {
  input = (input || '').trim();
  if (!input) return START;
  if (/^nano:\/\/(chat|brain)\/?$/i.test(input)) return CHAT;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  if (!/\s/.test(input) && (/^localhost(:\d+)?(\/|$)/.test(input) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(input)))
    return 'https://' + input;
  const eng = ENGINES[settings.engine] ? settings.engine : 'nano';
  return eng === 'nano' ? RESULTS + '?q=' + encodeURIComponent(input) : ENGINES[eng] + encodeURIComponent(input);
}

function layout() {
  if (!win || win.isDestroyed() || !active) return;
  const [w, h] = win.getContentSize();
  active.view.setBounds({ x: sideW, y: CHROME_H, width: Math.max(0, w - sideW), height: Math.max(0, h - CHROME_H) });
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', {
    activeId: active ? active.id : null,
    engine: settings.engine,
    user: userInfo(),
    tabs: tabs.map(t => {
      const wc = t.view.webContents;
      const u = wc.getURL();
      return { id: t.id, title: wc.getTitle() || 'New Tab', url: isStart(u) ? '' : u.startsWith(CHAT) ? 'nano://chat' : u.startsWith(RESULTS) ? (new URL(u).searchParams.get('q') || '') : u, loading: wc.isLoading() };
    })
  });
}

function createTab(url = START) {
  const view = new WebContentsView({ webPreferences: { partition: 'persist:main', preload: path.join(__dirname, 'preload-start.js') } });
  const tab = { id: nextId++, view };
  tabs.push(tab);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => { createTab(url); return { action: 'deny' }; });
  wc.on('did-navigate', (_e, u) => addHistory(u, wc.getTitle()));
  wc.on('page-title-updated', (_e, t) => { const h = bucket().history[0]; if (h && h.url === wc.getURL()) { h.title = t; saveDb(); } });
  ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']
    .forEach(ev => wc.on(ev, sendState));
  wc.on('before-input-event', handleKey);
  wc.loadURL(url).catch(() => {});
  selectTab(tab.id);
}

function selectTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  if (active) win.contentView.removeChildView(active.view);
  active = tab;
  win.contentView.addChildView(tab.view);
  layout();
  sendState();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [tab] = tabs.splice(i, 1);
  const wasActive = active === tab;
  if (wasActive) { win.contentView.removeChildView(tab.view); active = null; }
  tab.view.webContents.close();
  if (!tabs.length) return createTab();
  if (wasActive) selectTab(tabs[Math.min(i, tabs.length - 1)].id);
  else sendState();
}

function focusUrl() { win.webContents.focus(); win.webContents.send('focus-url'); }

function handleKey(event, input) {
  if (input.type !== 'keyDown') return;
  if (input.key === 'F5') { event.preventDefault(); if (active) active.view.webContents.reload(); return; }
  if (input.alt && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) {
    event.preventDefault(); const h = active && active.view.webContents.navigationHistory;
    if (h) input.key === 'ArrowLeft' ? h.canGoBack() && h.goBack() : h.canGoForward() && h.goForward();
    return;
  }
  if (!(input.control || input.meta)) return;
  const k = input.key.toLowerCase();
  if (/^[1-9]$/.test(k)) { event.preventDefault(); const t = k === '9' ? tabs[tabs.length - 1] : tabs[+k - 1]; if (t) selectTab(t.id); }
  else if (k === 't') { event.preventDefault(); createTab(); focusUrl(); }
  else if (k === 'w') { event.preventDefault(); if (active) closeTab(active.id); }
  else if (k === 'l') { event.preventDefault(); focusUrl(); }
  else if (k === 'r') { event.preventDefault(); if (active) active.view.webContents.reload(); }
  else if (k === 'tab') {
    event.preventDefault();
    const i = tabs.indexOf(active), n = tabs.length;
    selectTab(tabs[(i + (input.shift ? n - 1 : 1)) % n].id);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 640, minHeight: 420, show: false, title: 'Nano', backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');
  win.on('resize', layout);
  win.webContents.on('before-input-event', handleKey);
}

ipcMain.on('ui-ready', () => { if (!tabs.length) { createTab(pendingUrl || undefined); pendingUrl = null; } else sendState(); });
ipcMain.on('tab:new', () => createTab());
ipcMain.on('tab:select', (_e, id) => selectTab(id));
ipcMain.on('tab:close', (_e, id) => closeTab(id));
ipcMain.on('navigate', (_e, { input }) => {
  if (active) active.view.webContents.loadURL(toUrl(input)).catch(() => {});
});
const fromLocal = e => e.sender.getURL().startsWith('file:');
ipcMain.handle('engine:get', e => (fromLocal(e) ? settings.engine : null));
ipcMain.on('engine:set', (e, id) => {
  if (!fromLocal(e) || !ENGINES[id]) return;
  settings.engine = id; saveSettings(); sendState();
});
ipcMain.handle('nano:search', (e, q) => fromLocal(e) ? nanoSearch.search(q) : null);
ipcMain.handle('nano:ai', (e, p) => fromLocal(e) && p ? nanoSearch.overview(p.q, p.results, p.card) : null);
const llm = require('./llm.js'); llm.init(path.join(app.getPath('userData'), 'models'));
let stopCtl = null;
ipcMain.on('ai:stop', e => { if (fromLocal(e) && stopCtl) stopCtl.abort(); });
const mem = () => { const b = bucket(); return b.memory = b.memory || []; };
ipcMain.handle('nano:chat', async (e, p) => {
  if (!fromLocal(e) || !p || typeof p.text !== 'string') return null;
  const b = bucket(), text = p.text.trim().slice(0, 500), rm = text.match(/^(?:please )?remember(?: that|:)?\s+(.{3,300})$/i);
  if (rm) { mem().unshift({ id: crypto.randomUUID(), text: rm[1].trim() }); mem().splice(60); saveDb(); return { text: "Got it, I'll remember that.", provider: 'Nano AI', local: true, query: '', mem: true }; }
  const id = b.model || 'lite';
  if (id !== 'search' && llm.installed(id)) {
    const hist = (Array.isArray(p.hist) ? p.hist : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').map(m => ({ role: m.role, text: m.text.slice(0, 2000) }));
    stopCtl = new AbortController(); const ctl = stopCtl;
    try { const t = await llm.reply(id, hist, mem(), c => { try { e.sender.send('ai:token', c); } catch {} }, ctl.signal); if (t) return { text: t, provider: llm.MODELS[id].name, local: true, query: '' }; } catch (err) { console.error('llm', err.message); }
  }
  return nanoSearch.chat(text, typeof p.prev === 'string' ? p.prev : '');
});
ipcMain.handle('ai:info', e => fromLocal(e) ? { user: db.session, model: bucket().model || 'lite', models: llm.list(), memory: mem() } : null);
ipcMain.handle('ai:model', (e, id) => { if (!fromLocal(e)) return; if (id === 'search' || llm.MODELS[id]) { bucket().model = id; saveDb(); } });
ipcMain.handle('ai:download', (e, id) => fromLocal(e) ? llm.download(id, (i, f) => { try { e.sender.send('ai:progress', { id: i, f }); } catch {} }).then(() => true, () => false) : false);
ipcMain.handle('ai:mem:add', (e, t) => { if (!fromLocal(e) || typeof t !== 'string' || !t.trim()) return mem(); mem().unshift({ id: crypto.randomUUID(), text: t.trim().slice(0, 300) }); mem().splice(60); saveDb(); return mem(); });
ipcMain.handle('ai:mem:del', (e, id) => { if (!fromLocal(e)) return []; const b = bucket(); b.memory = mem().filter(x => x.id !== id); saveDb(); return b.memory; });
ipcMain.on('start:open', (e, page, q) => {
  if (!fromLocal(e) || page !== 'chat') return;
  e.sender.loadURL(CHAT + (typeof q === 'string' && q.trim() ? '?q=' + encodeURIComponent(q.trim().slice(0, 500)) : '')).catch(() => {});
});
ipcMain.on('start:search', (e, q) => {
  if (fromLocal(e) && typeof q === 'string') e.sender.loadURL(toUrl(q)).catch(() => {});
});
const fromUI = e => win && e.sender === win.webContents;
ipcMain.on('sidebar:width', (_e, w) => { sideW = Math.max(0, Math.min(600, Math.round(+w) || 0)); layout(); });
ipcMain.handle('auth:signup', (e, { u, p } = {}) => {
  if (!fromUI(e)) return { error: 'Denied' };
  u = String(u || '').trim(); p = String(p || '');
  if (!/^[a-z0-9_]{3,20}$/i.test(u)) return { error: 'Username: 3-20 letters, numbers or _' };
  if (p.length < 6) return { error: 'Password must be at least 6 characters' };
  const k = u.toLowerCase();
  if (db.users[k]) return { error: 'That username is already taken' };
  const salt = crypto.randomBytes(16).toString('hex');
  db.users[k] = { handle: u, salt, hash: hashPw(p, salt) };
  db.session = k; saveDb(); sendState();
  return { ok: true };
});
ipcMain.handle('auth:login', (e, { u, p } = {}) => {
  if (!fromUI(e)) return { error: 'Denied' };
  const k = String(u || '').trim().toLowerCase(), r = db.users[k];
  const bad = { error: 'Wrong username or password' };
  if (!r) return bad;
  const a = Buffer.from(hashPw(String(p || ''), r.salt), 'hex'), b = Buffer.from(r.hash, 'hex');
  if (!crypto.timingSafeEqual(a, b)) return bad;
  db.session = k; saveDb(); sendState();
  return { ok: true };
});
ipcMain.handle('auth:logout', e => { if (!fromUI(e)) return; db.session = null; saveDb(); sendState(); });
ipcMain.handle('hist:get', e => fromUI(e) ? bucket().history : []);
ipcMain.handle('hist:del', (e, id) => { if (!fromUI(e)) return; const b = bucket(); b.history = b.history.filter(x => x.id !== id); saveDb(); });
ipcMain.handle('hist:clear', e => { if (!fromUI(e)) return; bucket().history = []; saveDb(); });
ipcMain.handle('bm:get', e => fromUI(e) ? bucket().bookmarks : []);
ipcMain.handle('bm:add', e => {
  if (!fromUI(e) || !active) return bucket().bookmarks;
  const wc = active.view.webContents, url = wc.getURL(), b = bucket();
  if (/^https?:/i.test(url) && !b.bookmarks.some(x => x.url === url)) {
    b.bookmarks.unshift({ id: crypto.randomUUID(), url, title: wc.getTitle() || url }); saveDb();
  }
  return b.bookmarks;
});
ipcMain.handle('bm:del', (e, id) => { if (!fromUI(e)) return []; const b = bucket(); b.bookmarks = b.bookmarks.filter(x => x.id !== id); saveDb(); return b.bookmarks; });
ipcMain.on('back', () => { const h = active && active.view.webContents.navigationHistory; if (h && h.canGoBack()) h.goBack(); });
ipcMain.on('forward', () => { const h = active && active.view.webContents.navigationHistory; if (h && h.canGoForward()) h.goForward(); });
ipcMain.on('reload', () => active && active.view.webContents.reload());

// ---- default browser support (Windows, macOS, Linux) ----
let pendingUrl = null;
const urlFromArgs = a => (a || []).find(x => /^https?:\/\//i.test(x)) || (a || []).find(x => /\.(html?|xhtml)$/i.test(x) && fs.existsSync(x) && require('url').pathToFileURL(x).href) || null;
function openExternalUrl(u) {
  if (!u) return;
  if (win && tabs.length) { createTab(u); if (win.isMinimized()) win.restore(); win.focus(); } else pendingUrl = u;
}
function makeDefault() {
  ['http', 'https'].forEach(p => { try { app.setAsDefaultProtocolClient(p); } catch {} });
  if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps').catch(() => {}); // Windows 10/11 requires the user to confirm
  else if (process.platform === 'linux') { try { require('child_process').execFile('xdg-settings', ['set', 'default-web-browser', 'nano.desktop'], () => {}); } catch {} }
}
async function askDefault() {
  if (settings.askedDefault || !win) return;
  settings.askedDefault = true; saveSettings();
  try { if (app.isDefaultProtocolClient('https')) return; } catch {}
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Make default', 'Not now'], defaultId: 0, cancelId: 1, title: 'Nano', message: 'Make Nano your default browser?', detail: process.platform === 'win32' ? 'Windows will open Default apps. Choose Nano under Web browser.' : process.platform === 'darwin' ? 'macOS will ask you to confirm.' : 'Links from other apps will open in Nano.' });
  if (r.response === 0) makeDefault();
}
ipcMain.handle('default:set', e => { if (fromUI(e) || fromLocal(e)) makeDefault(); return true; });
pendingUrl = urlFromArgs(process.argv.slice(1));
app.on('open-url', (e, u) => { e.preventDefault(); openExternalUrl(u); });
app.on('open-file', (e, f) => { e.preventDefault(); openExternalUrl(require('url').pathToFileURL(f).href); });
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } openExternalUrl(urlFromArgs(argv.slice(1))); });
app.whenReady().then(() => { loadSettings(); loadDb(); createWindow(); setTimeout(askDefault, 4000); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) { tabs = []; active = null; createWindow(); } });

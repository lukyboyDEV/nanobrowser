// Nano Seek: meta-search (DuckDuckGo + Mojeek + Wikipedia, rank-fused) + AI overview via Nano AI, our own on-device engine (brain.js).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const enc = encodeURIComponent;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const clean = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();
const isHttp = u => /^https?:\/\//i.test(u);

async function get(url, opts = {}, ms = 9000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await require('electron').net.fetch(url, { ...opts, signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parseDDG(html) {
  const out = [];
  html.split('class="result__a"').slice(1).forEach(ch => {
    let href = (ch.match(/href="([^"]+)"/) || [])[1]; if (!href) return;
    const u = href.match(/uddg=([^&"]+)/);
    href = u ? decodeURIComponent(u[1]) : href.startsWith('//') ? 'https:' + href : href;
    if (!isHttp(href) || /duckduckgo\.com\/y\.js/.test(href)) return;
    const title = clean((ch.match(/>([\s\S]*?)<\/a>/) || [])[1]);
    const snippet = clean((ch.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    if (title) out.push({ url: clean(href), title, snippet });
  });
  return out;
}
function parseMojeek(html) {
  const out = [];
  html.split(/<li[\s>]/).slice(1).forEach(ch => {
    const a = ch.match(/<a\s[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/a>/); if (!a) return;
    const href = (a[0].match(/href="([^"]+)"/) || [])[1];
    if (!href || !isHttp(clean(href))) return;
    const title = clean(a[1]), snippet = clean((ch.match(/<p class="s">([\s\S]*?)<\/p>/) || [])[1]);
    if (title) out.push({ url: clean(href), title, snippet });
  });
  return out;
}
const ddg = async q => parseDDG(await get('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'q=' + enc(q) }));
const mojeek = async q => parseMojeek(await get('https://www.mojeek.com/search?q=' + enc(q)));
async function wiki(q) {
  const j = JSON.parse(await get('https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=5&redirects=1&prop=extracts|pageimages|info&inprop=url&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=240&gsrsearch=' + enc(q)));
  return Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index)
    .map(p => ({ url: p.fullurl, title: p.title, snippet: clean(p.extract), thumb: p.thumbnail && p.thumbnail.source }));
}

const key = u => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, ''); } catch { return u; } };
function fuse(lists) { // reciprocal rank fusion
  const m = new Map();
  lists.forEach(({ name, items }) => items.forEach((r, i) => {
    const k = key(r.url), e = m.get(k) || { ...r, score: 0, via: [] };
    e.score += 1 / (i + 6); e.via.push(name);
    if (!e.snippet && r.snippet) e.snippet = r.snippet;
    m.set(k, e);
  }));
  return [...m.values()].sort((a, b) => b.score - a.score).map(({ url, title, snippet, via }) => ({ url, title, snippet, via, host: key(url).split('/')[0] }));
}

const cache = new Map();
async function search(q) {
  q = String(q || '').trim().slice(0, 300);
  if (!q) return { results: [], card: null, engines: [], ms: 0 };
  const hit = cache.get(q.toLowerCase()); if (hit && Date.now() - hit.t < 600000) return hit.v;
  const t0 = Date.now();
  const src = [['DuckDuckGo', ddg], ['Mojeek', mojeek], ['Wikipedia', wiki]];
  const res = await Promise.allSettled(src.map(([, f]) => f(q)));
  const lists = [], engines = [];
  res.forEach((r, i) => { if (r.status === 'fulfilled' && r.value.length) { lists.push({ name: src[i][0], items: r.value }); engines.push(src[i][0]); } });
  const wk = res[2].status === 'fulfilled' ? res[2].value : [];
  const ql = q.toLowerCase(), top = wk[0];
  const card = top && top.snippet && (ql.includes(top.title.toLowerCase()) || top.title.toLowerCase().includes(ql)) ? top : null;
  const web = lists.filter(l => l.name !== 'Wikipedia');
  const results = fuse(web.length ? [...web, ...lists.filter(l => l.name === 'Wikipedia').map(l => ({ ...l, items: l.items.slice(0, 2) }))] : lists).slice(0, 20);
  const v = { results, card: card && { title: card.title, url: card.url, snippet: card.snippet, thumb: card.thumb || null }, engines, ms: Date.now() - t0 };
  if (results.length) cache.set(q.toLowerCase(), { t: Date.now(), v });
  return v;
}

// ---- AI overview: Nano AI, our own on-device engine (see brain.js). No third-party AI, no keys. ----
const brain = require('./brain.js');
const pageCache = new Map();
async function pageText(url) {
  const hit = pageCache.get(url); if (hit && Date.now() - hit.t < 600000) return hit.v;
  let v = '';
  if (isHttp(url) && !/\.(pdf|docx?|xlsx?|pptx?|zip|mp[34]|jpe?g|png|gif|webp)(\?|$)/i.test(url)) {
    try { v = brain.extractText(await get(url, {}, 5000)); } catch {}
  }
  pageCache.set(url, { t: Date.now(), v }); if (pageCache.size > 60) pageCache.delete(pageCache.keys().next().value);
  return v;
}

async function overview(q, results, card, opts = {}) {
  q = String(q || '').slice(0, 300);
  const me = brain.selfAnswer(q); if (me) return { text: me.text, provider: me.provider, self: true }; // Nano knows itself
  results = (Array.isArray(results) ? results : []).slice(0, 6);
  if (!results.length) return { error: 'No sources' };
  // read the top pages in parallel (snippets alone are too thin to answer from); snippets are the fallback
  const pages = await Promise.all(results.slice(0, 4).map(r => pageText(String(r.url))));
  const docs = results.map((r, i) => ({ cite: i + 1, rank: i, title: String(r.title || ''), text: [String(r.snippet || ''), pages[i] || ''].join(' ').slice(0, 14000) }));
  if (card && card.snippet) {
    const k = card.url && results.findIndex(r => key(r.url) === key(card.url));
    if (k >= 0) docs[k].text = card.snippet + ' ' + docs[k].text;
    else docs.unshift({ cite: null, rank: 0, title: String(card.title || ''), text: String(card.snippet).slice(0, 800) });
  }
  try {
    const out = brain.answer(q, docs, opts);
    if (out && out.text) return { text: out.text.slice(0, 1600), provider: 'Nano AI (search)' };
  } catch {}
  return card && card.snippet ? { text: card.snippet, provider: 'Wikipedia' } : { error: 'No answer found' };
}
// Chat with Nano AI: local skills first (maths, time, about Nano), otherwise search + read + answer.
async function chat(text, prev) {
  text = String(text || '').trim().slice(0, 500); prev = String(prev || '').trim().slice(0, 300);
  if (!text) return { text: 'Say something and I will answer.', provider: 'Nano AI' };
  const mine = brain.local(text);
  if (mine) return { text: mine, provider: 'Nano AI', local: true, query: prev };
  const query = brain.contextQuery(text, prev);
  const d = await search(query).catch(() => null);
  if (!d || !d.results.length) return { text: "I couldn't reach the web just now, so I can't look that up. Check your connection and ask again.", provider: 'Nano AI', query };
  const ai = await overview(query, d.results.slice(0, 6), d.card, { maxWords: 150 });
  if (ai && ai.text) return { text: ai.text, provider: ai.provider, query, sources: d.results.slice(0, 6).map(r => ({ title: r.title, url: r.url, host: r.host })) };
  return { text: "I found pages about that but nothing that clearly answers it. Try rephrasing, or open the top results below.", provider: 'Nano AI', query, sources: d.results.slice(0, 3).map(r => ({ title: r.title, url: r.url, host: r.host })) };
}
module.exports = { search, overview, chat, parseDDG, parseMojeek, clean };

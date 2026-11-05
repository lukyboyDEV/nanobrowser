// Nano AI: Nano's own on-device answer engine. No API keys, no third-party AI, nothing leaves the machine.
// Pipeline: read pages -> split into sentences -> score each sentence against the query
// (BM25 relevance + question-type fit + source rank + centrality) -> pick a diverse set (MMR)
// -> compose a short cited overview. Every sentence in the answer is lifted from a real source, so it can't make facts up.

const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into many much get gets got is it its just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours').split(' '));

// ---------- text helpers ----------
const stem = w => {
  if (w.length < 4 || /\d/.test(w)) return w;
  const s = w.replace(/(ies)$/, 'y').replace(/(sses)$/, 'ss').replace(/([^s])s$/, '$1')
    .replace(/(ition|ation|ing|edly|ed|ly|ment|ers|er|ors|or|ion)$/, m => (w.length - m.length >= 3 ? '' : m));
  return s.length > 5 ? s.slice(0, 5) : s; // prefix stem: demolished / demolition -> "demol"
};
const toks = s => (String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const terms = s => toks(s).filter(w => !STOP.has(w) && w.length > 1).map(stem);

const BOILER = /(cookie|subscribe|newsletter|sign (up|in)|log ?in|all rights reserved|privacy policy|terms of (use|service)|click here|read more|advertis|sponsored|javascript|enable js|share (this|on)|follow us|skip to|copyright|©|related (articles|posts)|you may also|add to cart|free shipping|accept all|captcha|comments? (are|section)|\bmenu\b|buy (your )?tickets|book (now|online|your)|skip the (queue|line)|best (deals?|prices?)|discount|coupon|special offer|order now)/i;
const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Inc|Ltd|Co|Corp|Fig|approx|est|U\.S|U\.K|e\.g|i\.e|a\.m|p\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/;

function sentences(text) {
  text = String(text).replace(/\[(?:\d+|[a-z]|citation needed|note \d+)\]/gi, '').replace(/\s+/g, ' ').trim();
  const out = [];
  let buf = '';
  text.split(/(?<=[.!?])\s+(?=["“(\[]?[\p{Lu}\p{N}])/u).forEach(part => {
    buf = buf ? buf + ' ' + part : part;
    if (ABBR.test(buf) || /\b[A-Z]\.$/.test(buf)) return; // "Dr." / initials: keep joining
    out.push(buf); buf = '';
  });
  if (buf) out.push(buf);
  return out.map(s => s.trim()).filter(s => {
    const n = s.split(' ').length;
    return s.length >= 35 && s.length <= 340 && n >= 6 && n <= 55 && !BOILER.test(s) && !/\?$/.test(s)
      && !/:$/.test(s) && (s.match(/\p{L}/gu) || []).length / s.length > 0.68 && /[.!?"”)]$/.test(s) && !/^(click|tap|press|please|note:|see also)\b/i.test(s);
  });
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' };
const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

// Pull the readable body text out of an HTML page.
function extractText(html) {
  html = String(html || '').slice(0, 600000)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template|figure|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = (html.match(/<(article|main)\b[\s\S]*?<\/\1>/i) || [html])[0];
  const paras = [];
  (main.match(/<(p|li|h[1-3]|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi) || []).forEach(b => {
    const t = clean(b); if (t.length > 50) paras.push(t);
  });
  return paras.join(' ');
}

// ---------- question understanding ----------
function intent(q) {
  const s = q.toLowerCase().trim();
  if (/^why\b|\bcauses? of\b|\breasons?\b/.test(s)) return 'why';
  if (/\b(when|what year|what date|which year)\b/.test(s)) return 'when';
  if (/\bhow (many|much|long|far|old|tall|big|fast|high|large)\b|\b(population|price|cost|distance|height|age|speed|size)\b/.test(s)) return 'number';
  if (/^who\b|\bwho (is|was|were|are)\b|\bfounder|\binvented\b/.test(s)) return 'who';
  if (/^how (to|do|does|can|should)\b|\bsteps?\b|\bguide\b|\btutorial\b/.test(s)) return 'how';
  if (/^(what|who) (is|are|was|were)\b|\bdefin(e|ition)|\bmeaning of\b|\bwhat does .* mean\b/.test(s) || (!/^(how|which|where|can|is|are|do|does|did|should)\b/.test(s) && s.split(/\s+/).length <= 4)) return 'define';
  return 'generic';
}
const fitBonus = (s, kind) => {
  switch (kind) {
    case 'when': return (/\b(1[0-9]{3}|20[0-9]{2})\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(s) ? 1 : 0) + (/\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b|\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}\b/.test(s) ? 0.6 : 0);
    case 'number': return /\d/.test(s) ? 1 : 0;
    case 'who': return /\b(is|was|were|are) (an?|the)\b|\b(born|founded|known|american|british|german|french|chinese|japanese)\b/i.test(s) ? 1 : 0;
    case 'define': return /\b(is|are|was|refers to|means|defined as|known as|describes?) (an?|the|any|a type of|one of|used)?/i.test(s) && /^.{0,60}?\b(is|are|was|refers to|means)\b/i.test(s) ? 1 : 0;
    case 'how': return /\b(first|then|next|you can|use|make sure|step|start by)\b/i.test(s) ? 1 : 0;
    case 'why': return /\b(because|due to|caused|result(s|ed)? (in|from)|leads? to|reason|since)\b/i.test(s) ? 1 : 0;
    default: return 0;
  }
};

// ---------- paraphrasing: Nano writes the answer in its own words, not a verbatim quote ----------
const SYN = {
  important: ['notable', 'significant', 'key'], big: ['large', 'major', 'substantial'],
  shows: ['indicates', 'reveals', 'suggests'], said: ['stated', 'noted', 'explained'],
  made: ['created', 'built', 'developed'], uses: ['relies on', 'makes use of', 'employs'],
  helps: ['assists with', 'supports'], also: ['additionally', 'as well'],
  because: ['since', 'as'], many: ['numerous', 'a number of'], very: ['particularly', 'especially'],
  began: ['started'], contains: ['includes', 'holds'], allows: ['lets', 'enables'],
  known: ['recognised', 'regarded'], today: ['currently', 'now'], mostly: ['largely', 'mainly']
};
let seed = 1;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
function varyWord(w) {
  const opts = SYN[w.toLowerCase()];
  if (!opts || rand() > 0.45) return w;
  const pick = opts[Math.floor(rand() * opts.length)];
  return /^[A-Z]/.test(w) ? pick.charAt(0).toUpperCase() + pick.slice(1) : pick;
}
function paraphrase(sentence) {
  let s = sentence.replace(/^(however|moreover|furthermore|additionally|also|in addition|meanwhile|thus|therefore|so|and|but),?\s+/i, '');
  s = s.replace(/\b[\p{L}']+\b/gu, w => (/^[A-Z]/.test(w) || w.length < 4) ? w : varyWord(w)); // skip proper nouns & short words
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- scoring ----------
const cos = (a, b) => { // cosine over term-frequency maps
  let d = 0, na = 0, nb = 0;
  a.forEach((v, k) => { na += v * v; if (b.has(k)) d += v * b.get(k); });
  b.forEach(v => { nb += v * v; });
  return na && nb ? d / Math.sqrt(na * nb) : 0;
};
const tf = arr => { const m = new Map(); arr.forEach(t => m.set(t, (m.get(t) || 0) + 1)); return m; };

/**
 * docs: [{ cite: Number|null, title, text, rank }]  (rank 0 = best search result)
 * returns { text, provider } or { error }
 */
function answer(query, docs, opts = {}) {
  const maxWords = opts.maxWords || 105;
  const qt = [...new Set(terms(query))];
  if (!qt.length) return { error: 'Query too short' };
  const kind = intent(query);

  // 1. candidate sentences
  let S = [];
  docs.forEach((d, di) => sentences(d.text).slice(0, 60).forEach((s, si) => {
    const t = terms(s); if (t.length < 4) return;
    S.push({ s, t, v: tf(t), di, si, cite: d.cite, rank: d.rank ?? di, len: t.length });
  }));
  if (!S.length) return { error: 'No readable text' };

  // 2. BM25 over sentences
  const N = S.length, df = new Map(), avg = S.reduce((a, x) => a + x.len, 0) / N;
  S.forEach(x => new Set(x.t).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
  const idf = t => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  const k1 = 1.4, b = 0.7;
  S.forEach(x => {
    let sc = 0, hit = 0;
    qt.forEach(t => { const f = x.v.get(t) || 0; if (f) { hit++; sc += idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * x.len / avg)); } });
    x.bm = sc; x.cov = hit / qt.length;
  });
  const maxBm = Math.max(...S.map(x => x.bm)) || 1;

  // 3. centrality: sentences that agree with many others (across sources) are likely the consensus facts
  const top = S.filter(x => x.cov > 0).sort((a, b) => b.bm - a.bm).slice(0, 80);
  if (!top.length) return { error: 'Sources do not mention the query' };
  top.forEach(x => {
    let c = 0; top.forEach(y => { if (y !== x && y.di !== x.di) c += cos(x.v, y.v) > 0.35 ? 1 : 0; });
    x.cent = Math.min(c, 4) / 4;
  });

  // 4. final score
  top.forEach(x => {
    const lead = x.si === 0 ? 0.12 : x.si < 3 ? 0.06 : 0;
    const srcRank = 0.12 / (1 + x.rank);
    const pron = /^(he|she|they|it|this|that|these|those|however|but|and|also|additionally)\b/i.test(x.s) ? -0.1 : 0; // needs earlier context
    const second = /\b(you|your)\b/i.test(x.s) && kind !== 'how' ? -0.1 : 0;
    x.score = 0.5 * (x.bm / maxBm) + 0.2 * x.cov + 0.12 * x.cent + 0.14 * fitBonus(x.s, kind) + lead + srcRank + pron + second;
  });

  // 5. pick with MMR so the answer isn't the same fact repeated
  const picked = [];
  let words = 0, pool = top.slice().sort((a, b) => b.score - a.score);
  const CAP = { define: 4, generic: 4, how: 5, why: 3, when: 2, number: 2, who: 3 }[kind], REL = ['define', 'generic', 'how'].includes(kind) ? 0.5 : 0.65;
  const topScore = pool.length ? pool[0].score : 0;
  while (pool.length && picked.length < CAP) {
    let best = null, bv = -1;
    for (const x of pool.slice(0, 25)) {
      if (picked.length && x.score < REL * topScore) continue;
      const red = picked.reduce((m, p) => Math.max(m, cos(x.v, p.v)), 0);
      const perDoc = picked.filter(p => p.di === x.di).length;
      const v = 0.72 * x.score - 0.28 * red - (perDoc >= 2 ? 0.2 : 0);
      if (red < 0.62 && v > bv) { bv = v; best = x; }
    }
    if (!best) break;
    const w = best.s.split(' ').length;
    pool = pool.filter(x => x !== best);
    if (picked.length && words + w > maxWords) { if (words > maxWords * 0.6) break; continue; }
    best.cites = [best.cite]; picked.push(best); words += w;
  }
  if (!picked.length) return { error: 'No answer found' };

  // corroboration: other sources saying nearly the same thing get cited too
  picked.forEach(p => S.forEach(o => {
    if (o.cite && o.di !== p.di && !p.cites.includes(o.cite) && p.cites.length < 3 && cos(p.v, o.v) > 0.55) p.cites.push(o.cite);
  }));

  // 6. confidence: do the chosen sentences actually cover the question?
  const covered = new Set(); picked.forEach(p => qt.forEach(t => p.v.has(t) && covered.add(t)));
  const confidence = covered.size / qt.length;

  // 7. compose freely: Nano writes the answer in its own words, stitched into flowing prose,
  // instead of quoting each source sentence verbatim with an inline citation.
  const PRON = /^(he|she|they|it|this|that|these|those)\b/i;
  const pi = picked.findIndex(p => !PRON.test(p.s)); if (pi > 0 && PRON.test(picked[0].s)) picked.unshift(picked.splice(pi, 1)[0]);
  const lead = picked[0], rest = picked.slice(1);
  if (['define', 'generic', 'how'].includes(kind)) rest.sort((a, b) => a.rank - b.rank || a.si - b.si);
  const CONNECT = ['Also,', 'On top of that,', "It's also worth noting that", 'Beyond that,', 'Worth adding:'];
  seed = qt.length + picked.length; // deterministic per-answer, not per-process
  const parts = [lead, ...rest].map((p, i) => {
    const s = paraphrase(p.s);
    return i === 0 ? s : CONNECT[(i - 1) % CONNECT.length] + ' ' + s.charAt(0).toLowerCase() + s.slice(1);
  });
  let text = parts.join(' ');
  const allCites = [...new Set([lead, ...rest].flatMap(p => p.cites).filter(Boolean))];
  if (allCites.length) text += '\n\nSources: ' + allCites.map(c => `[${c}]`).join(' ');
  if (confidence < 0.5) text = "The sources only partly cover this, but here's my best answer:\n" + text;
  return { text, confidence, intent: kind, sentences: picked.length };
}

// ---------- self-knowledge: Nano knows what it is ----------
const KB = {
  nano: 'Nano is a fast, private desktop web browser made by VANTA. It has tabs, a sidebar for history and bookmarks, optional local accounts, and a start page where you pick your search engine: Nano Seek, Google, DuckDuckGo, Bing or Brave. Everything it stores (history, bookmarks, settings) stays on your own device.',
  seek: 'Nano Seek is Nano\'s own search engine. It searches DuckDuckGo, Mojeek and Wikipedia at the same time and merges the results into one ranked list, adds a Wikipedia knowledge card when the topic has one, and writes an AI overview with Nano AI. It needs no account, no API keys and does not track you.',
  brain: 'Nano AI is Nano\'s own built-in AI, and it runs entirely on your device, with no third-party AI service, no API keys and no usage limits. It reads the top search results, scores every sentence for how well it answers your question, then writes the overview in its own words, with the sources it drew on listed at the end. Every claim still traces back to a real source, so it can\'t invent facts, but it is not a large language model, so it summarises rather than reasons. You can also talk to it in the Nano AI chat on the new tab page.',
  vanta: 'Nano, Nano Seek and Nano AI are all made by VANTA.',
  privacy: 'Nano keeps your history, bookmarks and accounts on your own device. Account passwords are salted and hashed with scrypt, Nano Seek has no tracking, and Nano AI runs locally, so the only network traffic is loading the search results and the pages you visit.',
  shortcuts: 'Nano shortcuts: Ctrl+T new tab, Ctrl+W close tab, Ctrl+L address bar, Ctrl+R or F5 reload, Ctrl+Tab next tab, Ctrl+1 to 9 jump to a tab, Alt+Left and Alt+Right back and forward.',
  chat: 'The Nano AI chat is pinned on the new tab page. Ask it anything and it searches the web, reads the best pages and answers with citations. It also does maths, tells the time and date, and remembers what you were just talking about, so you can ask follow-ups like "how tall is it?".'
};
const OTHER_NANO = /\b(editor|linux|gnu|ubuntu|command|terminal|crypto|coin|xno|banana|ram|ssd|nvme|tech|technology|particles?|meters?|metres?|seconds?|second|wrestling|tutorial|install|vim|mac|windows|bash|file|config)\b/i;
function selfTopic(query) {
  const w = toks(query);
  if (!w.includes('nano') || OTHER_NANO.test(query)) return null;
  const has = re => w.some(x => re.test(x));
  if (has(/^(brain|ai|overview|intelligence|chatbot|llm|model|summar\w*|answer\w*)$/)) return 'brain';
  if (has(/^(seek|search|engine)$/)) return 'seek';
  if (has(/^(vanta|made|maker|creator|created|developer|developers|company|author|owner)$/)) return 'vanta';
  if (has(/^(shortcuts?|hotkeys?|keyboard|keys)$/)) return 'shortcuts';
  if (has(/^(priva\w*|safe|secure|security|tracking|data)$/)) return 'privacy';
  if (has(/^(chat|talk|assistant)$/)) return 'chat';
  return 'nano';
}
function selfAnswer(query) {
  const t = selfTopic(query);
  if (!t) return null;
  let text = KB[t];
  if (t === 'nano') text += '\nIts search engine is Nano Seek, and its built-in AI is Nano AI.';
  return { text, provider: 'Nano (built-in knowledge)', self: true };
}

// ---------- tiny local skills for the chat: maths, time, small talk ----------
function calc(src) { // safe arithmetic: + - * / % ^ ( ) and unary minus, no eval
  const t = src.match(/\d+\.?\d*|\.\d+|[-+*/%^()]/g); if (!t || t.join('').length < src.replace(/\s/g, '').length) return null;
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const prim = () => { const x = next(); if (x === '(') { const v = add(); if (next() !== ')') throw 0; return v; } if (x === '-') return -pow(); if (x === '+') return pow(); if (x === undefined || !/^[\d.]/.test(x)) throw 0; return parseFloat(x); };
  const pow = () => { const b = prim(); if (peek() === '^') { next(); return Math.pow(b, pow()); } return b; };
  const mul = () => { let v = pow(); while (/^[*/%]$/.test(peek() || '')) { const o = next(), r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
  const add = () => { let v = mul(); while (/^[+-]$/.test(peek() || '')) { const o = next(), r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = add(); return i === t.length && Number.isFinite(v) ? v : null; } catch { return null; }
}
const fmtNum = v => Number.isInteger(v) ? String(v) : String(+v.toPrecision(12));
function maths(msg) {
  let s = msg.toLowerCase().replace(/^(what('| i)?s|what is|calculate|calc|compute|solve|how much is)\s+/, '').replace(/[?=]+$/, '')
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\b(times|multiplied by)\b/g, '*').replace(/\b(divided by|over)\b/g, '/').replace(/\bto the power of\b/g, '^')
    .replace(/(\d)\s*[x×]\s*(\d)/g, '$1*$2').replace(/÷/g, '/').replace(/,(?=\d{3}\b)/g, '').replace(/(\d+\.?\d*)\s*%\s*of\s*(\d+\.?\d*)/, '($1/100)*$2');
  if (!/\d/.test(s) || !/^[\d\s+\-*/%^().]+$/.test(s) || !/[+\-*/%^]/.test(s.replace(/^\s*-/, ''))) return null;
  const v = calc(s.replace(/\s+/g, '')); return v === null ? null : fmtNum(v);
}
function local(msg, now = new Date()) {
  const m = msg.trim(), s = m.toLowerCase().replace(/[!?.,]+$/g, '').trim();
  if (/^(hi|hello|hey|yo|hola|salut|sup|good (morning|afternoon|evening))\b( there| nano| nano ai)?$/.test(s)) return "Hi! I'm Nano AI. Ask me anything and I'll search the web and answer with sources, or ask me for a calculation, the time, or about Nano.";
  if (/^(thanks|thank you|thx|ty|cheers|great|nice|cool|awesome)\b/.test(s)) return "You're welcome! Ask me anything else whenever you like.";
  if (/\b(who|what) are you\b|\byour name\b|\bwhat can you do\b|^help$|\bintroduce yourself\b/.test(s)) return "I'm Nano AI, the AI built into the Nano browser by VANTA. I search the web, read the best pages and answer with numbered sources. I can also do maths, tell you the time and date, and follow up on what we were just talking about.";
  if (/\b(who|what company) (made|built|created|developed|owns)\b.*\b(you|nano)\b|\bwho is your (creator|maker|developer)\b/.test(s)) return KB.vanta;
  if (/\b(chatgpt|gpt|openai|llm|language model|gemini|claude|are you (an )?ai|how do you work|how are you built|are you real)\b/.test(s) && /\b(you|your)\b/.test(s)) return KB.brain;
  if (/\bwhat('?s| is) (the )?(current )?(time|date|day)\b|\bwhat time is it\b|\btoday'?s date\b|\bwhat day is it\b/.test(s)) {
    const d = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), t = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return /time/.test(s) ? `It's ${t} on ${d}.` : `Today is ${d}.`;
  }
  const mv = maths(m); if (mv !== null) return m.replace(/[?=\s]+$/, '').replace(/^(what('| i)?s|what is|calculate|calc|compute|solve|how much is)\s+/i, '') + ' = ' + mv;
  const sa = selfAnswer(m); if (sa) return sa.text;
  return null;
}
// Follow-ups like "how tall is it?" borrow the topic of the previous question.
function contextQuery(msg, prev) {
  msg = msg.trim(); if (!prev) return msg;
  const mt = terms(msg), n = mt.length, pt = new Set(terms(prev));
  if (mt.some(t => pt.has(t))) return msg; // already names the topic
  const ref = /\b(it|its|it's|he|him|his|she|her|they|them|their|that|this|these|those|there|one)\b/i.test(msg);
  const bare = /^(and|what about|how about|why|how|when|where|who|which)\b/i.test(msg) && n <= 3;
  return (ref || bare || n <= 1) && n <= 6 ? prev + ' ' + msg.replace(/\b(it|its|it's|he|him|his|she|her|they|them|their|that|this|these|those)\b/gi, ' ').replace(/[?!]+/g, ' ').replace(/\s+/g, ' ').trim() : msg;
}

module.exports = { answer, extractText, sentences, terms, intent, selfAnswer, local, contextQuery };

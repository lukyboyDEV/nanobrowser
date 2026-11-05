// Nano AI local models (GGUF via node-llama-cpp). Models download on demand into the user's data folder. No API key, no cost.
const path = require('path'), fs = require('fs'), https = require('https');
const MODELS = {
  lite: { name: 'Nano NEURA 1 lite', note: 'Fast', mb: 1100, file: 'neura-1-lite.gguf', url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' },
  neura: { name: 'Nano NEURA 1', note: 'Smarter', mb: 2100, file: 'neura-1.gguf', url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf' }
};
let dir = '';
const init = d => { dir = d; fs.mkdirSync(dir, { recursive: true }); };
const file = id => path.join(dir, MODELS[id].file);
const installed = id => { try { return fs.statSync(file(id)).size > MODELS[id].mb * 1e6 * 0.8; } catch { return false; } };
const list = () => Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name, note: m.note, mb: m.mb, installed: installed(id) }));

const dl = new Map();
function download(id, onProgress) {
  if (!MODELS[id]) return Promise.reject(new Error('unknown model'));
  if (dl.has(id)) return dl.get(id);
  const out = file(id), tmp = out + '.part';
  const p = new Promise((resolve, reject) => {
    const get = (u, n = 0) => https.get(u, { headers: { 'User-Agent': 'nano' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 8) { r.resume(); return get(new URL(r.headers.location, u).href, n + 1); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const total = +r.headers['content-length'] || MODELS[id].mb * 1e6; let got = 0, last = 0;
      const ws = fs.createWriteStream(tmp);
      r.on('data', c => { got += c.length; if (Date.now() - last > 400) { last = Date.now(); onProgress && onProgress(id, got / total); } });
      r.pipe(ws); ws.on('finish', () => { fs.renameSync(tmp, out); onProgress && onProgress(id, 1); resolve(); });
      r.on('error', reject); ws.on('error', reject);
    }).on('error', reject);
    get(MODELS[id].url);
  }).finally(() => dl.delete(id));
  dl.set(id, p); return p;
}

let cur = null, queue = Promise.resolve(), session = null;
async function load(id) {
  if (cur && cur.id === id) return cur.p;
  if (cur) { const old = cur.p; old.then(x => x.model.dispose()).catch(() => {}); }
  const p = (async () => {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama(); const model = await llama.loadModel({ modelPath: file(id) });
    return { LlamaChatSession, model, context: await model.createContext({ contextSize: 4096 }) };
  })();
  cur = { id, p }; p.catch(() => { if (cur && cur.p === p) cur = null; });
  return p;
}
// history: [{role:'user'|'assistant', text}] -> reply text. Serialized: one answer at a time.
function reply(id, history, memory, onToken, signal) {
  if (!MODELS[id] || !installed(id)) return Promise.reject(new Error('not installed'));
  const job = queue.then(async () => {
    const { LlamaChatSession, context } = await load(id);
    const msgs = history.slice(-12), last = msgs.pop();
    if (!last || last.role !== 'user') throw new Error('no user message');
    const mem = (memory || []).slice(0, 40).map(m => '- ' + m.text).join('\n');
    const sys = `You are ${MODELS[id].name}, the friendly AI assistant built into the Nano browser by VANTA. You run fully on the user's device. Answer clearly and concisely. If you are unsure, say so instead of guessing.` + (mem ? `\nThings the user asked you to remember:\n${mem}` : '');
    if (session) { try { session.dispose({ disposeSequence: true }); } catch {} }
    session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: sys });
    session.setChatHistory([{ type: 'system', text: sys }, ...msgs.map(m => m.role === 'user' ? { type: 'user', text: m.text } : { type: 'model', response: [m.text] })]);
    return (await session.prompt(last.text, { maxTokens: 900, temperature: 0.6, onTextChunk: onToken, signal, stopOnAbortSignal: true })).trim();
  });
  queue = job.catch(() => {});
  return job;
}
module.exports = { MODELS, init, list, installed, download, reply };

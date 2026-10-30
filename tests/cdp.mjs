// Tiny CDP helper shared by smoke.mjs and ad-hoc debugging. Node ≥ 22 (--experimental-websocket).
import {spawn} from 'node:child_process';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function launch() {
  const dbg = 9300 + Math.floor(Math.random() * 400);
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, '--window-size=1920,1080', `--user-data-dir=/tmp/fw-cdp-${dbg}`, 'about:blank'], {stdio: 'ignore'});
  let url;
  for (let i = 0; i < 60 && !url; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((x) => x.type === 'page'); if (t) url = t.webSocketDebuggerUrl; } catch {} if (!url) await sleep(200); }
  if (!url) throw new Error('chrome did not start');
  const ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon/.test(d.params.entry.url || '')) errors.push(d.params.entry.text); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
  const ev = async (expr) => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error'); return r.result?.result?.value; };
  const open = async (u, wait = 2500) => { errors.length = 0; await send('Page.navigate', {url: u}); await sleep(wait); };
  const close = () => { try { ws.close(); } catch {} chrome.kill('SIGKILL'); };
  return {ev, open, send, errors, close};
}

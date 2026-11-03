// Takes the README screenshots from the running dev server with the made-up sample household.
// Usage: npm run dev (port 5173), then: node scripts/screenshots.mjs [path-to-chrome]
// Needs Node 22+ (built-in WebSocket) and Chrome or Edge.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.argv[2] ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://localhost:5173/minted/';
const OUT = new URL('../docs/screenshots/', import.meta.url);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'minted-shots-'))}`,
  '--hide-scrollbars',
  'about:blank',
]);

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    .then((r) => r.json())
    .then((list) => list.find((t) => t.type === 'page'))
    .catch(() => undefined);
}
if (!target) throw new Error('Chrome did not start');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};
const go = async (url) => {
  await send('Page.navigate', { url });
  await sleep(3000);
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

// Sample mode, plus statement / due days on the cards and the October paydays marked paid.
await go(APP);
await evaluate(`(async () => {
  const s = (await import('/minted/src/data/sample.json?import')).default;
  const rows = s.rolling.map((r) => [...r]);
  const notes = rows.map(() => []);
  const head = rows.findIndex((r) => (r[0] || '').trim() === 'Card Name');
  rows[head][5] = 'Statement Day';
  rows[head][6] = 'Due Day';
  const days = { 'BPI Ben': [13, 5], 'HomeCredit Ana': [11, 26], 'EastWest Ben': [12, 5], 'Maya Ben': [13, 3] };
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  for (let r = head + 1; r < rows.length; r++) {
    const d = days[(rows[r][0] || '').trim()];
    if (!d) continue;
    rows[r][5] = ord(d[0]);
    rows[r][6] = ord(d[1]);
    rows[r][3] = d[1] >= 15 && d[1] < 30 ? '15th Payday' : '30th Payday';
  }
  const ledgerEnd = head;
  for (let r = 0; r < ledgerEnd; r++) {
    if (!/payday|split|new goal/i.test(rows[r][0] || '')) continue;
    for (const col of [7, 8]) {
      const v = Number(String(rows[r][col] || '').replace(/[^0-9.]/g, ''));
      if (v > 0) notes[r][col] = 'Paid 2026-10-' + (col === 7 ? '15' : '30') + ' by Ana';
    }
  }
  localStorage.setItem('ledger.settings', JSON.stringify({ mode: 'demo', theme: 'dark', payer: 'Ana' }));
  localStorage.setItem('ledger.demo.grids', JSON.stringify({
    rolling: { rows, notes },
    goals: { rows: s.sheet2, notes: s.sheet2.map(() => []) },
  }));
})()`);

mkdirSync(OUT, { recursive: true });
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(data, 'base64'));
  console.log(`docs/screenshots/${name}.png`);
};

const at = (hash) => `${APP}?today=2026-11-03${hash}`;
await go(at('#/timeline/2026-10-30'));
await shot('timeline');
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Add bill or payment')).click()`);
await sleep(800);
await shot('add-bill');
await go(at('#/reports'));
await shot('reports');
await go(at('#/goals'));
await shot('goals');
await go(at('#/cards'));
await shot('cards');

ws.close();
browser.kill();

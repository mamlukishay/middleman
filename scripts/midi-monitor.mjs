#!/usr/bin/env node
// What is actually on the Mac's MIDI ports, and what is it saying.
//
//   node scripts/midi-monitor.mjs [--seconds 30] [--port 8840] [--headed] [--keep]
//
// This is a diagnostic, not a test. It knows nothing about the app: no room, no relay,
// no learn.html, no `window.__mm`. It opens one page for the sole reason that Web MIDI
// lives in a browser, wires every input port CoreMIDI offers, and prints every message
// that arrives for a window of seconds, decoded. When a device is plugged in and the
// question is "is this thing sending anything at all, and what", this answers it without
// the app in the way -- so a silence here is the device's silence, not a bug in ours.
//
// The page is a 404 from serve.py, which is the cheapest *served* empty document there
// is: about:blank is an opaque origin, and Web MIDI needs a secure context and an origin
// that `Browser.grantPermissions` can be aimed at. 127.0.0.1 is potentially trustworthy,
// so a served page on a loopback port qualifies without a certificate. The port is picked
// at or above 8840 to stay clear of his own server (8765), the smoke (8810) and
// measure-jam (8830), so this can run while any of them are up.
//
// Clock (0xF8) and active sensing (0xFE) are counted, never printed: a keyboard idling
// with sensing on sends about three a second and a running clock is twenty-four per beat,
// which would bury the one message you are looking for. Everything else gets a line.

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof WebSocket === 'undefined') {
  console.error(`No global WebSocket (Node ${process.version}); this needs Node >= 22.`);
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SECONDS = Number(opt('--seconds', 30));
const HEADED = args.includes('--headed');
const KEEP = args.includes('--keep');
const PROFILE = join(tmpdir(), `mm-midimon-${process.pid}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let server = null, chrome = null, PORT = 0, CDP_PORT = 0;

function killAll() {
  if (KEEP) { console.log(`\n(--keep: server on :${PORT}, Chrome on :${CDP_PORT} left running)`); return; }
  try { server?.kill(); } catch { /* already gone */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  try { execSync(`pkill -f "${PROFILE}"`, { stdio: 'ignore' }); } catch { /* none running */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* nothing to clean */ }
}
process.on('SIGINT', () => { killAll(); process.exit(130); });

const canBind = port => new Promise(res => {
  const s = createServer();
  s.once('error', () => res(false));
  s.listen(port, '127.0.0.1', () => s.close(() => res(true)));
});
async function freePort(from) {
  for (let p = from; p < from + 60; p += 1) if (await canBind(p) && await canBind(p + 1000)) return p;
  throw new Error(`no free port near ${from}`);
}

async function waitFor(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`nothing answering at ${url}`);
}

// ------------------------------------------------------------------ CDP (as smoke/measure-jam)
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, errors, close: () => ws.close() };
}

// ------------------------------------------------------------------ the tap, in the page
/**
 * Everything the browser side does. It opens Web MIDI, hooks every input, and buffers
 * what arrives; Node drains the buffer a few times a second and does all the decoding,
 * so the interesting logic stays here on this side of the wire where it can be read.
 *
 * `onstatechange` matters more than it looks: a device plugged in after the page loaded
 * arrives as a new port with no handler on it, which is exactly the case this file exists
 * for. Re-wiring on every state change means "plug it in now" works mid-run.
 */
const TAP = `(() => {
  const buf = [];
  const noisy = new Map();          // port name -> { clock, sensing }
  const M = window.__midimon = { buf, ready: false, error: null, ports: null, t0: performance.now(),
                                 events: [], hooked: new Set() };

  const bump = (name, kind) => {
    if (!noisy.has(name)) noisy.set(name, { clock: 0, sensing: 0 });
    noisy.get(name)[kind] += 1;
  };
  M.noisy = () => Object.fromEntries([...noisy.entries()].map(([k, v]) => [k, { ...v }]));

  const describe = p => ({ id: p.id, name: p.name || '(unnamed)', manufacturer: p.manufacturer || '',
                           state: p.state, connection: p.connection, version: p.version || '' });
  const snapshot = a => ({ inputs: [...a.inputs.values()].map(describe),
                           outputs: [...a.outputs.values()].map(describe) });

  const hook = (a) => {
    for (const p of a.inputs.values()) {
      if (M.hooked.has(p.id)) continue;
      M.hooked.add(p.id);
      // open() is not strictly required (assigning onmidimessage opens it) but a port that
      // is 'connected' rather than 'open' has bitten enough people to be worth the line.
      try { p.open(); } catch (e) { /* already opening */ }
      p.onmidimessage = e => {
        const d = Array.from(e.data);
        const s = d[0];
        if (s === 0xf8) return bump(p.name, 'clock');
        if (s === 0xfe) return bump(p.name, 'sensing');
        buf.push({ at: (Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now()) - M.t0,
                   port: p.name || p.id, data: d });
      };
    }
  };

  navigator.requestMIDIAccess({ sysex: true }).then(a => {
    M.access = a;
    hook(a);
    M.ports = snapshot(a);
    a.onstatechange = e => {
      const p = e.port;
      M.events.push({ at: performance.now() - M.t0, port: p.name || p.id, type: p.type,
                      state: p.state, connection: p.connection });
      hook(a);
      M.ports = snapshot(a);
    };
    M.ready = true;
  }, err => { M.error = err.name + ': ' + err.message; M.ready = true; });

  M.drain = () => { const out = buf.splice(0); return out; };
})();`;

// ------------------------------------------------------------------ decoding
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Middle C = 60 = C4, the convention Logic and most gear print. */
const noteName = n => `${NOTES[n % 12]}${Math.floor(n / 12) - 1}`;
const hex = d => d.map(b => b.toString(16).padStart(2, '0')).join(' ');

/** The three-byte "extended" ids start 00; everything else is one byte. */
function manufacturer(d) {
  if (d.length < 2) return 'none';
  if (d[1] === 0x7e) return '7E (non-commercial / universal non-realtime)';
  if (d[1] === 0x7f) return '7F (universal realtime)';
  if (d[1] !== 0x00) return hex([d[1]]).toUpperCase();
  return hex(d.slice(1, 4)).toUpperCase() + ' (extended)';
}

const SYSTEM = {
  0xf1: 'MTC quarter frame', 0xf2: 'song position', 0xf3: 'song select', 0xf6: 'tune request',
  0xf7: 'end of sysex', 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop', 0xff: 'system reset',
};

/** `kind` is what the summary counts by; `text` is the line. */
function decode(d) {
  const s = d[0];
  if (s === 0xf0) return { kind: 'sysex', text: `sysex, ${d.length} bytes, manufacturer ${manufacturer(d)}` };
  if (s >= 0xf0) return { kind: SYSTEM[s] ?? `system 0x${s.toString(16)}`,
                          text: SYSTEM[s] ?? `system message 0x${s.toString(16)}` };
  const ch = (s & 0x0f) + 1;
  const n = d[1], v = d[2];
  switch (s & 0xf0) {
    // a note-on with velocity 0 is a note-off; plenty of keyboards spell it that way
    case 0x90: return v > 0
      ? { kind: 'note on', text: `note on   ch${ch}  ${noteName(n)} (${n})  vel ${v}` }
      : { kind: 'note off', text: `note off  ch${ch}  ${noteName(n)} (${n})  vel 0 (note-on with velocity 0)` };
    case 0x80: return { kind: 'note off', text: `note off  ch${ch}  ${noteName(n)} (${n})  vel ${v}` };
    case 0xa0: return { kind: 'poly aftertouch', text: `poly aftertouch  ch${ch}  ${noteName(n)} (${n})  ${v}` };
    case 0xb0: return { kind: 'control change', text: `control change  ch${ch}  cc ${n}  value ${v}` };
    case 0xc0: return { kind: 'program change', text: `program change  ch${ch}  program ${n}` };
    case 0xd0: return { kind: 'channel pressure', text: `channel pressure  ch${ch}  ${n}` };
    case 0xe0: return { kind: 'pitch bend', text: `pitch bend  ch${ch}  ${((v << 7) | n) - 8192} (centre 0)` };
    default: return { kind: 'unknown', text: 'unrecognised status byte' };
  }
}

const pad = (s, n) => String(s).padEnd(n);

// ------------------------------------------------------------------ the run
async function main() {
  mkdirSync(PROFILE, { recursive: true });
  PORT = await freePort(Number(opt('--port', 8840)));
  CDP_PORT = PORT + 1000;
  const BASE = `http://127.0.0.1:${PORT}`;

  server = spawn('python3', ['serve.py', String(PORT), '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await waitFor(`${BASE}/relay/time`);

  chrome = spawn(CHROME, [
    ...(HEADED ? [] : ['--headless=new']),
    '--mute-audio',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--disable-gpu',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);

  // The grant has to land before the document that asks, and Chrome 124+ prompts for
  // plain MIDI as well as sysex -- a prompt nothing can click is a silent refusal.
  const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.send('Browser.grantPermissions', { origin: BASE, permissions: ['midi', 'midiSysex'] });

  const targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page');
  const c = await connect(targets[0].webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: TAP });

  const ev = async expr => {
    const r = await c.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  // A 404 from serve.py: a served document on a trustworthy origin, with none of the app in it.
  await c.send('Page.navigate', { url: `${BASE}/__midi-monitor__` });
  await sleep(900);

  for (let i = 0; i < 40 && !(await ev('return !!(window.__midimon && window.__midimon.ready);')); i++) await sleep(250);
  const state = await ev('return { error: __midimon.error, ports: __midimon.ports };');
  if (state.error) throw new Error(`Web MIDI refused: ${state.error}`);
  if (!state.ports) throw new Error('Web MIDI never resolved (no ports snapshot)');

  // ---------------------------------------------------------------- what is there
  console.log(`Chrome ${HEADED ? 'headed' : 'headless=new'} · page ${BASE}/__midi-monitor__\n`);
  const list = (label, ps) => {
    console.log(`${label} (${ps.length})`);
    if (!ps.length) console.log('  (none)');
    for (const p of ps)
      console.log(`  ${pad(p.name, 34)} ${pad(p.manufacturer || '(no manufacturer)', 24)} `
        + `state ${pad(p.state, 12)} connection ${p.connection}`);
    console.log('');
  };
  list('MIDI inputs', state.ports.inputs);
  list('MIDI outputs', state.ports.outputs);

  // ---------------------------------------------------------------- listen
  console.log(`Listening for ${SECONDS}s. Play something / touch the device now.`);
  console.log('  (clock 0xF8 and active sensing 0xFE are counted, not printed)\n');

  const seen = new Map();           // port name -> Map(kind -> count)
  const count = (port, kind) => {
    if (!seen.has(port)) seen.set(port, new Map());
    const m = seen.get(port);
    m.set(kind, (m.get(kind) ?? 0) + 1);
  };

  const t0 = Date.now();
  let total = 0, nextTick = 5000;
  while (Date.now() - t0 < SECONDS * 1000) {
    const batch = await ev('return __midimon.drain();');
    for (const m of batch) {
      const d = decode(m.data);
      count(m.port, d.kind);
      total += 1;
      console.log(`${pad(Math.round(m.at) + ' ms', 9)} ${pad(m.port, 26)} ${pad(hex(m.data.slice(0, 12)) + (m.data.length > 12 ? ' …' : ''), 40)} ${d.text}`);
    }
    const elapsed = Date.now() - t0;
    if (elapsed > nextTick) {
      console.log(`  — ${Math.max(0, SECONDS - Math.round(elapsed / 1000))}s left, ${total} message${total === 1 ? '' : 's'} so far —`);
      nextTick += 5000;
    }
    await sleep(120);
  }
  for (const m of await ev('return __midimon.drain();')) {     // whatever landed in the last tick
    const d = decode(m.data);
    count(m.port, d.kind); total += 1;
    console.log(`${pad(Math.round(m.at) + ' ms', 9)} ${pad(m.port, 26)} ${pad(hex(m.data.slice(0, 12)) + (m.data.length > 12 ? ' …' : ''), 40)} ${d.text}`);
  }

  // ---------------------------------------------------------------- summary
  const noisy = await ev('return __midimon.noisy();');
  const changes = await ev('return __midimon.events;');
  const ports = (await ev('return __midimon.ports;')) ?? state.ports;

  console.log(`\n--- ${SECONDS}s summary — ${total} message${total === 1 ? '' : 's'} printed ---\n`);
  for (const p of ports.inputs) {
    const kinds = seen.get(p.name);
    const n = noisy[p.name];
    const hidden = n ? n.clock + n.sensing : 0;
    if (!kinds && !hidden) { console.log(`${p.name}: sent nothing at all.`); continue; }
    console.log(`${p.name}:`);
    for (const [kind, k] of [...(kinds ?? new Map())].sort((a, b) => b[1] - a[1]))
      console.log(`  ${pad(kind, 20)} ${k}`);
    if (n?.clock) console.log(`  ${pad('clock (0xF8)', 20)} ${n.clock}  (not printed)`);
    if (n?.sensing) console.log(`  ${pad('active sensing (0xFE)', 20)} ${n.sensing}  (not printed)`);
  }
  if (!ports.inputs.length) console.log('There were no MIDI inputs at all, so nothing could have arrived.');

  if (changes.length) {
    console.log('\nport state changes during the window:');
    for (const e of changes)
      console.log(`  ${pad(Math.round(e.at) + ' ms', 9)} ${pad(e.port, 26)} ${e.type} ${e.state} / ${e.connection}`);
  }

  const errs = c.errors;
  if (errs.length) console.log(`\nconsole errors: ${errs.slice(0, 3).join(' | ')}`);

  if (!KEEP) { c.close(); browser.close(); }
}

main()
  .catch(err => { console.error('\nfailed: ' + err.message); process.exitCode = 1; })
  .finally(() => { killAll(); process.exit(process.exitCode ?? 0); });

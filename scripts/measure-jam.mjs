#!/usr/bin/env node
// What the jam actually costs, with a real piano on the end of it.
//
// `npm run smoke` proves the jam *works* -- a note played on one tab comes out of the
// other -- but it injects its notes with `__mm.receive`, so every number it could give
// you is a number about JavaScript. This asks the other question: a hand on a real key,
// how long until that note leaves the app at the far end, and how much of the 30 ms
// hold was still left when it got there.
//
//   node scripts/measure-jam.mjs [--seconds 30] [--port 8830] [--room measure1]
//                                [--inject 2000] [--self] [--headed] [--keep] [--out DIR]
//
// The arrangement, which is the whole design of this file:
//
//   Tab A  http://127.0.0.1:PORT   the pianist. Real MIDI in from the piano. Out set to
//                                  Computer at volume 0, so A is silent and never drives
//                                  the piano from the keys the pianist is already under.
//   Tab B  http://localhost:PORT   the partner. A second *origin* is the closest one
//                                  browser gets to a second machine (its own localStorage,
//                                  so it inherits nothing), and its Out is the piano. B is
//                                  the leg being measured: relay in -> hold -> output.send.
//
// B's hardware MIDI input is recorded and then swallowed before the page sees it. B is
// standing in for a machine in another room that has no piano under its hands, and a B
// that forwarded the keys would send every note back to A a second time -- twice the
// relay traffic and an echo out of A's speakers. Swallowing it keeps the pretence honest
// *and* buys the best number in the file: B sees the same physical key-down that A does,
// on B's own clock, so `key-down -> output.send` can be read off one clock with no
// agreed-clock arithmetic anywhere in it.
//
// Two things here are played by nobody. `--inject` has B play a note every couple of
// seconds through `__mm.receive`, because B has no keys and the B->A leg needs traffic;
// `--self` fakes a key-down at *both* tabs' MIDI input port, which is what a real key is
// -- one event A forwards to the app and B only witnesses. Together they fill every
// column with no pianist in the room, which is how this file is checked against the
// smoke's loopback figures (about 2 ms for the POST, about 28 ms of hold left).
//
// What this measures and what a pianist hears are not the same number, and the table
// says so in two rows. `output.send` is where the app's work ends; the note is handed to
// CoreMIDI with a timestamp in the near future and *sounds* at that timestamp, which is
// the "scheduled to sound" row and is what the ear is waiting for. Everything after it --
// the USB interface, the piano's own sample engine, the speaker -- is downstream of
// anything a browser can see, and both ends of the pianist's own key are downstream too:
// the delay from his finger to the MIDI packet is the piano's, not the app's. So read
// these as "what the jam added", not "what it felt like".
//
// Web MIDI: `--headless=new` enumerates CoreMIDI fine on macOS once CDP has granted
// `midi` and `midiSysex` for the origin (Chrome 124+ prompts for plain MIDI too, and a
// headless prompt is a silent refusal). Verified against a DOREMiDi interface. `--headed`
// is there for the day a Chrome release changes its mind.

import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
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
/** src/learn/jam.js's HOLD_MS. Only used to label the table; nothing here depends on it. */
const HOLD_MS = 30;
/** Scratch, not the repo: these are runs, not results. `--out` puts them somewhere else. */
const DEFAULT_OUT = '/Users/mamlukishay/.claude/jobs/57b589d0/tmp';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const SECONDS = Number(opt('--seconds', 30));
const ROOM = opt('--room', 'measure1');
const INJECT = Number(opt('--inject', 2000));      // 0 turns the reverse direction off
const SELF = args.includes('--self');
const HEADED = args.includes('--headed');
const KEEP = args.includes('--keep');
const OUT_DIR = opt('--out', DEFAULT_OUT);
const PROFILE = join(tmpdir(), `mm-measure-${process.pid}`);

let server = null, chrome = null, PORT = 0, CDP_PORT = 0;

function killAll() {
  if (KEEP) { console.log(`\n(--keep: server on :${PORT}, Chrome on :${CDP_PORT} left running)`); return; }
  try { server?.kill(); } catch { /* already gone */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  try { execSync(`pkill -f "${PROFILE}"`, { stdio: 'ignore' }); } catch { /* none running */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* nothing to clean */ }
}
process.on('SIGINT', () => { killAll(); process.exit(130); });

/** A port nothing is listening on -- his own server is usually on 8765 and the smoke's on 8810. */
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

async function poll(fn, pass, ms, step = 250) {
  const t0 = Date.now();
  let v;
  do {
    try { v = await fn(); } catch { v = undefined; }
    if (pass(v)) return { ok: true, v };
    await sleep(step);
  } while (Date.now() - t0 < ms);
  return { ok: false, v };
}

// ------------------------------------------------------------------ CDP, as the smoke does
/** A CDP connection to one target: evaluate, navigate, click, console errors. */
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

async function attach(target, role) {
  const c = await connect(target.webSocketDebuggerUrl);
  const { send } = c;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // Before app.js, not after: the wrappers below have to be on the prototypes the page is
  // about to build its relay and its MIDI ports out of.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: tapSource(role) });
  return {
    role, errors: c.errors,
    async goto(url, wait = 1500) { await send('Page.navigate', { url }); await sleep(wait); },
    async ev(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** A real, trusted click -- the AudioContext refuses a synthetic one. */
    async click(sel) {
      const box = await this.ev(`const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return null; e.scrollIntoView?.({ block: 'center' }); const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
      if (!box) throw new Error('no element ' + sel);
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(80);
    },
    close: c.close,
  };
}

// ------------------------------------------------------------------ the taps, in the page
/**
 * Everything this file measures, it measures by wrapping something the app was already
 * going to call -- no app code knows this is here, and none of it is a timer of ours.
 *
 *   in     a MIDI message off the wire, with the MIDI subsystem's own timestamp for the
 *          key-down (`midiT`) rather than the moment our callback ran.
 *   post   a live jam note leaving on a POST, with the relay-time stamp (`t`) that is
 *          the join key between the two tabs, and when the POST came back.
 *   recv   a live jam note arriving on the EventSource. Recorded *after* the page's own
 *          handler has run, so `jam.last` is this note's -- `playAt` and `wait` are the
 *          app's own scheduling decision read back, not a re-implementation of it.
 *   port   MIDIOutput.send actually called: `at` is when, `ts` is the moment it was
 *          asked to sound. Nested inside the `recv` that caused it.
 */
const tapSource = role => `(() => {
  const E = [];
  const now = () => performance.now();
  window.__mj = { role: ${JSON.stringify(role)}, ev: E, at: () => now() };

  /** Wrap an on-event property, wherever up the chain it is actually defined. */
  const wrapProp = (proto, name, wrap) => {
    let d = null, o = proto;
    while (o && !(d = Object.getOwnPropertyDescriptor(o, name))) o = Object.getPrototypeOf(o);
    if (!d || !d.set) return false;
    Object.defineProperty(proto, name, {
      configurable: true, enumerable: true,
      get() { return d.get.call(this); },
      set(fn) { d.set.call(this, typeof fn === 'function' ? wrap.call(this, fn) : fn); },
    });
    return true;
  };
  const isNote = d => d && ((d[0] & 0xf0) === 0x90 || (d[0] & 0xf0) === 0x80);

  // ---- notes arriving over the relay
  window.__mj.esWrapped = typeof EventSource !== 'undefined' && wrapProp(EventSource.prototype, 'onmessage', fn => function (m) {
    let ev = null; try { ev = JSON.parse(m.data); } catch (e) { /* not ours */ }
    const live = !!(ev && ev.type === 'note' && ev.live);
    const at = now(), i0 = E.length;
    const r = fn.call(this, m);
    if (live) {
      // whatever the page pushed while it handled this note belongs to this note
      const during = E.splice(i0), ports = during.filter(x => x.k === 'port');
      for (const x of during) if (x.k !== 'port') E.push(x);
      const last = window.__mm && window.__mm.jam && window.__mm.jam.last;
      E.push({ k: 'recv', at, t: ev.t, from: ev.from, data: ev.data, ports,
               playAt: last ? last.at : null, wait: last ? last.wait : null });
    }
    return r;
  });

  // ---- notes leaving on a POST
  const F = window.fetch;
  window.fetch = function (input, init) {
    let body = null;
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (init && init.body && url.indexOf('/relay/send') >= 0) { try { body = JSON.parse(init.body); } catch (e) { /* not ours */ } }
    if (!body || body.type !== 'note' || !body.live) return F.apply(this, arguments);
    const rec = { k: 'post', at: now(), done: null, t: body.t, data: body.data };
    E.push(rec);
    return F.apply(this, arguments).then(
      r => { rec.done = now(); return r; },
      e => { rec.done = now(); rec.err = 1; throw e; });
  };

  // ---- the far end of the leg: the note handed to the port
  if (typeof MIDIOutput !== 'undefined') {
    const S = MIDIOutput.prototype.send;
    MIDIOutput.prototype.send = function (data, ts) {
      if (isNote(data)) E.push({ k: 'port', at: now(), ts: ts === undefined ? null : ts,
                                 data: Array.from(data), port: this.name });
      return S.apply(this, arguments);
    };
    window.__mj.portWrapped = true;
  }

  // ---- the piano's keys. B records them and stops there (see the header).
  // The wrapper lives on the *handler*, so only a port the page actually wired is tapped
  // -- and only that port is the piano as far as this page is concerned. A second
  // requestMIDIAccess hands back different MIDIInput objects with no handler on them, so
  // the port to fake a key on is caught here, on the way past, rather than looked up later.
  window.__mj.firstIn = null;
  window.__mj.inWrapped = typeof MIDIInput !== 'undefined' && wrapProp(MIDIInput.prototype, 'onmidimessage', function (fn) {
    if (!window.__mj.firstIn) window.__mj.firstIn = this;
    return function (e) {
      if (isNote(e.data)) E.push({ k: 'in', at: now(), midiT: e.timeStamp, data: Array.from(e.data), port: this.name });
      ${role === 'B' ? 'return;   // a machine in another room has no piano under its hands' : 'return fn.call(this, e);'}
    };
  });

  /** A note this tab did not really play, for the leg that has no pianist on it. */
  window.__mj.inject = every => {
    const notes = [60, 64, 67, 72];
    let i = 0;
    window.__mj.timer = setInterval(() => {
      const n = notes[i++ % notes.length];
      E.push({ k: 'inject', at: now(), data: [0x90, n, 64] });
      window.__mm.receive([0x90, n, 64]);
      setTimeout(() => window.__mm.receive([0x80, n, 0]), 100);
    }, every);
  };
  window.__mj.stop = () => clearInterval(window.__mj.timer);

  /**
   * A key-down that never happened, delivered the way a real one is: dispatched at the
   * MIDI *port*, so it goes through the same wrapper, carries a real DOMHighResTimeStamp
   * and reaches (or, on B, is swallowed by) exactly what a real key reaches. This is how
   * --self exercises the one-clock column, which otherwise only a pianist can fill.
   * Falls back to __mm.receive where there is no port to dispatch on.
   */
  window.__mj.fakeKey = (n, on) => {
    const bytes = on ? [0x90, n, 64] : [0x80, n, 0];
    const p = window.__mj.firstIn;
    if (!p) { window.__mm.receive(bytes); return 'receive'; }
    p.dispatchEvent(new MessageEvent('midimessage', { data: new Uint8Array(bytes) }));
    return 'port';
  };
})();`;

// ------------------------------------------------------------------ statistics
const num = xs => xs.filter(Number.isFinite).sort((a, b) => a - b);
const quant = (s, q) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] : NaN);
const stats = xs => {
  const s = num(xs);
  return { n: s.length, med: quant(s, 0.5), p90: quant(s, 0.9), worst: s.length ? s[s.length - 1] : NaN, best: s.length ? s[0] : NaN };
};
const ms = v => (Number.isFinite(v) ? v.toFixed(1) : '–');

function table(rows) {
  const head = ['', 'n', 'median', 'p90', 'worst', 'best'];
  const body = rows.map(r => [r.label, String(r.s.n), ms(r.s.med), ms(r.s.p90), ms(r.s.worst), ms(r.s.best)]);
  const w = head.map((_, i) => Math.max(...[head, ...body].map(r => r[i].length)));
  const line = r => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[0]))).join('  ');
  console.log('  ' + line(head));
  console.log('  ' + w.map(n => '-'.repeat(n)).join('  '));
  for (const r of body) console.log('  ' + line(r));
}

// ------------------------------------------------------------------ pairing
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
/**
 * What makes two messages the same note. A piano may spell a note-off as 0x90 with
 * velocity 0 while `bytesOf` in jam.js always spells it 0x80, and the volume rescales a
 * note-on's velocity on its way to the port -- so neither the status byte as sent nor
 * the velocity can be part of the identity. Which key, and whether it went down.
 */
const key = d => `${(d[0] & 0xf0) === 0x90 && d[2] > 0 ? 'on' : 'off'}${d[1]}`;

/**
 * One direction of the jam, end to end: every note that left `from` and arrived at `to`,
 * joined on the relay-time stamp the note itself carries. Nothing is matched by guesswork
 * -- `t` is written by the sender and read by the receiver, so the join is exact.
 */
function leg(from, to) {
  const posts = from.ev.filter(e => e.k === 'post');
  const byT = new Map();
  for (const r of to.ev.filter(e => e.k === 'recv')) byT.set(r.t, r);
  const pairs = [];
  for (const p of posts) {
    const r = byT.get(p.t);
    if (!r || !same(p.data, r.data)) continue;
    const port = r.ports.find(x => key(x.data) === key(r.data)) ?? r.ports[0] ?? null;
    pairs.push({
      data: r.data, t: p.t,
      postMs: p.done !== null ? p.done - p.at : NaN,
      // both tabs in relay time: `performance.now()` on two documents shares no origin,
      // so every cross-tab subtraction below goes through the offset each one measured
      postRelay: p.at + from.offset,
      arriveRelay: r.at + to.offset,
      playRelay: r.playAt !== null ? r.playAt + to.offset : NaN,
      portRelay: port ? port.at + to.offset : NaN,
      portTsRelay: port && port.ts !== null ? port.ts + to.offset : NaN,
      wait: r.wait,
      raw: { recvAt: r.at, playAt: r.playAt, portAt: port ? port.at : null, portTs: port ? port.ts : null },
    });
  }
  return pairs;
}

/**
 * The same notes again with no clock arithmetic in them at all: B saw the very key-down A
 * sent, on B's own `performance.now()`. Only real notes have this -- an injected one was
 * never on a wire -- and it is the number to believe when it disagrees with the relay-time
 * one, because the only thing between the two ends of it is B's own clock.
 */
function hardware(pairs, to) {
  const keys = to.ev.filter(e => e.k === 'in');
  const out = [];
  for (const p of pairs) {
    if (!Number.isFinite(p.raw.portAt)) continue;
    const want = p.t - to.offset;                         // the key-down in B's own time
    let best = null;
    for (const k of keys) {
      if (key(k.data) !== key(p.data)) continue;
      const d = Math.abs(k.midiT - want);
      if (d < 50 && (!best || d < Math.abs(best.midiT - want))) best = k;
    }
    if (!best) continue;
    out.push({ ...p, keyDown: best.midiT, drift: best.midiT - want,
               toPort: p.raw.portAt - best.midiT,
               toPlay: p.raw.portTs !== null ? p.raw.portTs - best.midiT : p.raw.playAt - best.midiT });
  }
  return out;
}

function report(name, pairs, hw) {
  console.log(`\n${name}: ${pairs.length} note${pairs.length === 1 ? '' : 's'} joined end to end`);
  if (!pairs.length) { console.log('  (nothing)'); return; }
  const rows = [
    { label: `hold left on arrival (of ${HOLD_MS} ms)`, s: stats(pairs.map(p => p.wait)) },
    { label: 'relay one-way (send → arrive)', s: stats(pairs.map(p => p.arriveRelay - p.postRelay)) },
    { label: 'played → partner output.send', s: stats(pairs.map(p => p.portRelay - p.t)) },
    { label: 'played → scheduled to sound', s: stats(pairs.map(p => (Number.isFinite(p.portTsRelay) ? p.portTsRelay : p.playRelay) - p.t)) },
    { label: 'the POST itself', s: stats(pairs.map(p => p.postMs)) },
  ];
  // a row with nothing in it is a leg that has no such thing, not a leg that failed --
  // A's Out is the computer, so the reverse direction never touches a MIDI port at all
  table(rows.filter(r => r.s.n > 0));
  if (hw && hw.length) {
    console.log(`\n  on one clock (${hw.length} real key-down${hw.length === 1 ? '' : 's'} the partner tab saw for itself):`);
    table([
      { label: 'key down → output.send', s: stats(hw.map(p => p.toPort)) },
      { label: 'key down → scheduled to sound', s: stats(hw.map(p => p.toPlay)) },
      { label: 'clock check (should be ~0)', s: stats(hw.map(p => p.drift)) },
    ]);
  }
}

// ------------------------------------------------------------------ the run
async function main() {
  mkdirSync(PROFILE, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  PORT = await freePort(Number(opt('--port', 8830)));
  CDP_PORT = PORT + 1000;
  const A_BASE = `http://127.0.0.1:${PORT}`;
  const B_BASE = `http://localhost:${PORT}`;

  server = spawn('python3', ['serve.py', String(PORT), '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await waitFor(`${A_BASE}/learn.html`);

  chrome = spawn(CHROME, [
    ...(HEADED ? [] : ['--headless=new']),
    '--mute-audio',                                  // always: this is muted for a reason
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--disable-gpu',
    // A hidden tab is throttled to about a tick a second, and both tabs here are doing
    // work the whole time -- same reason the smoke passes these.
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);

  // Web MIDI, before either page loads: initMidi runs at load, and a prompt nobody can
  // see is a refusal. Chrome 124+ asks for plain MIDI as well as sysex, so grant both.
  const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  for (const origin of [A_BASE, B_BASE])
    await browser.send('Browser.grantPermissions', { origin, permissions: ['midi', 'midiSysex'] });

  const targets = async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page');

  /** One tab, loaded twice: the first landing is only somewhere to write localStorage. */
  async function open(target, role, base, out, volume) {
    const tab = await attach(target, role);
    await tab.goto(`${base}/learn.html`, 1200);
    await tab.ev(`localStorage.setItem('middleman.out', ${JSON.stringify(out)});
      localStorage.setItem('middleman.volume', ${JSON.stringify(String(volume))});
      localStorage.setItem('middleman.learn.room', ${JSON.stringify(ROOM)}); return 1;`);
    await tab.goto(`${base}/learn.html?room=${ROOM}`, 2000);
    if (!(await poll(() => tab.ev('return !!window.__mm;'), v => v, 6000)).ok)
      throw new Error(`tab ${role} never exposed window.__mm`);
    return tab;
  }

  // A is the pianist: Out to the computer so the keys under his hands are not doubled on
  // the piano by his own tab, and volume 0 so the partner's notes do not come back at him
  // out of the laptop's speakers either. A must be silent; only B may make a sound.
  const A = await open((await targets())[0], 'A', A_BASE, 'audio', 0);

  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`${B_BASE}/learn.html`)}`, { method: 'PUT' });
  await sleep(900);
  const bTarget = (await targets()).find(t => t.url.includes('localhost'));
  if (!bTarget) throw new Error('the partner tab never showed up');
  const B = await open(bTarget, 'B', B_BASE, 'midi', 1);

  // ---------------------------------------------------------------- what MIDI is there
  const ports = tab => tab.ev(`try {
      const a = await navigator.requestMIDIAccess();
      return { inputs: [...a.inputs.values()].map(p => p.name), outputs: [...a.outputs.values()].map(p => p.name),
               status: document.getElementById('statusEl')?.textContent ?? '',
               taps: { es: __mj.esWrapped, port: !!__mj.portWrapped, in: __mj.inWrapped } };
    } catch (e) { return { error: e.name + ': ' + e.message }; }`);
  const midi = { A: await ports(A), B: await ports(B) };
  console.log(`Chrome: ${HEADED ? 'headed' : 'headless=new'} · server :${PORT} · room ${ROOM}`);
  for (const [role, m] of Object.entries(midi)) {
    if (m.error) { console.log(`  ${role}: Web MIDI unavailable — ${m.error}`); continue; }
    console.log(`  ${role}  in: ${m.inputs.join(', ') || '(none)'}  ·  out: ${m.outputs.join(', ') || '(none)'}`);
    console.log(`     ${m.status}`);
    if (!m.taps.es || !m.taps.in) console.log(`     WARNING: taps missing — es=${m.taps.es} in=${m.taps.in} port=${m.taps.port}`);
  }
  const piano = (midi.B.outputs ?? []).length > 0;
  if (!piano) console.log('  NOTE: the partner tab found no MIDI output, so nothing can be sent to a piano.');

  // ---------------------------------------------------------------- into the room
  // a real click, because it is also the gesture the AudioContext wants
  await A.click('#jamBtn');
  await B.click('#jamBtn');
  const met = await poll(async () => ({
    a: await A.ev('return { room: __mm.jam.room, client: __mm.jam.client, players: __mm.jam.players };'),
    b: await B.ev('return { room: __mm.jam.room, client: __mm.jam.client, players: __mm.jam.players };'),
  }), v => v?.a?.players > 0 && v?.b?.players > 0, 12000, 300);
  if (!met.ok) throw new Error(`the two tabs never saw each other (${JSON.stringify(met.v)})`);
  console.log(`  room ${met.v.a.room}: A=${met.v.a.client} B=${met.v.b.client}`);

  // the offset is measured on the stream's onopen; give it its eight round trips
  await poll(() => A.ev('return __mm.jam.relay.synced && __mm.jam.relay.rtt > 0;'), v => v, 6000, 250);
  await poll(() => B.ev('return __mm.jam.relay.synced;'), v => v, 6000, 250);

  // ---------------------------------------------------------------- record
  if (INJECT > 0) await B.ev(`__mj.inject(${INJECT}); return 1;`);
  // --self is a key-down nobody made: dispatched at *both* tabs' MIDI input port, which is
  // what a real key is -- one physical event that A forwards to the app and B only sees.
  // The two dispatches are two CDP round trips, so the one-clock column below carries a
  // millisecond or two of this harness's own skew that a real key would not have.
  let selfTimer = null;
  if (SELF) {
    const notes = [60, 64, 67, 72];
    let i = 0;
    const strike = on => Promise.all([A, B].map(t => t.ev(`return __mj.fakeKey(${notes[i % notes.length]}, ${on});`)));
    selfTimer = setInterval(() => {
      strike(true).then(() => sleep(100)).then(() => strike(false)).then(() => { i++; }).catch(() => { /* torn down */ });
    }, INJECT > 0 ? INJECT : 2000);
  }
  console.log(`\nRecording for ${SECONDS}s — play now.`
    + (INJECT > 0 ? ` (the partner plays one note every ${INJECT} ms, for the reverse leg)` : '')
    + (SELF ? ' (--self: a key-down is faked at both tabs\' MIDI input)' : ''));
  const started = Date.now();
  for (let left = SECONDS; left > 0; left -= 5) {
    await sleep(Math.min(5, left) * 1000);
    const seen = await A.ev('return __mj.ev.filter(e => e.k === "in").length;');
    process.stdout.write(`  ${Math.max(0, SECONDS - Math.round((Date.now() - started) / 1000))}s left · ${seen} key events on the piano\r`);
  }
  console.log('');
  clearInterval(selfTimer);
  await A.ev('__mj.stop(); return 1;');
  await B.ev('__mj.stop(); return 1;');
  await sleep(600);                        // let the last note finish crossing

  // ---------------------------------------------------------------- collect
  const clock = tab => tab.ev(`const r = __mm.jam.relay;
    return { offset: r.offset, rtt: r.rtt, synced: r.synced, status: r.status, client: r.client,
             sent: __mm.jam.sent, heard: __mm.jam.heard, players: __mm.jam.players };`);
  const grab = async (tab, role) => ({ role, ...(await clock(tab)), ev: await tab.ev('return __mj.ev;') });
  const a = await grab(A, 'A'), b = await grab(B, 'B');

  const aToB = leg(a, b), bToA = leg(b, a);
  const hw = hardware(aToB, b);
  const keys = a.ev.filter(e => e.k === 'in').length;

  console.log(`\nclock: A offset ${a.offset.toFixed(1)} ms rtt ${a.rtt.toFixed(1)} ms · `
    + `B offset ${b.offset.toFixed(1)} ms rtt ${b.rtt.toFixed(1)} ms`);
  console.log(`jam: A sent ${a.sent} heard ${a.heard} · B sent ${b.sent} heard ${b.heard}`
    + ` · ${keys} MIDI message${keys === 1 ? '' : 's'} came off the piano into A`);

  if (!keys && !SELF && INJECT <= 0)
    console.log('\nNo notes at all. Either nothing was played, or the piano is not the MIDI input this tab found.');
  else if (!keys && !SELF)
    console.log('\nNothing was played on the piano — the forward leg below is empty; only the partner\'s injected notes were measured.');

  report('piano → partner (the leg that reaches the piano)', aToB, hw);
  report('partner → piano tab (injected, the reverse leg)', bToA, null);

  const errs = [...A.errors, ...B.errors];
  if (errs.length) console.log(`\nconsole errors: ${errs.slice(0, 3).join(' | ')}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(OUT_DIR, `measure-jam-${stamp}.json`);
  writeFileSync(file, JSON.stringify({
    when: new Date().toISOString(), seconds: SECONDS, room: ROOM, port: PORT,
    headless: !HEADED, inject: INJECT, self: SELF, hold: HOLD_MS, midi,
    tabs: { A: a, B: b }, pairs: { aToB, bToA, hardware: hw },
  }, null, 1));
  console.log(`\nraw samples → ${file}`);

  if (!KEEP) { A.close(); B.close(); browser.close(); }
}

main()
  .catch(err => { console.error('\nfailed: ' + err.message); process.exitCode = 1; })
  .finally(() => { killAll(); process.exit(process.exitCode ?? 0); });

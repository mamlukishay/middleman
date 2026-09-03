#!/usr/bin/env node
// End-to-end smoke check for the phone-mirroring "Learn" flow: a laptop hosts a
// room (learn.html) and a phone mirrors it over the relay in serve.py
// (learn-m.html). Every worker touching that flow so far has hand-rolled this
// exact dance -- launch Chrome, drive two tabs over CDP, tear down -- so this is
// the one reusable version. Node only: Node's global WebSocket (stable since
// Node 22) talks CDP directly, so there is nothing to npm install.
//
//   node scripts/smoke.mjs [--port 8810] [--keep] [--shots <dir>]
//
// --keep leaves the server and Chrome running (for poking at with a real
// browser's devtools); --shots saves one screenshot per tab. Exits 1 if any
// check fails.

import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof WebSocket === 'undefined') {
  // Node 22+ has a global WebSocket; below that there is none, and the task this
  // file exists for is to avoid a hand-rolled CDP client per worker -- so fail
  // loudly rather than half-support an older Node.
  console.error(`No global WebSocket (Node ${process.version}); this needs Node >= 22.`);
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOM = 'smoke1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(opt('--port', 8810));
const CDP_PORT = PORT + 1000;
const KEEP = args.includes('--keep');
const SHOTS = opt('--shots', null);
const PROFILE = join(tmpdir(), `mm-smoke-${process.pid}`);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const ok = (name, pass, note = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`);
  results.push(pass);
};

let server = null, chrome = null;

function killAll() {
  if (KEEP) { console.log(`(--keep: server on :${PORT}, Chrome on :${CDP_PORT} left running)`); return; }
  try { server?.kill(); } catch { /* already gone */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  try { execSync(`pkill -f "${PROFILE}"`, { stdio: 'ignore' }); } catch { /* none running */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* nothing to clean up */ }
}
// belt and braces: a thrown error still runs the `finally` below, but Ctrl-C doesn't
process.on('SIGINT', () => { killAll(); process.exit(130); });

async function waitFor(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`nothing answering at ${url}`);
}

/** Poll `fn` until `pass` likes its value or `ms` runs out. Swallows mid-navigation errors. */
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

/** A CDP connection to one page target: evaluate, navigate, click, screenshot, console errors. */
async function attach(target, metrics) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (metrics) await send('Emulation.setDeviceMetricsOverride', metrics);
  return {
    errors,
    async goto(url, wait = 1200) { await send('Page.navigate', { url }); await sleep(wait); },
    /** Evaluate an expression in the page; async expressions are awaited. */
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** A real, trusted click -- some of what this drives (AudioContext) refuses a synthetic one. */
    async click(sel) {
      const box = await this.ev(`const e = ${sel === 'body' ? 'document.body' : `document.querySelector(${JSON.stringify(sel)})`};
        if (!e) return null; e.scrollIntoView?.({ block: 'center' }); const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
      if (!box) throw new Error('no element ' + sel);
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(80);
    },
    /** Make this the visible tab: a hidden one has no rAF and barely any timers. */
    async front() { await send('Page.bringToFront'); await sleep(150); },
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    close() { ws.close(); },
  };
}

async function main() {
  mkdirSync(PROFILE, { recursive: true });

  // ---------------------------------------------------------------- launch
  server = spawn('python3', ['serve.py', String(PORT), '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await waitFor(`${BASE}/learn.html`);
  chrome = spawn(CHROME, [
    '--headless=new', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`,   // --mute-audio always: this is muted for a reason
    `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu',
    // Two tabs, one browser, and only one of them can be in front -- so the other is
    // a *hidden* page, and Chrome throttles a hidden page's timers to roughly one
    // tick a second. The engine's scheduler ticks every 25 ms and only looks about
    // 120 ms ahead, so at one tick a second nearly every app note is already in the
    // past when the tick that would have sent it finally runs, and is dropped. That
    // is right on a real laptop and wrong here: the laptop in this check is a window
    // in front of a pianist, not a background tab. Hence these, and the
    // `laptop.front()` before the Hear check below.
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const targets = async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page');

  // ---------------------------------------------------------------- the laptop
  // hosting has to be set before app.js's own boot runs, so it comes up already
  // sharing rather than needing a click on "Put it on the phone"
  const laptop = await attach((await targets())[0], { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await laptop.goto(`${BASE}/learn.html`);
  await laptop.ev(`localStorage.setItem('middleman.learn.hosting', '1');
    localStorage.setItem('middleman.learn.room', '${ROOM}'); return 1;`);
  await laptop.goto(`${BASE}/learn.html`, 2000);
  if (!(await poll(() => laptop.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('laptop never exposed window.__mm');

  // ---------------------------------------------------------------- the phone
  // mobile.js writes middleman.learn.remote itself off the ?room= query, so
  // there is nothing to set by hand before this navigation
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`${BASE}/learn-m.html?room=${ROOM}`)}`, { method: 'PUT' });
  await sleep(800);
  const phoneTarget = (await targets()).find(t => t.url.includes('learn-m.html'));
  if (!phoneTarget) throw new Error('the phone tab never showed up');
  const phone = await attach(phoneTarget, { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  if (!(await poll(() => phone.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('phone never exposed window.__mm');
  // a fresh load lands on the song list; the stage only engraves notes (and so
  // only has noteheads to mark 'hit') once it is actually the screen showing
  await phone.ev(`__mm.go('play'); return 1;`);

  // ---------------------------------------------------------------- checks
  const mode = await poll(() => phone.ev(`return document.getElementById('modeLine').textContent;`),
    v => v && v.includes('showing the laptop'), 5000);
  ok('phone\'s mode line says it is showing the laptop', mode.ok, mode.v);

  await laptop.ev('__mm.applyStep(2, true); return 1;');
  const step = await poll(() => phone.ev('return __mm.si;'), v => v === 2, 2000);
  ok('phone\'s step follows a laptop step change', step.ok, `phone si=${step.v}`);

  // every step starts with a 4-beat count-in, which would eat into the 6 s budget
  // below for nothing measurable -- so let it finish before timing demo()'s own delay
  await poll(() => laptop.ev('return __mm.engine.position().countIn;'), v => v === false, 6000, 200);
  await phone.ev(`window.__smokeHits = 0; __mm.engine.on('hit', () => window.__smokeHits++); return 1;`);
  await laptop.ev('window.__demoStop = __mm.demo(0.9); return 1;');
  const demo = await poll(
    () => phone.ev(`return { hits: window.__smokeHits, heads: document.querySelectorAll('.hit').length };`),
    v => v && v.hits > 0 && v.heads > 0, 6000, 300);
  ok('demo() on the laptop produces hit events and green noteheads on the phone', demo.ok,
    `hits=${demo.v?.hits ?? 0} heads=${demo.v?.heads ?? 0}`);
  await laptop.ev('window.__demoStop?.(); __mm.engine.stop(); return 1;');   // done with it -- stray notes would confuse Hear, next

  let viewErr = '';
  try { for (const v of ['scroll', 'staff', 'roll', 'fall']) await phone.ev(`__mm.setView('${v}'); return 1;`); }
  catch (e) { viewErr = e.message; }
  ok('phone switches through every view without throwing', !viewErr, viewErr);

  await laptop.click('#outsel [data-out="audio"]');   // Out: Computer -- and the gesture the AudioContext wants
  await sleep(500);                                   // the snapshot with out:'audio' has to reach the phone first
  await phone.click('body');                          // the phone's own gesture, now that it knows sound is coming its way
  // and now the laptop takes the front, because from here on it is the laptop's
  // scheduler being measured and the phone only has to receive. (The checks above are
  // the other way round: they read what the phone *drew*, which needs its rAF.)
  await laptop.front();
  const before = await phone.ev('return window.__synth?.scheduled ?? 0;');
  await laptop.click('#hearBtn');
  // Hear has the same count-in; wait it out so this isn't just re-measuring that
  await poll(() => laptop.ev('return __mm.engine.position().countIn;'), v => v === false, 6000, 200);
  const sched = await poll(() => phone.ev('return window.__synth?.scheduled ?? 0;'), v => v > before, 6000, 300);
  ok('Hear on the laptop schedules notes on the phone\'s synth', sched.ok, `${before} → ${sched.v}`);

  // ---------------------------------------------------------------- the jam
  // A second player is a second *machine*, and the closest one browser gets to that is
  // a second origin: `localhost` and `127.0.0.1` are the same server, the same room
  // (the server names it, see /relay/info) and two separate localStorages. So the
  // player tab never picks up the remembered "Put it on the phone", and there is only
  // ever one brain in the room -- which is the arrangement the jam is designed around.
  await laptop.ev('__mm.engine.stop(); return 1;');       // no lesson notes under the check
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`http://localhost:${PORT}/learn.html`)}`, { method: 'PUT' });
  await sleep(800);
  const playerTarget = (await targets()).find(t => t.url.includes('localhost'));
  if (!playerTarget) throw new Error('the second player tab never showed up');
  const player = await attach(playerTarget, { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (!(await poll(() => player.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('the second player never exposed window.__mm');

  // a real click, because it is also the gesture the AudioContext wants before the
  // other player's notes can come out of this machine's speakers
  await laptop.click('#jamBtn');
  await player.click('#jamBtn');
  const met = await poll(async () => ({
    a: await laptop.ev('return { room: __mm.jam.room, client: __mm.jam.client, players: __mm.jam.players };'),
    b: await player.ev('return { room: __mm.jam.room, client: __mm.jam.client, players: __mm.jam.players };'),
  }), v => v?.a?.players > 0 && v?.b?.players > 0, 8000, 300);
  ok('jam: both players land in the same room and see each other', met.ok
    && met.v.a.room === met.v.b.room, `room ${met.v?.a?.room}/${met.v?.b?.room}`);
  const A = met.v?.a?.client, B = met.v?.b?.client;

  const injectC = 'window.__mm.receive([0x90, 60, 90]); setTimeout(() => window.__mm.receive([0x80, 60, 0]), 120); return 1;';
  const heardOn = tab => tab.ev('return { heard: __mm.jam.heard, from: __mm.jam.last?.from ?? null, n: __mm.jam.last?.data?.[1] ?? null, synth: window.__synth?.scheduled ?? 0 };');

  const bBefore = await heardOn(player);
  const phoneSynth = () => phone.ev('return window.__synth?.scheduled ?? 0;');
  const pBefore = await phoneSynth();
  await laptop.ev(injectC);
  const toB = await poll(() => heardOn(player), v => v && v.heard > bBefore.heard, 5000, 200);
  ok('jam: a note played on the laptop reaches the second player, signed', toB.ok
    && toB.v?.from === A && toB.v?.n === 60, `from=${toB.v?.from} want=${A} n=${toB.v?.n}`);
  ok('jam: the second player actually sounds it', (toB.v?.synth ?? 0) > bBefore.synth,
    `${bBefore.synth} → ${toB.v?.synth}`);

  const aAfterOwn = await heardOn(laptop);
  ok('jam: your own notes are never echoed back to you', aAfterOwn.heard === 0,
    `the laptop heard ${aAfterOwn.heard}`);

  // the phone on the music stand is a screen, not a player: the room's playing goes
  // straight past it. What it does play is the *laptop's* sound, which is why the
  // second player's note reaches it a moment later -- through the laptop's own Out,
  // exactly as a note from the lesson would.
  ok('jam: the phone ignores the room\'s playing', (await phoneSynth()) === pBefore,
    `${pBefore} → ${await phoneSynth()}`);

  await player.ev(injectC);
  const toA = await poll(() => heardOn(laptop), v => v && v.heard > 0, 5000, 200);
  ok('jam: a note played on the second player reaches the laptop, signed', toA.ok
    && toA.v?.from === B && toA.v?.n === 60, `from=${toA.v?.from} want=${B} n=${toA.v?.n}`);
  const onStand = await poll(phoneSynth, v => v > pBefore, 5000, 200);
  ok('jam: and comes out of the phone, because that is where the laptop\'s Out is',
    onStand.ok, `${pBefore} → ${onStand.v}`);

  // over the whole run, not just this instant -- so it has to come last
  const errs = [...laptop.errors, ...phone.errors, ...player.errors];
  ok('no console errors on any tab', errs.length === 0, errs.slice(0, 2).join(' | '));

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await laptop.shot(join(SHOTS, 'laptop.png'));
    await phone.shot(join(SHOTS, 'phone.png'));
  }
  laptop.close(); phone.close();
}

const t0 = Date.now();
main()
  .catch(err => { ok('the run completed', false, err.message); console.error(err); })
  .finally(() => {
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} checks passed · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    killAll();
    process.exit(passed === results.length ? 0 : 1);
  });

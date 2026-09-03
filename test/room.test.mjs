// Whose room it is.
//
// The owner's bug, in his words: "open desktop app; use qr and open mobile one; save
// the page as a homepage app; now open it from the homepage; now stop the server and
// run it again, connect again to iphone; now go to the old homepage app, which sits
// in the same url. Expected: the app to catch up... Actual: it's a detached app from
// the current stream of events."
//
// Two halves to that. The room used to be minted in the *page* and kept in
// localStorage, which is per origin -- so one server handed a different room to
// `http://localhost:8765` and to `http://192.168.1.5:8765`, and clearing the site
// data was a third. And the phone's `?room=` is frozen the day the page is saved to
// the Home screen, so it kept joining whichever room the laptop had left.
//
// So: the server mints one id per machine, in `certs/room`, and both ends take it
// from `/relay/info`. This pins down that the server's answer is stable across
// restarts and across binds, and that both ends prefer it to what they remembered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickRoom, shareLink } from '../src/learn/host.js';
import { followRoom, mirrorsByDefault } from '../src/learn/remote.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Run serve.py long enough to ask it who it is, then kill it. */
async function info(port, bind = '127.0.0.1') {
  const p = spawn('python3', [join(ROOT, 'serve.py'), String(port), bind],
                  { cwd: ROOT, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      await sleep(120);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/relay/info`);
        if (r.ok) return await r.json();
      } catch { /* not up yet */ }
    }
    return null;
  } finally { p.kill('SIGKILL'); }
}

// ------------------------------------------------------------------ the server
test('the server names a room, and it is the same one after a restart', async () => {
  const a = await info(8881);
  assert.ok(a, 'the server never came up');
  assert.match(a.room, /^[23456789bcdfghjkmnpqrstvwxz]{6}$|^[a-z0-9]{1,32}$/,
    'a short id that can be read aloud');

  const b = await info(8882);
  assert.equal(b.room, a.room, 'a restarted server is still the same room');

  // and the same on every interface, which is the whole bug: the laptop's page opened
  // on localhost and on the LAN address are one server and must be one room
  const c = await info(8883, '0.0.0.0');
  assert.equal(c.room, a.room, 'every bind is the same room');

  const file = join(ROOT, 'certs', 'room');
  assert.ok(existsSync(file), 'and it is written down, beside the certificate');
  assert.equal(readFileSync(file, 'utf8').trim(), a.room);
});

// ------------------------------------------------------------------ the laptop
test('the laptop publishes into the room the server names, not the one it remembered', () => {
  assert.equal(pickRoom({ room: 'srv123' }, 'oldrm'), 'srv123');
  assert.equal(pickRoom({ room: 'srv123' }, null), 'srv123');
});

test('a server too old to name one leaves the remembered room alone', () => {
  // the fallback chain, in order: what the server said, what was remembered, a new one
  assert.equal(pickRoom({ port: 8765, addrs: [] }, 'oldrm'), 'oldrm');
  assert.equal(pickRoom(null, 'oldrm'), 'oldrm');
  assert.match(pickRoom(null, null), /^[23456789bcdfghjkmnpqrstvwxz]{6}$/);
});

test('the QR carries the server\'s room, so a fresh scan lands where the laptop is', () => {
  const srv = { port: 8765, tls: false, bind: '0.0.0.0', addrs: ['192.168.1.42'], room: 'k4mzq7' };
  const s = shareLink('http://localhost:8765/learn.html', srv, pickRoom(srv, 'oldrm'));
  assert.equal(s.url, 'http://192.168.1.42:8765/learn-m.html?room=k4mzq7');
});

// ------------------------------------------------------------------ the phone
test('the phone follows the server out of a room frozen into its Home screen URL', () => {
  assert.equal(followRoom({ room: 'srv123' }, 'oldrm'), 'srv123');
});

test('and stays put when there is nothing better to follow', () => {
  assert.equal(followRoom({ room: 'srv123' }, 'srv123'), null, 'already there');
  assert.equal(followRoom({ port: 8765 }, 'oldrm'), null, 'a server too old to say');
  assert.equal(followRoom(null, 'oldrm'), null, 'a server with no relay in it');
  assert.equal(followRoom(undefined, 'oldrm'), null, 'a laptop that is asleep');
});

// -------------------------------------------------------- mirroring by default
// An iPhone saved to the Home screen has its own localStorage and a URL frozen the
// day it was installed, so nothing on the device can name the live room -- and with
// no Web MIDI it can never be the app anyway. It asks the server instead.
test('a phone with no Web MIDI and nothing remembered asks the server', () => {
  assert.equal(mirrorsByDefault({ paired: false, webMidi: false, optedOut: false }), true);
});

test('a phone that can be the app on its own is left alone', () => {
  // Android: its own engine and its own piano unless the QR, the code or the
  // remembered flag says otherwise
  assert.equal(mirrorsByDefault({ paired: false, webMidi: true, optedOut: false }), false);
});

test('a phone already paired has nothing to decide', () => {
  assert.equal(mirrorsByDefault({ paired: true, webMidi: false, optedOut: false }), false);
});

test('and "Stop mirroring" holds for the launch it was tapped in', () => {
  assert.equal(mirrorsByDefault({ paired: false, webMidi: false, optedOut: true }), false);
});

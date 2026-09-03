// The address the "Put it on the phone" QR carries.
//
// The bug this pins down: the panel used to build the link out of the page's own
// address, so a laptop reading http://localhost:9999/learn.html handed the phone
// http://localhost:9999/... -- which on a phone means the phone. Nothing about that
// failure says what went wrong; it just never connects.
//
// Two things have to be true of the answer at once: the host must be an address that
// leaves the laptop, and the port must stay the one the page is on, because the relay
// keeps its rooms in the server *process* -- another server on the same machine is a
// different, empty room.

import test from 'node:test';
import assert from 'node:assert/strict';
import { shareLink, unreachableNote } from '../src/learn/host.js';

const info = (x = {}) => ({ port: 8765, tls: false, bind: '0.0.0.0', addrs: ['192.168.1.42'], ...x });

test('a page already on a LAN address keeps that address', () => {
  const s = shareLink('http://192.168.1.42:8765/learn.html', info(), 'abc123');
  assert.equal(s.url, 'http://192.168.1.42:8765/learn-m.html?room=abc123');
  assert.equal(s.reachable, true);
});

test('a localhost page borrows the server\'s LAN address, and keeps its port', () => {
  const s = shareLink('http://localhost:9999/learn.html', info({ port: 8765 }), '79fmns');
  // the port is the page's, not the server report's: the room lives in this process
  assert.equal(s.url, 'http://192.168.1.42:9999/learn-m.html?room=79fmns');
  assert.equal(s.reachable, true);
  assert.equal(s.ip, '192.168.1.42');
});

test('127.0.0.1 is swapped too, and the first address is the one used', () => {
  const s = shareLink('http://127.0.0.1:8765/learn.html', info({ addrs: ['10.0.0.7', '192.168.64.1'] }), 'r');
  assert.equal(s.url, 'http://10.0.0.7:8765/learn-m.html?room=r');
});

test('a localhost page with no server to ask stays on localhost, and says so', () => {
  const s = shareLink('http://localhost:9999/learn.html', null, 'abc123');
  assert.equal(s.url, 'http://localhost:9999/learn-m.html?room=abc123');
  assert.equal(s.reachable, false);
  assert.equal(s.ip, null);
});

test('a server bound to loopback cannot be reached however good the address is', () => {
  const s = shareLink('http://127.0.0.1:8792/learn.html', info({ bind: '127.0.0.1' }), 'abc123');
  assert.equal(s.reachable, false);
  assert.equal(s.ip, '192.168.1.42');       // known, so the note can name it
});

test('a server that knows of no address but its own is unreachable', () => {
  const s = shareLink('http://localhost:8765/learn.html', info({ addrs: [] }), 'abc123');
  assert.equal(s.reachable, false);
});

test('https stays https, and http stays http', () => {
  const tls = shareLink('https://192.168.1.42:8765/learn.html', info({ tls: true }), 'abc123');
  assert.equal(tls.url, 'https://192.168.1.42:8765/learn-m.html?room=abc123');
  // the page's scheme is not the authority -- the server's own report is, so a page
  // opened over http on a TLS server still hands the phone an https link
  const up = shareLink('http://localhost:8765/learn.html', info({ tls: true }), 'abc123');
  assert.equal(up.url, 'https://192.168.1.42:8765/learn-m.html?room=abc123');
});

test('the note names the address when one is known, and admits it when not', () => {
  assert.match(unreachableNote('192.168.1.42'), /https:\/\/192\.168\.1\.42:8765\/learn\.html/);
  assert.match(unreachableNote(null), /<ip>/);
  assert.match(unreachableNote(null), /^This server is only reachable from this laptop\./);
});

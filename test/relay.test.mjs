// The channel between the laptop and the phone: what it opens, when it gives up, and
// which room it is in.
//
// Two bugs live here. The first: the repo served by `python3 -m http.server` answers
// every relay endpoint with a 404 or a 501, and everything retried it -- the
// EventSource reopened itself, the clock measurement fired eight requests a resync,
// and the remembered "Put it on the phone" re-armed the whole thing on every reload,
// until the server's log filled up and the page was unusable. That question is now
// asked once, by `relayInfo`, before anything is opened at all.
//
// The second: the room used to be minted in the page and kept in localStorage, which
// is per *origin* -- so one server handed out a different room to `localhost` and to
// its own LAN address, and a phone installed on the Home screen with `?room=` frozen
// into it ended up in whichever of the two the laptop was no longer in. The server
// names the room now, and `setRoom` is how both ends move to it.
//
// `net` is the only door to the network, which is what makes any of this testable --
// the same trick sync.js plays with `fetchTime`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeRelay, relayInfo, shortId } from '../src/learn/relay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A file server: 404 to a GET, 501 to a POST, HTML in the body either way. */
function plainServer() {
  const hits = [];
  return {
    hits,
    fetch: async (url, opts) => {
      hits.push(`${opts?.method ?? 'GET'} ${String(url).split('?')[0]}`);
      return {
        ok: false,
        status: String(url).includes('/send') ? 501 : 404,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
      };
    },
    EventSource: class { constructor() { throw new Error('the EventSource must not be opened'); } },
  };
}

/** A real relay: a monotonic stamp from /relay/time, and a stream that opens. */
function relayServer({ auto = false } = {}) {
  const hits = [];
  const made = [];
  class FakeES {
    constructor(url) {
      this.url = url; this.readyState = 0; made.push(this);
      // `auto` stands in for a server that accepts the stream by itself, for the tests
      // that care about what happens once it is live rather than about opening it
      if (auto) setTimeout(() => this.accept(), 0);
    }
    close() { this.readyState = 2; }
    accept() { this.readyState = 1; this.onopen?.(); }
    fail(state = 2) { this.readyState = state; this.onerror?.(); }
  }
  return {
    hits, made,
    fetch: async (url, opts) => {
      hits.push(`${opts?.method ?? 'GET'} ${String(url).split('?')[0]}`);
      return { ok: true, status: 200, json: async () => ({ t: 1234 }) };
    },
    EventSource: FakeES,
  };
}

const settle = () => new Promise(r => setTimeout(r, 0));
const after = ms => new Promise(r => setTimeout(r, ms));
const roomOf = es => new URL(es.url, 'http://x').searchParams.get('room');

test('an id has no vowels in it, so a room never spells anything', () => {
  assert.match(shortId(20), /^[23456789bcdfghjkmnpqrstvwxz]{20}$/);
});

// ------------------------------------------------------------------ relayInfo
test('/relay/info hands back who the server is, room and all', async () => {
  const body = { port: 8765, tls: false, bind: '0.0.0.0', addrs: ['10.0.0.7'], room: 'k4mzq7' };
  const net = { fetch: async () => ({ ok: true, status: 200, json: async () => body }) };
  assert.deepEqual(await relayInfo('', net), body);
});

test('a 404 is a server with no relay in it, and says so as null', async () => {
  assert.equal(await relayInfo('', plainServer()), null);
});

test('a 200 whose body is not JSON is no relay either', async () => {
  // an over-helpful proxy, or a single-page-app server answering 200 with index.html
  const net = { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } }) };
  assert.equal(await relayInfo('', net), null);
});

test('a server that cannot be reached at all is undefined, which is not the same thing', async () => {
  // the laptop is asleep, or the Wi-Fi is not up yet. A phone told "no relay" here
  // would give up on a laptop that is merely coming back.
  const net = { fetch: async () => { throw new TypeError('Failed to fetch'); } };
  assert.equal(await relayInfo('', net), undefined);
});

// ------------------------------------------------------------------ the stream
test('open() opens the stream at once: there is nothing to ask first', async () => {
  const net = relayServer();
  const r = makeRelay({ room: 'abc123', client: 'c1', net });
  const seen = [];
  r.onStatus(s => seen.push(s));
  r.open();

  assert.equal(net.made.length, 1, 'and synchronously, without a round trip in front of it');
  assert.match(net.made[0].url, /^\/relay\/events\?room=abc123&client=c1$/);
  assert.deepEqual(seen, ['idle', 'connecting']);
  assert.deepEqual(net.hits, [], 'no probe, no clock samples, until the stream is up');

  net.made[0].accept();
  assert.equal(r.status, 'live');
  r.send({ type: 'state' });
  await settle();
  assert.ok(net.hits.includes('POST /relay/send'));
  r.close();
});

test('nothing is sent until a stream is actually live', async () => {
  const net = relayServer();
  const r = makeRelay({ room: 'r', net });
  assert.equal(r.send({ type: 'state' }), null, 'nothing goes out before open()');
  r.open();
  assert.equal(r.send({ type: 'state' }), null, 'nor while it is still connecting');
  net.made[0].accept();
  assert.ok(r.send({ type: 'state' }), 'and something does once it is live');
  r.close();
});

test('a stream that drops comes back in a second, backing off if it really has gone', async () => {
  // The phone is blind between the drop and the reopen: it shows a picture of the
  // laptop that has stopped following it, with nothing on screen to say so.
  const net = relayServer();
  const r = makeRelay({ room: 'r', net, retryMs: 20 });
  r.open();
  net.made[0].accept();
  net.made[0].fail(2);                      // CLOSED: the browser has given up
  assert.equal(r.status, 'closed');
  assert.equal(net.made.length, 1, 'a closed stream is not reopened on the spot');
  assert.equal(r.send({ type: 'state' }), null, 'and nothing is posted into a dead stream');

  await after(40);
  assert.equal(net.made.length, 2, 'the retry reopened it');
  net.made[1].accept();
  assert.equal(r.status, 'live');

  // and the backoff is reset by the stream coming back, so the next drop is quick too
  net.made[1].fail(2);
  await after(40);
  assert.equal(net.made.length, 3);
  r.close();
});

test('the retry backs off, and only one is ever outstanding', async () => {
  const net = relayServer();
  const r = makeRelay({ room: 'r', net, retryMs: 20 });
  r.open();
  net.made[0].fail(2);
  net.made[0].fail(2);                      // a second error must not stack a second timer
  await after(35);
  assert.equal(net.made.length, 2, 'exactly one reopen');
  net.made[1].fail(2);
  await after(35);
  assert.equal(net.made.length, 2, 'and the second wait is longer than the first');
  await after(40);
  assert.equal(net.made.length, 3);
  r.close();
});

test('a stream that is merely wobbling says so and is left to reconnect itself', async () => {
  const net = relayServer();
  const r = makeRelay({ room: 'r', net });
  r.open();
  net.made[0].accept();
  net.made[0].fail(0);                      // CONNECTING: EventSource is retrying by itself
  assert.equal(r.status, 'reconnecting');
  assert.equal(net.made.length, 1);
  r.close();
});

test('close() takes the retry timer with it', async () => {
  const net = relayServer();
  const r = makeRelay({ room: 'r', net, retryMs: 15 });
  r.open();
  net.made[0].fail(2);
  r.close();
  await after(50);
  assert.equal(net.made.length, 1);
  assert.equal(r.status, 'idle');
});

// ------------------------------------------------------------------ the room
test('setRoom rejoins, so a phone frozen on an old room catches up', async () => {
  // The owner's bug: the Home screen app's URL keeps the room it was saved with for
  // ever, and the laptop has since moved to the one the server names.
  const net = relayServer();
  const r = makeRelay({ room: 'oldrm', client: 'c1', net });
  r.open();
  net.made[0].accept();
  assert.equal(roomOf(net.made[0]), 'oldrm');

  r.setRoom('newrm');
  assert.equal(r.room, 'newrm');
  assert.equal(net.made.length, 2, 'the stream was reopened on the new room');
  assert.equal(roomOf(net.made[1]), 'newrm');
  assert.equal(net.made[0].readyState, 2, 'and the old one was closed, not left hanging');

  net.made[1].accept();
  r.send({ type: 'state' });
  await settle();
  assert.ok(net.hits.some(h => h === 'POST /relay/send'));
  r.close();
});

test('setRoom before open() only remembers, and setRoom to the same room does nothing', async () => {
  const net = relayServer();
  const r = makeRelay({ room: 'oldrm', net });
  r.setRoom('newrm');
  assert.equal(net.made.length, 0, 'nothing is opened by a room change alone');
  r.open();
  assert.equal(roomOf(net.made[0]), 'newrm');
  r.setRoom('newrm');
  r.setRoom('');
  assert.equal(net.made.length, 1, 'no reconnect for a room that has not changed');
  r.close();
});

// ------------------------------------------------------------------ the sends
/** A relay whose stream opens and whose POSTs are accepted and never answered. */
function stalledSends() {
  const sent = [];
  return {
    sent,
    fetch: async (url, opts) => {
      if (String(url).includes('/time')) return { ok: true, status: 200, json: async () => ({ t: 1 }) };
      sent.push(JSON.parse(opts.body).type);
      return new Promise(() => {});         // a POST that never comes back
    },
    EventSource: class {
      constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
      close() { this.readyState = 2; }
    },
  };
}

test('the held-key stream cannot pile up behind a server that never answers', async () => {
  const net = stalledSends();
  const r = makeRelay({ room: 'r', net });
  r.open();
  await settle();
  for (let i = 0; i < 50; i++) r.send({ type: 'held', notes: [i] });
  assert.ok(net.sent.length <= 8, `at most a handful in flight, not ${net.sent.length}`);
  r.close();
});

test('and it cannot crowd out the events the phone can never get back', async () => {
  // The bug: one budget for both. A pianist's hands put a `held` on the wire every
  // few milliseconds, the eight slots fill, and from then on every snapshot and every
  // hit is dropped on the floor -- the phone stops following the lesson and no
  // notehead goes green, while the laptop looks perfectly fine.
  const net = stalledSends();
  const r = makeRelay({ room: 'r', net });
  r.open();
  await settle();
  for (let i = 0; i < 50; i++) r.send({ type: 'held', notes: [i] });
  assert.ok(r.send({ type: 'state', si: 3 }), 'a snapshot still goes out');
  assert.ok(r.send({ type: 'hit', n: 60 }), 'so does a hit');
  assert.deepEqual(net.sent.slice(-2), ['state', 'hit']);
  r.close();
});

test('one-shot events still have a ceiling, so a dead server cannot queue for ever', async () => {
  const net = stalledSends();
  const r = makeRelay({ room: 'r', net });
  r.open();
  await settle();
  for (let i = 0; i < 500; i++) r.send({ type: 'state', i });
  assert.ok(net.sent.length <= 64, `a ceiling, not five hundred (${net.sent.length})`);
  r.close();
});

test('a send the relay refuses says so, so the caller can send it again', async () => {
  // host.js only marks a snapshot as published once send() has taken it; a null here
  // is what makes its 200 ms diff loop try the same snapshot again rather than
  // deciding nothing has changed since the one that never left.
  const net = stalledSends();
  const r = makeRelay({ room: 'r', net });
  assert.equal(r.send({ type: 'state' }), null, 'nothing goes out before open()');
  r.open();
  await settle();
  assert.ok(r.send({ type: 'state' }), 'and something does after it');
  r.close();
});

// ------------------------------------------------------------------ the leftovers
test('nothing in the app still probes, or knows what "unavailable" meant', () => {
  // The probe was the machinery that asked, over and over, whether a server had a
  // relay. One /relay/info at the top of the page replaced the lot of it, and a
  // half-removed version of that -- a status nothing sets, a retry rate nothing uses --
  // is worse than either.
  const src = readdirSync(join(ROOT, 'src', 'learn'))
    .filter(f => f.endsWith('.js'))
    .map(f => [f, readFileSync(join(ROOT, 'src', 'learn', f), 'utf8')]);
  for (const [name, text] of src) {
    if (name === 'sync.js') continue;             // "a dropped probe": its own word, its own thing
    assert.doesNotMatch(text, /\bprobe\b/i, `${name} still mentions the probe`);
    assert.doesNotMatch(text, /unavailable/i, `${name} still mentions the unavailable status`);
    assert.doesNotMatch(text, /standDown/, `${name} still has standDown in it`);
  }
});

// The jam: when a note that crossed the relay sounds, and whose notes are whose.
//
// The scheduling is one pure function, so it is tested as arithmetic. The wiring
// around it is tested against a fake relay and a fake `send`, because the two rules
// that matter -- your own notes never come back, and the phone mirror's note stream
// is not the room's playing -- are decisions about *which* messages, not about audio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { playWhen, makeJam, jamLink, HOLD_MS, MAX_AHEAD_MS } from '../src/learn/jam.js';

// ------------------------------------------------------------------ playWhen
test('a note in the future plays at the moment it was played, plus the hold', () => {
  assert.equal(playWhen(1000, 1000), 1030);
  assert.equal(playWhen(1000, 1010), 1040);
  assert.equal(playWhen(1000, 990), 1020);      // 10 ms on the wire, 20 ms of hold left
});

test('a note later than the hold plays at once rather than in the past', () => {
  assert.equal(playWhen(1000, 970), 1000);      // exactly the hold: no waiting left
  assert.equal(playWhen(1000, 900), 1000);      // 100 ms late
  assert.equal(playWhen(1000, -5000), 1000);
});

test('the hold is a knob, and 30 ms is what the room uses', () => {
  assert.equal(HOLD_MS, 30);
  assert.equal(playWhen(1000, 1000, 0), 1000);
  assert.equal(playWhen(1000, 1000, 120), 1120);
});

test('a stamp from a clock that has not agreed plays at once, not in a minute', () => {
  // an unsynced sender's offset is 0, so its stamps are its own page-load origin --
  // holding a note on the strength of that is worse than being early
  assert.equal(playWhen(1000, 1000 + MAX_AHEAD_MS), 1000);
  assert.equal(playWhen(1000, 1e9), 1000);
  assert.equal(playWhen(1000, NaN), 1000);
  assert.equal(playWhen(1000, undefined), 1000);
  // and the edge of the window is still honoured
  assert.equal(playWhen(1000, 1000 + MAX_AHEAD_MS - HOLD_MS), 1000 + MAX_AHEAD_MS);
});

// ------------------------------------------------------------------ the wiring
/** A relay that records what was posted and lets a test push events back. */
function fakeRelay({ client = 'me', offset = 0 } = {}) {
  const sent = [];
  const on = {};
  const statusFns = [];
  return {
    client, offset, sent,
    send(e) { sent.push(e); return true; },
    on(type, fn) { (on[type] ||= []).push(fn); },
    onStatus(fn) { statusFns.push(fn); },
    live() { statusFns.forEach(fn => fn('live')); },
    deliver(type, ev) { (on[type] || []).forEach(fn => fn(ev)); },
  };
}

/** A fake `onMidi`, and the fake `send` the jam plays incoming notes through. */
function rig(opts) {
  const relay = fakeRelay(opts);
  const played = [];
  let midi = () => {};
  const jam = makeJam({
    relay,
    onMidi: fn => { midi = fn; },
    play: (data, at) => played.push({ data, at }),
    now: () => 1000,
  });
  return { relay, jam, played, midi: ev => midi(ev) };
}

test('off, nothing goes out and nothing comes in', () => {
  const { relay, played, midi } = rig();
  midi({ on: 1, n: 60, v: 90, t: 500 });
  relay.deliver('note', { live: 1, from: 'them', data: [0x90, 62, 90], t: 1000 });
  assert.deepEqual(relay.sent, []);
  assert.deepEqual(played, []);
});

test('on, every note the pianist plays goes out signed, stamped in relay time', () => {
  const { relay, jam, midi } = rig({ client: 'aaa', offset: 7000 });
  jam.set(true);
  midi({ on: 1, n: 60, v: 90, t: 500 });
  midi({ on: 0, n: 60, v: 0, t: 800 });
  assert.deepEqual(relay.sent, [
    { type: 'note', live: 1, from: 'aaa', data: [0x90, 60, 90], t: 7500 },
    { type: 'note', live: 1, from: 'aaa', data: [0x80, 60, 0], t: 7800 },
  ]);
  assert.equal(jam.sent, 2);
});

test('the pedal does not travel yet -- it is the room\'s, not one note\'s', () => {
  const { relay, jam, midi } = rig();
  jam.set(true);
  midi({ cc: 64, v: 127, t: 500 });
  assert.deepEqual(relay.sent, []);
});

test('another player\'s note is played through this device\'s Out, held', () => {
  const { relay, jam, played } = rig({ client: 'aaa', offset: 7000 });
  jam.set(true);
  relay.deliver('note', { live: 1, from: 'bbb', data: [0x90, 64, 80], t: 7990 });
  assert.deepEqual(played, [{ data: [0x90, 64, 80], at: 1020 }]);   // 990 local + 30
  // 10 ms of the 30 went on the wire, 20 are left -- the margin the hold is buying
  assert.equal(jam.heard, 1);
  assert.deepEqual(jam.last, { from: 'bbb', data: [0x90, 64, 80], at: 1020, wait: 20 });
});

test('your own notes are never echoed back, however they reach you', () => {
  const { relay, jam, played } = rig({ client: 'aaa' });
  jam.set(true);
  // a laptop hosting a phone *and* jamming is in the room twice, so its own note can
  // come back down the other subscription -- the relay only skips the sender
  relay.deliver('note', { live: 1, from: 'aaa', data: [0x90, 60, 90], t: 1000 });
  assert.deepEqual(played, []);
  assert.equal(jam.heard, 0);
});

test('the phone mirror\'s note stream is not the room\'s playing', () => {
  const { relay, jam, played } = rig();
  jam.set(true);
  // host.js's tap on midi.js: the app's output, on its way to a speaker
  relay.deliver('note', { from: 'bbb', data: [0x90, 60, 90], t: 1000 });
  assert.deepEqual(played, []);
});

test('a malformed note is dropped rather than thrown at the synth', () => {
  const { relay, jam, played } = rig();
  jam.set(true);
  relay.deliver('note', { live: 1, from: 'bbb', t: 1000 });
  relay.deliver('note', { live: 1, from: 'bbb', data: [0x90], t: 1000 });
  assert.deepEqual(played, []);
});

// ------------------------------------------------------------------ the link
test('the other player is sent to this machine\'s address, not to localhost', () => {
  const info = { port: 8765, tls: false, bind: '0.0.0.0', addrs: ['192.168.1.5'], room: 'kdjf3n' };
  assert.equal(jamLink('http://localhost:8765/learn.html', info, 'kdjf3n'),
    '192.168.1.5:8765/learn.html?room=kdjf3n');
  // a page already open on a routable address is left where it is
  assert.equal(jamLink('http://192.168.1.5:8765/learn.html', info, 'kdjf3n'),
    '192.168.1.5:8765/learn.html?room=kdjf3n');
  // no server to ask: the page's own address is all there is to go on
  assert.equal(jamLink('http://localhost:8765/learn.html', null, 'kdjf3n'),
    'localhost:8765/learn.html?room=kdjf3n');
});

// ------------------------------------------------------------------ who is here
test('a player says what it is, and counts the others who say so', () => {
  const { relay, jam } = rig({ client: 'aaa' });
  jam.set(true);
  relay.sent.length = 0;
  relay.live();
  relay.deliver('join', { subs: 2 });
  assert.deepEqual(relay.sent, [
    { type: 'player', from: 'aaa' },     // the stream came up
    { type: 'player', from: 'aaa' },     // and again, so the newcomer hears it
  ]);
  assert.equal(jam.players, 0);
  relay.deliver('player', { from: 'bbb' });
  relay.deliver('player', { from: 'bbb' });        // the half-minute re-announce
  assert.equal(jam.players, 1);
  // a phone mirroring the laptop is in the same room and is not a player
  relay.deliver('mirror', { from: 'ccc' });
  assert.equal(jam.players, 1);
  relay.deliver('leave', { client: 'bbb' });
  assert.equal(jam.players, 0);
});

test('turned off, nobody is announced to and nobody is counted', () => {
  const { relay, jam } = rig();
  jam.set(true);
  relay.deliver('player', { from: 'bbb' });
  assert.equal(jam.players, 1);
  jam.set(false);
  relay.sent.length = 0;
  relay.live();
  assert.deepEqual(relay.sent, []);
  assert.equal(jam.players, 0);
});

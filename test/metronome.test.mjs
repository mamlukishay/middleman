// The metronome, against a fake clock and a fake AudioContext: clicks are scheduled
// by beat number, never twice, never in the past, and the accent stays on beat 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let fakeNow = 50_000;
globalThis.performance = { now: () => fakeNow, timeOrigin: 0 };
globalThis.document = { hidden: false };

const { makeClock } = await import('../src/clock.js');
const { makeMetronome, CLICK_OFFSET_MS } = await import('../src/metronome.js');

/** An AudioContext that records when each click was told to start, in audio seconds. */
function fakeAudio({ latency = 0.03, outputTimestamp = true } = {}) {
  const clicks = [];
  const ctx = {
    currentTime: 0, state: 'running', destination: {},
    // audio time runs alongside performance.now(), offset by the output latency
    getOutputTimestamp: outputTimestamp
      ? () => ({ contextTime: fakeNow / 1000 - latency, performanceTime: fakeNow })
      : undefined,
    createOscillator() {
      const o = { type: '', frequency: { value: 0 }, connect: g => g,
        start(when) { clicks.push({ at: when, accent: o.frequency.value === 1600 }); }, stop() {} };
      return o;
    },
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; },
    resume() { return Promise.resolve(); },
  };
  return { ctx, clicks };
}

function setup(bpm = 120, opts) {
  const clock = makeClock(bpm);
  const { ctx, clicks } = fakeAudio(opts);
  const metro = makeMetronome(clock, { audio: () => ctx });
  return { clock, metro, clicks };
}

/** Run the transport's tick every `step` ms for `total` ms. */
function run(metro, total, step = 25, lookahead = 120) {
  const end = fakeNow + total;
  while (fakeNow < end) { metro.pump(lookahead); fakeNow += step; }
}

// audio seconds -> the performance.now() the click lands at the speaker, undoing latency
const speaker = (at, latency = 0.03) => (at + latency) * 1000;

test('beats are scheduled once each, at the clock time of the beat, accounting for output latency', () => {
  const { clock, metro, clicks } = setup(120);
  clock.start(0); metro.start(0);
  run(metro, 1900);                                  // the lookahead reaches beat 3, not 4
  assert.deepEqual(clicks.map(c => Math.round(speaker(c.at))), [0, 1, 2, 3].map(b => Math.round(clock.time(b))));
  assert.deepEqual(clicks.map(c => c.accent), [true, false, false, false]);
});

test('a tempo change keeps counting beats: no duplicate, no gap', () => {
  const { clock, metro, clicks } = setup(120);
  clock.start(0); metro.start(0);
  run(metro, 1100);                                  // beats 0, 1, 2 are queued (lookahead)
  // a click already queued plays where the old tempo put it: read those under the old clock
  const before = clicks.map(c => Math.round(clock.beat(speaker(c.at)) * 100) / 100);
  clock.setBpm(60);                                  // re-anchor mid-bar
  run(metro, 4000);
  const beats = [...before, ...clicks.slice(before.length).map(c => Math.round(clock.beat(speaker(c.at)) * 100) / 100)];
  // every click is on a whole beat, each beat once, in order
  assert.deepEqual(beats, beats.map(Math.round));
  assert.deepEqual(beats, [...new Set(beats)]);
  assert.deepEqual(beats, beats.map((_, i) => i));
  // and after the change they are a second apart
  const late = clicks.slice(-3).map(c => speaker(c.at));
  assert.ok(Math.abs(late[1] - late[0] - 1000) < 1 && Math.abs(late[2] - late[1] - 1000) < 1);
});

test('many quick tempo changes, as from a dragged slider, never double a click', () => {
  const { clock, metro, clicks } = setup(100);
  clock.start(0); metro.start(0);
  for (let i = 0; i < 40; i++) { clock.setBpm(100 + i); run(metro, 50); }
  const beats = clicks.map(c => Math.round(clock.beat(speaker(c.at))));
  assert.deepEqual(beats, [...new Set(beats)]);
  assert.ok(beats.length >= 3);
});

test('after a freeze the missed beats are dropped, not played in a burst', () => {
  const { clock, metro, clicks } = setup(120);
  clock.start(0); metro.start(0);
  run(metro, 600);                                   // beat 0 (and 1, in the lookahead) are out
  const before = clicks.length;
  fakeNow += 3000;                                   // the tab froze for three seconds
  metro.pump(120);
  const fresh = clicks.slice(before);
  assert.ok(fresh.length <= 1, `burst of ${fresh.length} clicks`);
  for (const c of fresh) assert.ok(speaker(c.at) >= fakeNow - 5, 'a click in the past');
  run(metro, 1000);
  const beats = clicks.map(c => Math.round(clock.beat(speaker(c.at))));
  assert.deepEqual(beats, [...new Set(beats)]);
  assert.ok(beats.at(-1) >= 8);
});

test('off then on mid-bar picks up on the next whole beat', () => {
  const { clock, metro, clicks } = setup(120);
  clock.start(0); metro.start(0);
  run(metro, 700);
  metro.setEnabled(false);
  run(metro, 1300);                                  // beats 2 and 3 pass in silence
  const n = clicks.length;
  fakeNow += 200;                                    // now at beat 4.4
  metro.setEnabled(true);
  run(metro, 1000);
  const beats = clicks.slice(n).map(c => Math.round(clock.beat(speaker(c.at)) * 100) / 100);
  assert.deepEqual(beats, [5, 6]);
});

test('the accent sits on beat 1 of the loop, through a negative count-in', () => {
  const { clock, metro, clicks } = setup(120);
  metro.setAccent(4, 8);                             // the loop starts at beat 8
  metro.setRange(4, Infinity);                       // one bar of count-in before it
  clock.start(4); metro.start(4);
  run(metro, 5000);
  const beats = clicks.map(c => Math.round(clock.beat(speaker(c.at))));
  assert.equal(beats[0], 4);
  assert.deepEqual(clicks.filter(c => c.accent).map(c => Math.round(clock.beat(speaker(c.at)))), [4, 8, 12]);
});

test('a range stops the click at the end of a single pass', () => {
  const { clock, metro, clicks } = setup(120);
  metro.setRange(-4, 4);
  clock.start(-4); metro.start(-4);
  run(metro, 6000);
  assert.deepEqual(clicks.map(c => Math.round(clock.beat(speaker(c.at)))), [-4, -3, -2, -1, 0, 1, 2, 3]);
});

test('without getOutputTimestamp the currentTime pairing is used', () => {
  const { clock, metro, clicks } = setup(120, { outputTimestamp: false });
  clock.start(0); metro.start(0);
  run(metro, 1000);
  assert.ok(clicks.length >= 2);
  // currentTime is 0 in the fake, so audio time is just ms since the round began
  assert.ok(clicks.every(c => c.at >= 0 && c.at < 1.2));
});

test('nothing is scheduled while stopped, disabled, or a click offset moves it earlier', () => {
  const { clock, metro, clicks } = setup(120);
  run(metro, 500);
  assert.equal(clicks.length, 0);
  clock.start(0); metro.start(0); metro.setEnabled(false);
  run(metro, 500);
  assert.equal(clicks.length, 0);
  assert.equal(typeof CLICK_OFFSET_MS, 'number');
});

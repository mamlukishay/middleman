// The clock sync behind remote mode, against fake round trips: the NTP filter and
// the anchor conversion. Both are pure, which is the point of keeping them out of
// remote.js -- the thing that has to be right is arithmetic, not plumbing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetOf, rttOf, estimateOffset, toServer, toLocal, beatAt, anchorClock, makeSync }
  from '../src/learn/sync.js';
import { makeClock } from '../src/clock.js';

/**
 * A round trip on a link whose request and reply legs took `up` and `down` ms, with
 * the server's clock `offset` ahead of the client's.
 */
const trip = (sent, offset, up, down) =>
  ({ sent, server: sent + up + offset, recv: sent + up + down });

test('a symmetric round trip reads the offset exactly', () => {
  assert.equal(offsetOf(trip(1000, 250, 4, 4)), 250);
  assert.equal(rttOf(trip(1000, 250, 4, 4)), 8);
});

test('an asymmetric round trip is out by half the asymmetry', () => {
  // the reply leg took 20 ms longer, so the estimate is 10 ms early
  assert.equal(offsetOf(trip(0, 250, 2, 22)), 240);
});

test('the filter keeps the shortest round trips and takes their median', () => {
  const samples = [
    trip(0, 500, 3, 3),        // 6 ms, honest
    trip(50, 500, 3, 3),       // 6 ms, honest
    trip(100, 500, 40, 4),     // 44 ms, badly skewed
    trip(150, 500, 4, 60),     // 64 ms, badly skewed
  ];
  const e = estimateOffset(samples);
  assert.equal(e.n, 2);                    // the best half of four
  assert.equal(e.offset, 500);             // the skewed pair never enters the median
  assert.equal(e.rtt, 6);
  assert.equal(e.spread, 0);
});

test('a single outlier cannot move the median', () => {
  const clean = Array.from({ length: 7 }, (_, i) => trip(i * 10, 120, 3, 3));
  const e = estimateOffset([...clean, trip(999, 120, 200, 1)]);
  assert.equal(e.offset, 120);
});

test('spread reports how far apart the kept samples were', () => {
  const e = estimateOffset([trip(0, 100, 3, 3), trip(10, 100, 4, 2), trip(20, 100, 2, 4)], { keep: 1 });
  assert.equal(e.offset, 100);
  assert.equal(e.spread, 2);               // +1 and -1 around the truth
});

test('no usable samples degrades to no offset rather than NaN', () => {
  const e = estimateOffset([]);
  assert.deepEqual(e, { offset: 0, rtt: 0, n: 0, spread: 0 });
});

test('server and local time convert both ways', () => {
  assert.equal(toServer(1000, 250), 1250);
  assert.equal(toLocal(1250, 250), 1000);
  assert.equal(toLocal(toServer(7, -3), -3), 7);
});

// ---------------------------------------------------------------- the anchor
test('the anchor puts both machines on the same beat', () => {
  // the laptop started beat 0 at its own performance.now() 4000, and its clock runs
  // 10_000 ms behind the relay's, so beat 0 is relay time 14000
  const t0 = 14000, bpm = 120;             // 500 ms a beat
  // the phone's clock is 3000 ms ahead of the relay's: offset = -3000
  const offset = -3000;
  // at phone-local 12500 the relay says 9500, which is 4500 ms before beat 0
  assert.equal(beatAt({ t0, bpm }, offset, 12500), -9);
  assert.equal(beatAt({ t0, bpm }, offset, 17000), 0);
  assert.equal(beatAt({ t0, bpm }, offset, 17500), 1);
});

// makeClock anchors itself against the real performance.now(), so these compare in
// microbeats rather than exactly: a few microseconds pass between the calls.
const NEAR = 1e-3;

test('anchorClock lands a running clock on that beat and keeps its tempo', () => {
  const clock = makeClock(60);
  const now = performance.now();
  const beat = anchorClock(clock, { t0: 1000, bpm: 96, running: true }, 0, now);
  assert.equal(clock.bpm, 96);
  assert.equal(clock.running, true);
  assert.ok(Math.abs(beat - (now - 1000) / (60000 / 96)) < 1e-9);
  assert.ok(Math.abs(clock.beat() - beat) < NEAR);
  // and it keeps running from there: a beat later on the wall is a beat later musically
  const t = performance.now();
  assert.ok(Math.abs(clock.beat(t + 60000 / 96) - clock.beat(t) - 1) < 1e-9);
});

test('anchorClock freezes a stopped clock on the anchor beat', () => {
  const clock = makeClock(60);
  const now = performance.now();
  anchorClock(clock, { t0: now - 3 * 500, bpm: 120, running: false }, 0, now);
  assert.equal(clock.running, false);
  assert.ok(Math.abs(clock.beat() - 3) < NEAR);
});

test('two devices with different offsets agree on the beat', () => {
  // the same anchor, read on two machines whose clocks are nowhere near each other
  const anchor = { t0: 500_000, bpm: 84 };
  const laptop = { offset: 20_000 }, phone = { offset: -1_234_567 };
  const wall = 900_000;                    // one moment in relay time
  const onLaptop = beatAt(anchor, laptop.offset, wall - laptop.offset);
  const onPhone = beatAt(anchor, phone.offset, wall - phone.offset);
  assert.ok(Math.abs(onLaptop - onPhone) < 1e-9);
});

// ---------------------------------------------------------------- the measurer
test('makeSync runs its rounds and adopts the filtered estimate', async () => {
  const OFFSET = 777;
  const legs = [[2, 2], [3, 3], [60, 2], [2, 2]];     // one badly skewed trip among four
  let t = 0, i = 0;
  const sync = makeSync({
    now: () => t,
    gap: 0,
    rounds: 4,
    // the fake link: the request leg, then the server's stamp, then the reply leg
    fetchTime: async () => { const [up, down] = legs[i++]; t += up; const s = t + OFFSET; t += down; return s; },
  });
  await sync.measure();
  assert.ok(sync.ready);
  assert.equal(i, 4);
  assert.equal(sync.offset, OFFSET);                   // the skewed trip never enters the median
  assert.equal(sync.rtt, 4);
});

test('makeSync never runs two measurements at once', async () => {
  let calls = 0;
  const sync = makeSync({ now: () => 0, gap: 0, rounds: 3, fetchTime: async () => { calls++; return 5; } });
  const [a, b] = await Promise.all([sync.measure(), sync.measure()]);
  assert.equal(calls, 3);
  assert.equal(a, b);
  assert.equal(sync.offset, 5);
});

test('makeSync survives probes that reject', async () => {
  let n = 0;
  const sync = makeSync({
    now: () => 0, gap: 0, rounds: 4,
    fetchTime: async () => { if (n++ % 2) throw new Error('dropped'); return 42; },
  });
  await sync.measure();
  assert.equal(sync.offset, 42);
  assert.equal(sync.last.n, 1);            // two samples survived, the best half is one
});

// The software piano against a fake AudioContext: a note-on lays an envelope down at
// the mapped audio time, a note-off releases, the pedal holds the release, and the
// voice cap steals rather than piling voices up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let fakeNow = 50_000;
globalThis.performance = { now: () => fakeNow, timeOrigin: 0 };
globalThis.document = { hidden: false };

const { makeSynth } = await import('../src/synth.js');

const LATENCY = 0.03;

/** An AudioParam that records every scheduled change, in order. */
function param(log, name) {
  const rec = (op, v, t) => { log.push({ p: name, op, v, t }); };
  return {
    value: 0,
    setValueAtTime(v, t) { rec('set', v, t); return this; },
    exponentialRampToValueAtTime(v, t) { rec('exp', v, t); return this; },
    linearRampToValueAtTime(v, t) { rec('lin', v, t); return this; },
    cancelScheduledValues(t) { rec('cancel', undefined, t); return this; },
    setTargetAtTime(v, t) { rec('target', v, t); return this; },
  };
}

function fakeAudio({ hold = true } = {}) {
  const gains = [], oscs = [];
  const ctx = {
    currentTime: 0, state: 'running', sampleRate: 48000, destination: { name: 'out' },
    getOutputTimestamp: () => ({ contextTime: fakeNow / 1000 - LATENCY, performanceTime: fakeNow }),
    createOscillator() {
      const o = { type: '', frequency: { value: 0 }, started: null, stopped: null,
        connect: x => x, start(t) { o.started = t; }, stop(t) { o.stopped = t; } };
      oscs.push(o);
      return o;
    },
    createGain() {
      const log = [];
      const g = { log, gain: param(log, 'gain'), connect: x => x, disconnect() {} };
      if (hold) g.gain.cancelAndHoldAtTime = t => { log.push({ p: 'gain', op: 'hold', t }); };
      gains.push(g);
      return g;
    },
    createBiquadFilter() {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: x => x };
    },
    createDynamicsCompressor() {
      return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
        attack: { value: 0 }, release: { value: 0 }, connect: x => x };
    },
    resume() { return Promise.resolve(); },
  };
  return { ctx, gains, oscs };
}

function setup(opts) {
  const f = fakeAudio(opts);
  return { ...f, synth: makeSynth({ audio: () => f.ctx }) };
}

// the audio second a performance ms maps to, latency included
const mapped = ms => ms / 1000 - LATENCY;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a note-on lays an attack and a decay down at the mapped audio time', () => {
  const { synth, gains, oscs } = setup();
  synth.noteOn(60, 100, fakeNow + 200);
  const when = mapped(fakeNow + 200);
  // the voice envelope is the gain with a full set/exp/exp on it
  const voice = gains.find(g => g.log.some(e => e.op === 'set'));
  assert.ok(voice, 'no envelope was scheduled');
  const [a, b, c] = voice.log;
  assert.equal(a.op, 'set');
  assert.ok(near(a.t, when), `attack at ${a.t}, expected ${when}`);
  assert.equal(b.op, 'exp');
  assert.ok(b.v > 0.1 && b.t > a.t && b.t < a.t + 0.02, 'attack is fast and audible');
  assert.equal(c.op, 'exp');
  assert.ok(c.v < 1e-3 && c.t > b.t + 0.5, 'a long exponential decay follows');
  // three oscillators, all started exactly at the mapped time
  assert.equal(oscs.length, 3);
  for (const o of oscs) assert.ok(near(o.started, when));
  assert.equal(synth.scheduled, 1);
  assert.equal(synth.active, 1);
});

test('the decay is longer for a low note than a high one', () => {
  const { synth, gains } = setup();
  synth.noteOn(28, 90, fakeNow);
  synth.noteOn(96, 90, fakeNow);
  const [low, high] = gains.filter(g => g.log.some(e => e.op === 'set'));
  const rings = g => g.log.filter(e => e.op === 'exp').at(-1).t - g.log[0].t;
  assert.ok(rings(low) > rings(high) * 3, `bass ${rings(low)}s vs treble ${rings(high)}s`);
});

test('velocity scales the peak of the envelope', () => {
  const { synth, gains } = setup();
  synth.noteOn(60, 30, fakeNow);
  synth.noteOn(64, 110, fakeNow);
  const [soft, loud] = gains.filter(g => g.log.some(e => e.op === 'set'));
  const peak = g => g.log.find(e => e.op === 'exp').v;
  assert.ok(peak(loud) > peak(soft) * 2, `soft ${peak(soft)} vs loud ${peak(loud)}`);
  assert.ok(peak(loud) <= 1);
});

test('a note-off releases the voice at its own time, and stops the oscillators', () => {
  const { synth, gains, oscs } = setup();
  synth.noteOn(60, 90, fakeNow);
  const voice = gains.find(g => g.log.some(e => e.op === 'set'));
  const before = voice.log.length;
  synth.noteOff(60, fakeNow + 500);
  const rel = voice.log.slice(before);
  const off = mapped(fakeNow + 500);
  assert.equal(rel[0].op, 'hold');
  assert.ok(near(rel[0].t, off));
  assert.equal(rel[1].op, 'exp');
  assert.ok(rel[1].v < 1e-3 && rel[1].t > off && rel[1].t < off + 0.3, 'a short release');
  for (const o of oscs) assert.ok(o.stopped < off + 0.4, 'the oscillators are cut short');
});

test('without cancelAndHoldAtTime the release still cancels and ramps', () => {
  const { synth, gains } = setup({ hold: false });
  synth.noteOn(60, 90, fakeNow);
  const voice = gains.find(g => g.log.some(e => e.op === 'set'));
  const before = voice.log.length;
  synth.noteOff(60, fakeNow + 100);
  assert.deepEqual(voice.log.slice(before).map(e => e.op), ['cancel', 'exp']);
});

test('the pedal holds the release until it comes up', () => {
  const { synth, gains } = setup();
  synth.setPedal(true, fakeNow);
  synth.noteOn(60, 90, fakeNow);
  const voice = gains.find(g => g.log.some(e => e.op === 'set'));
  const before = voice.log.length;
  synth.noteOff(60, fakeNow + 200);
  assert.equal(voice.log.length, before, 'the damper must wait for the pedal');
  assert.equal(synth.active, 1);
  synth.setPedal(false, fakeNow + 900);
  const rel = voice.log.slice(before);
  assert.equal(rel.at(-1).op, 'exp');
  assert.ok(near(rel[0].t, mapped(fakeNow + 900)), 'released when the pedal came up');
});

test('allOff silences every voice, pedal down or not', () => {
  const { synth, gains } = setup();
  synth.setPedal(true, fakeNow);
  for (const n of [55, 60, 64, 67]) synth.noteOn(n, 90, fakeNow);
  synth.allOff(fakeNow + 10);
  const voices = gains.filter(g => g.log.some(e => e.op === 'set'));
  assert.equal(voices.length, 4);
  for (const v of voices) assert.equal(v.log.at(-1).op, 'exp', 'a voice was left ringing');
  assert.equal(synth.pedal, false);
});

test('a repeated note re-strikes rather than stacking two voices on one pitch', () => {
  const { synth, gains } = setup();
  synth.noteOn(60, 90, fakeNow);
  const first = gains.find(g => g.log.some(e => e.op === 'set'));
  const before = first.log.length;
  synth.noteOn(60, 90, fakeNow + 300);
  assert.ok(first.log.length > before, 'the old voice was not let go');
  assert.equal(synth.active, 1);
});

test('voice stealing keeps the count at the cap', () => {
  const { synth } = setup();
  for (let i = 0; i < 40; i++) synth.noteOn(21 + i, 90, fakeNow);
  assert.equal(synth.scheduled, 40);
  assert.ok(synth.active <= 24, `${synth.active} voices sounding`);
  assert.ok(synth.active >= 20, 'it should not have thrown everything away');
});

test('a time already gone is clamped to now, never scheduled in the past', () => {
  const { synth, ctx, oscs } = setup();
  ctx.currentTime = 60;                    // the audio clock has run past that moment
  synth.noteOn(60, 90, fakeNow - 4000);
  for (const o of oscs) assert.ok(o.started >= 60, `started at ${o.started}, before now`);
});

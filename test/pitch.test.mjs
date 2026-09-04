// The guitar page's pitch detector against tones we already know the answer to:
// every open string and a few frets up, as a plain sine and as a sawtooth (a
// sawtooth is the honest case -- a pickup's second harmonic is louder than its
// fundamental, and a detector that follows the loudest partial fails here).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detect, noteOf, rms } from '../src/guitar/pitch.js';

const SR = 44100;
const W = 4096;

const sine = (f, n = W, sr = SR) => {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / sr);
  return x;
};

/** A band-limited sawtooth: every harmonic up to Nyquist, at 1/k. Aliasing would
 *  add broadband noise and turn a pitch test into a luck test. */
const saw = (f, n = W, sr = SR) => {
  const x = new Float32Array(n);
  for (let k = 1; k * f < sr / 2; k++)
    for (let i = 0; i < n; i++) x[i] += 0.3 * Math.sin(2 * Math.PI * k * f * i / sr) / k;
  return x;
};

// name -> frequency: the six open strings, then 5th and 12th fret on the low E,
// the 3rd fret on the D string, and a high one to prove the top of the range
const PITCHES = {
  E2: 82.41, A2: 110.00, D3: 146.83, G3: 196.00, B3: 246.94, E4: 329.63,
  A2b: 110.00, F2: 87.31, E3: 164.81, F3: 174.61, C4: 261.63, G4: 392.00,
};

for (const [label, f] of Object.entries(PITCHES)) {
  const name = label.replace(/b$/, '');
  for (const [shape, make] of [['sine', sine], ['sawtooth', saw]]) {
    test(`detect: ${shape} at ${name} (${f} Hz)`, () => {
      const r = detect(make(f), SR);
      assert.ok(r, `nothing detected for ${name}`);
      const n = noteOf(r.freq);
      assert.equal(n.name, name, `heard ${n.name} (${r.freq.toFixed(1)} Hz)`);
      assert.ok(Math.abs(n.cents) <= 10, `${name} off by ${n.cents.toFixed(1)} cents`);
      assert.ok(r.clarity > 0.8, `clarity only ${r.clarity.toFixed(2)}`);
    });
  }
}

test('detect: a detuned string reads as the nearest note, bent', () => {
  const flat = 82.41 * 2 ** (-30 / 1200);          // E2, 30 cents flat
  const r = detect(saw(flat), SR);
  const n = noteOf(r.freq);
  assert.equal(n.name, 'E2');
  assert.ok(Math.abs(n.cents - -30) <= 10, `read ${n.cents.toFixed(1)} cents, wanted -30`);
});

test('detect: silence is nothing, not a note', () => {
  assert.equal(detect(new Float32Array(W), SR), null);
});

test('detect: a DC offset on its own is silence too', () => {
  assert.equal(detect(new Float32Array(W).fill(0.4), SR), null);
});

test('detect: noise is nothing', () => {
  // a fixed sequence, so a red run is a real regression and not one unlucky seed
  let seed = 12345;
  const x = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    x[i] = (seed / 0x3fffffff - 1) * 0.3;
  }
  assert.equal(detect(x, SR), null);
});

test('detect: a frame too short for the lowest note it is asked about is nothing', () => {
  // 256 samples is 5.8 ms -- not half a period of a low E, so there is nothing to see
  assert.equal(detect(sine(82.41, 256), SR), null);
});

test('detect: the search range is honoured', () => {
  // Told to look above 150 Hz, a low E is simply not there. (A note *above* fmax is
  // a different matter and this deliberately does not claim otherwise: anything that
  // repeats every T also repeats every 2T, so a 1600 Hz saw searched below 1200 is
  // honestly found at 800. The guitar's top fret is inside the default range, so on
  // this page that case never arises.)
  assert.equal(detect(sine(82.41), SR, { fmin: 150 }), null);
});

test('detect: works at 48 kHz too, since the browser picks the rate', () => {
  const r = detect(sine(146.83, W, 48000), 48000);
  assert.equal(noteOf(r.freq).name, 'D3');
});

test('noteOf: A440 is A4, dead on', () => {
  const n = noteOf(440);
  assert.equal(n.midi, 69);
  assert.equal(n.name, 'A4');
  assert.ok(Math.abs(n.cents) < 0.001);
});

test('noteOf: cents stay inside a semitone either way', () => {
  for (const f of [82.41, 100, 130.81, 300, 440, 1000]) {
    const n = noteOf(f);
    assert.ok(n.cents > -50 && n.cents <= 50, `${f} Hz gave ${n.cents} cents`);
  }
});

test('noteOf: the low E string is MIDI 40', () => {
  assert.equal(noteOf(82.41).midi, 40);
  assert.equal(noteOf(329.63).midi, 64);   // and the high E is 40 + two octaves
});

test('rms: a full-scale sine is 1/sqrt(2), silence is 0', () => {
  const x = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) x[i] = Math.sin(2 * Math.PI * 4 * i / 1024);
  assert.ok(Math.abs(rms(x) - Math.SQRT1_2) < 0.01);
  assert.equal(rms(new Float32Array(1024)), 0);
});

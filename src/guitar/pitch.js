// Pitch detection for the guitar page: YIN, on one frame of samples at a time.
//
// Why YIN and not "find the tallest peak in an FFT": a guitar through an amp puts
// more energy in the 2nd and 3rd harmonic than in the fundamental, so the tallest
// peak is routinely an octave or a twelfth above the note the string is playing.
// YIN asks a different question -- at what lag does the wave most nearly repeat
// itself -- and its cumulative-mean step deliberately biases the answer towards the
// *longest* period that fits, which is exactly the octave-error guard we need.
//
// Everything here is pure: frames in, numbers out. The microphone, the gating and
// the smoothing all live in app.js.

import { noteName } from '../theory.js';

const DEFAULTS = {
  fmin: 65,        // just under C2 -- a low E string is 82.4 Hz, drop tunings a bit under
  fmax: 1200,      // well above the 24th fret of the high E (1318 Hz is unreachable on this neck anyway)
  threshold: 0.15, // YIN's absolute threshold on d'(tau); the paper's 0.1, loosened for a noisy pickup
};

/**
 * @param {Float32Array} frame   time-domain samples, 2048 or more
 * @param {number} sampleRate
 * @returns {{freq:number, clarity:number}|null}  null when nothing periodic is there
 */
export function detect(frame, sampleRate, opts = {}) {
  const { fmin, fmax, threshold } = { ...DEFAULTS, ...opts };
  const W = frame.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
  const tauMax = Math.min(W >> 1, Math.ceil(sampleRate / fmin));
  if (tauMax <= tauMin + 1) return null;   // frame too short to hold two periods of fmin

  // DC first. A USB interface parks its idle level a hair off zero, and a constant
  // offset survives every lag equally -- it flattens d(tau) and drags clarity down.
  let mean = 0;
  for (let i = 0; i < W; i++) mean += frame[i];
  mean /= W;
  const x = new Float64Array(W);
  let energy = 0;
  for (let i = 0; i < W; i++) { x[i] = frame[i] - mean; energy += x[i] * x[i]; }
  // digital silence: every d(tau) is 0 and the normalisation below is 0/0
  if (energy < 1e-12 * W) return null;

  // d(tau): squared difference between the frame and itself shifted by tau
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0, n = W - tau; j < n; j++) { const dx = x[j] - x[j + tau]; s += dx * dx; }
    d[tau] = s;
  }

  // d'(tau): each lag divided by the running mean of the lags below it. This is the
  // whole trick -- d(tau) is smallest at tau=0 and generally shrinks with tau, and
  // dividing by the running mean removes that slope so a real period stands out.
  const dn = new Float64Array(tauMax + 1);
  dn[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    dn[tau] = run === 0 ? 1 : d[tau] * tau / run;
  }

  // The *first* dip below the threshold, not the deepest one anywhere: d'(tau) dips
  // just as deep at two and three times the period, so the deepest dip in the frame is
  // regularly an octave or a twelfth below the note being played.
  const firstDip = thr => {
    for (let t = tauMin; t <= tauMax; t++) {
      if (dn[t] < thr) {
        while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++;   // walk to the bottom of this dip
        return t;
      }
    }
    return -1;
  };

  let tau = firstDip(threshold);
  if (tau < 0) {
    // Nothing was that clean. A picked string through a distorting amp often is not:
    // it decays, the room rings, two strings sound at once. So relax to "as good as
    // this frame gets" and hand the caller a low clarity to gate on -- but only if the
    // frame repeats itself at all. On silence and on noise the best dip is shallow,
    // and this is where those two turn into null.
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (dn[t] < dn[best]) best = t;
    if (dn[best] >= 0.5) return null;
    tau = firstDip(Math.min(0.5, dn[best] + 0.05));
    if (tau < 0) tau = best;
  }

  // Parabolic interpolation around the minimum: at 44.1 kHz one whole sample of lag is
  // about 15 cents at E2 and 60 at E4, so a needle without this would quantise visibly.
  let refined = tau;
  if (tau > tauMin && tau < tauMax) {
    const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) refined = tau + (c - a) / denom;
  }

  const freq = sampleRate / refined;
  if (!(freq >= fmin && freq <= fmax)) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - dn[tau])) };
}

/**
 * A frequency as a note: MIDI number, name (`noteName`, so it matches the rest of
 * the app) and how far off that note it is, -50..+50 cents.
 */
export function noteOf(freq) {
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  return { midi, name: noteName(midi), cents: (exact - midi) * 100 };
}

/** Level of a frame, 0..1. The app's gate and its meter both want it. */
export function rms(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}

// A software piano, for checking the app with no piano plugged in.
//
// Not a sampler and not trying to be: it is a check tool, so notes have to be
// recognisable, in tune and in time, and chords must not clip. One voice is a
// triangle plus two quiet sine partials through a low-pass, with a percussive
// envelope -- fast attack, exponential decay, short release on note-off -- and the
// decay is scaled by pitch so the bass rings on while the top drops away, which is
// most of what makes a struck string sound like one.
//
// It shares the metronome's AudioContext and, more importantly, the metronome's
// performance.now() -> audio-time mapping: the click and the notes have to be on
// the same ruler, latency compensation included, or the app's own timing cannot be
// judged by ear. Every voice is scheduled ahead through that mapping, never in the
// past (a time already gone is clamped to now rather than fired late).
//
// CC64 is honoured, because the learn and looper pages pass the pedal through and a
// sustained chord is exactly the case where a naive synth falls apart.

import { audio, mapper } from './metronome.js';

const MAX_VOICES = 24;       // beyond this the oldest voice is stolen
const ATTACK_S = 0.004;
const RELEASE_S = 0.12;      // damper falling on the string
const STEAL_S = 0.03;        // a stolen voice gets out of the way faster
const SILENT = 0.0001;       // exponential ramps cannot reach zero
const MASTER = 0.22;         // headroom for a two-handed chord
const MAP_TTL_MS = 100;      // re-read the clock mapping at most this often

const hz = n => 440 * Math.pow(2, (n - 69) / 12);

/** Bass rings, treble drops: ~14 s at A0 down to ~1.3 s at C8. */
const decayOf = n => 14 * Math.pow(2, -(n - 21) / 26);

/**
 * @param opts.audio  swaps the AudioContext source, for tests.
 * @param opts.map    swaps the performance -> audio time mapping, for tests.
 */
export function makeSynth(opts = {}) {
  const getAudio = opts.audio || audio;
  const getMap = opts.map || mapper;

  let a = null, master = null;
  let voices = [];             // { n, oscs, gain, endsAt, off, sustained }
  let pedal = false;
  let scheduled = 0;           // note-ons handed to the audio thread, for the checks
  let cache = null, cacheAt = -1e9;

  /** The graph is built once per context: voices -> master -> limiter -> out. */
  function ctx() {
    const next = getAudio();
    if (next !== a) {
      a = next;
      master = a.createGain();
      master.gain.value = MASTER;
      // a compressor rather than a hard clip: chords lean on it instead of tearing
      const lim = a.createDynamicsCompressor();
      lim.threshold.value = -10;
      lim.knee.value = 6;
      lim.ratio.value = 12;
      lim.attack.value = 0.003;
      lim.release.value = 0.25;
      master.connect(lim).connect(a.destination);
      voices = [];
    }
    return a;
  }

  /** performance.now() -> audio seconds, never behind the context's own now. */
  function at(perfMs) {
    const now = performance.now();
    if (!cache || now - cacheAt > MAP_TTL_MS) { cache = getMap(a); cacheAt = now; }
    return Math.max(a.currentTime, cache.toAudio(perfMs ?? now));
  }

  /** Voices whose tail is over are dropped, so the cap counts sounding notes only. */
  function prune() {
    voices = voices.filter(v => v.endsAt > a.currentTime);
  }

  /**
   * Bring a voice down from wherever its envelope is. cancelAndHoldAtTime is the
   * only way to leave the attack/decay curve mid-flight without a click; without it
   * (older engines, the test double) cancelling and ramping is close enough.
   */
  function release(v, when, secs = RELEASE_S) {
    if (v.off) return;
    v.off = true;
    const g = v.gain.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(when);
    else g.cancelScheduledValues(when);
    g.exponentialRampToValueAtTime(SILENT, when + secs);
    v.endsAt = when + secs;
    for (const o of v.oscs) { try { o.stop(when + secs + 0.01); } catch { /* already stopped */ } }
  }

  return {
    get scheduled() { return scheduled; },
    get active() { prune(); return voices.filter(v => !v.off).length; },   // still sounding
    get pedal() { return pedal; },

    /** @param v  MIDI velocity 1..127. @param whenPerfMs  when it should sound. */
    noteOn(n, v = 90, whenPerfMs) {
      ctx();
      const when = at(whenPerfMs);
      prune();
      // a repeated note re-strikes: the old one has to get out of the way first
      for (const old of voices) if (old.n === n && !old.off) release(old, when, STEAL_S);
      if (voices.filter(x => !x.off).length >= MAX_VOICES) {
        const oldest = voices.find(x => !x.off);
        if (oldest) release(oldest, when, STEAL_S);
      }

      const f = hz(n);
      const gain = a.createGain();
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(a.sampleRate ? a.sampleRate / 2.2 : 20000, f * 6 + 800);
      lp.Q.value = 0.7;

      const oscs = [];
      // a triangle for the body, two quiet sines for the ring above it
      for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.28], ['sine', 3, 0.12]]) {
        const o = a.createOscillator(), og = a.createGain();
        o.type = type;
        o.frequency.value = f * mult;
        og.gain.value = level;
        o.connect(og).connect(lp);
        o.start(when);
        oscs.push(o);
      }
      lp.connect(gain).connect(master);

      const peak = Math.pow(Math.max(1, Math.min(127, v)) / 127, 1.6) * 0.9;
      const decay = decayOf(n);
      gain.gain.setValueAtTime(SILENT, when);
      gain.gain.exponentialRampToValueAtTime(peak, when + ATTACK_S);
      gain.gain.exponentialRampToValueAtTime(SILENT, when + ATTACK_S + decay);

      const voice = { n, oscs, gain, endsAt: when + ATTACK_S + decay, off: false, sustained: false };
      for (const o of oscs) { try { o.stop(voice.endsAt + 0.01); } catch { /* fake osc */ } }
      voices.push(voice);
      scheduled++;
      return voice;
    },

    /** With the pedal down the note is only marked; the damper waits for the pedal. */
    noteOff(n, whenPerfMs) {
      if (!a) return;
      const when = at(whenPerfMs);
      for (const v of voices) {
        if (v.n !== n || v.off) continue;
        if (pedal) v.sustained = true;
        else release(v, when);
      }
    },

    setPedal(down, whenPerfMs) {
      pedal = !!down;
      if (pedal || !a) return;
      const when = at(whenPerfMs);
      for (const v of voices) if (v.sustained) release(v, when);   // the pedal came up
    },

    allOff(whenPerfMs) {
      if (!a) return;
      const when = at(whenPerfMs);
      for (const v of voices) release(v, when, STEAL_S);
      pedal = false;
    },
  };
}

let shared = null;

/** The one synth every page's output routing plays through. */
export function synth() {
  if (!shared) {
    shared = makeSynth();
    // exposed for debugging and for the headless checks: `__synth.scheduled` counts
    // the notes that have actually reached the audio thread
    if (typeof window !== 'undefined') window.__synth = shared;
  }
  return shared;
}

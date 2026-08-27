// The musical clock: one mapping between performance.now() and absolute beats, shared
// by everything that has to line up -- the backing track, every loop, the metronome,
// the input buffer and the playhead.
//
// Beats are absolute and unbounded: beat 0 is the top of the first chorus, negative
// beats are the count-in, and nothing wraps. Wrapping into a chorus is the caller's
// job, so a loop's phase and a recording's start survive any number of choruses.

export function makeClock(bpm = 100) {
  let t0 = 0;                    // performance.now() of beat 0
  let cur = bpm;
  let running = false;
  let frozen = 0;                // where the playhead sits while stopped

  const spb = () => 60000 / cur;

  return {
    get bpm() { return cur; },
    get running() { return running; },

    start(atBeat) {
      frozen = atBeat ?? frozen;
      t0 = performance.now() - frozen * spb();
      running = true;
    },
    stop() {
      frozen = this.beat();
      running = false;
    },

    /** Absolute beat at a performance.now() stamp -- defaults to right now. */
    beat(at) {
      if (!running) return frozen;
      return ((at ?? performance.now()) - t0) / spb();
    },

    /** The performance.now() stamp an absolute beat falls on. */
    time(beat) { return t0 + beat * spb(); },

    /** Re-anchors, so the playhead stays exactly where it is across the change. */
    setBpm(v) {
      const b = this.beat();
      cur = v;
      if (running) t0 = performance.now() - b * spb();
      else frozen = b;
    },
  };
}

/** Positive modulo -- beats go negative during the count-in. */
export const mod = (a, n) => ((a % n) + n) % n;

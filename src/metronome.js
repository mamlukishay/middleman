// The metronome: one WebAudio click for every page, driven by the shared beat clock.
//
// Deliberately not a MIDI note: it stays out of the piano's sound and off the MIDI
// bus. But it is scheduled by *beat number* on the same clock as the notes, which is
// what keeps it honest:
//   - a tempo change re-anchors the clock, and the next beat is still the next
//     beat -- nothing is scheduled twice and nothing is skipped;
//   - a click is only ever scheduled ahead of now. After a freeze (a background tab,
//     a stalled timer) the beats that are already gone are dropped, not dumped out
//     as a burst;
//   - performance.now() is mapped to audio time once per round, from the context's
//     own output timestamp, so output latency and clock drift are accounted for.
//
// The AudioContext is created lazily and resumed on the next user gesture or when
// the tab comes back, because browsers suspend it freely and a suspended context
// plays nothing without telling anyone.

/**
 * Audio leads or lags MIDI by a fixed amount on a given setup: the piano's own
 * latency versus the speakers'. Positive moves the click earlier. One place to tune.
 */
export const CLICK_OFFSET_MS = 0;

const PAST_MS = 5;               // a beat this far gone is skipped rather than played late
const HIDDEN_LOOKAHEAD_MS = 1500; // timers slow to once a second in a background tab
const LATENCY_MARGIN_MS = 60;    // schedule at least this far past the output latency

let ctx = null, armed = false;

export function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    arm();
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});   // needs a user gesture
  return ctx;
}

/** Bring a suspended or interrupted context back on the next chance we get. */
function arm() {
  if (armed || typeof addEventListener !== 'function') return;
  armed = true;
  const kick = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
  addEventListener('pointerdown', kick, true);
  addEventListener('keydown', kick, true);
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
}

/**
 * performance.now() -> AudioContext time, taken once per scheduling round, plus the
 * output latency in ms. The output timestamp pairs the audio time *being heard* with
 * the performance time it was heard at, so a click scheduled through this mapping
 * reaches the ear at the performance instant asked for -- the latency is paid for by
 * scheduling that much earlier in audio time, which is why the lookahead has to
 * cover it (see pump).
 *
 * Exported because the software piano (src/synth.js) has to be on the same ruler as
 * the click -- two mappings would drift apart and the app's own timing could no
 * longer be judged by ear.
 */
export function mapper(a) {
  if (typeof a.getOutputTimestamp === 'function') {
    const ts = a.getOutputTimestamp();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      const latencyMs = Math.max(0, (a.currentTime - ts.contextTime) * 1000);
      return { toAudio: ms => ts.contextTime + (ms - ts.performanceTime) / 1000, latencyMs };
    }
  }
  const c = a.currentTime, p = performance.now();
  const latencyMs = ((a.outputLatency || 0) + (a.baseLatency || 0)) * 1000;
  return { toAudio: ms => c + (ms - p) / 1000 - latencyMs / 1000, latencyMs };
}

function click(a, when, accent) {
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1050;
  gain.gain.setValueAtTime(.0001, when);
  gain.gain.exponentialRampToValueAtTime(accent ? .22 : .12, when + .002);
  gain.gain.exponentialRampToValueAtTime(.0001, when + .05);
  osc.connect(gain).connect(a.destination);
  osc.start(when);
  osc.stop(when + .06);
  return osc;
}

/**
 * A metronome on `clock`. Call `pump(lookaheadMs)` from the transport's tick; it
 * schedules every beat that falls inside the lookahead and has not gone by.
 *
 *   start(fromBeat)      the first beat that may click (a count-in starts negative)
 *   stop()               nothing more is scheduled; already-queued clicks play out
 *   setEnabled(v)        toggle; turning on mid-bar resumes on the next whole beat
 *   setAccent(n, origin) accent every n beats, counted from `origin` (the loop's start)
 *   setRange(from, to)   clicks only for beats in [from, to) -- Infinity to never stop
 *   onBeat               optional (beat, atMs, accent), called when a beat is scheduled
 *                        with the performance.now() it will sound at -- for a visual
 *                        pulse that lands with the click. Fires even with the sound off.
 *
 * `opts.audio` swaps the AudioContext source, for tests.
 */
export function makeMetronome(clock, opts = {}) {
  const getAudio = opts.audio || audio;
  let enabled = true, running = false;
  let next = 0;                       // the next beat number to consider
  let every = 4, origin = 0;
  let from = -Infinity, to = Infinity;
  let count = 0;                      // clicks scheduled, for the tests and the status line
  let queued = [];                    // { osc, at } already handed to the audio thread
  let latency = 0;                    // ms, from the last round

  const ceilBeat = b => Math.ceil(b - 1e-9);

  return {
    onBeat: null,
    get enabled() { return enabled; },
    get latencyMs() { return latency; },
    get running() { return running; },
    get next() { return next; },
    get scheduled() { return count; },

    start(fromBeat) { running = true; next = ceilBeat(fromBeat ?? clock.beat()); },
    stop() {
      running = false;
      // a queued click that has not sounded yet must not play after Stop
      for (const q of queued) { try { q.osc.stop(); } catch { /* already done */ } }
      queued = [];
    },
    setEnabled(v) {
      enabled = !!v;
      // whatever was skipped while off is gone; pick up from the next whole beat
      if (enabled && running) next = Math.max(next, ceilBeat(clock.beat()));
    },
    setAccent(n, at = origin) { every = Math.max(1, n | 0); origin = at; },
    setRange(a, b) { from = a ?? -Infinity; to = b ?? Infinity; },

    /** One scheduling round. `lookaheadMs` is how far ahead the transport works. */
    pump(lookaheadMs = 120) {
      if (!running) return 0;
      const now = performance.now();
      const hidden = typeof document !== 'undefined' && document.hidden;
      let a = null, map = null;
      if (enabled) { a = getAudio(); map = mapper(a); latency = map.latencyMs; }
      // the horizon covers the output latency: a click for a beat closer than the
      // latency could only be scheduled in the past, i.e. late
      const ahead = Math.max(lookaheadMs, latency + LATENCY_MARGIN_MS, hidden ? HIDDEN_LOOKAHEAD_MS : 0);
      const horizon = now + ahead;
      // never look back: beats already gone are dropped, not played late
      next = Math.max(next, ceilBeat(clock.beat(now - PAST_MS)));
      queued = queued.filter(q => q.at > now);
      let n = 0;
      while (clock.time(next) < horizon) {
        const b = next++;
        if (b < from || b >= to) continue;
        const at = clock.time(b) - CLICK_OFFSET_MS;
        const accent = ((b - origin) % every + every) % every === 0;
        if (a) {
          const osc = click(a, Math.max(a.currentTime, map.toAudio(at)), accent);
          queued.push({ osc, at });
          n++; count++;
        }
        if (this.onBeat) this.onBeat(b, at, accent);
      }
      return n;
    },
  };
}

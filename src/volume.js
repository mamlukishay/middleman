// How loud the app plays, against your own playing.
//
// One level for everything the app sounds -- backing tracks, the written melody, the
// count-in, the tutor's companion hand, "Hear the app play it", the looper's backing
// and the loops it plays back. A loop coming back out of the app is the app, not you:
// what the level is *not* is your own hands, which reach the piano directly and never
// pass through the app's output at all.
//
// A digital piano has no master volume the app can reach -- CC7 is honoured by some
// instruments and quietly ignored by others -- so the one thing that reliably changes
// how loud a note comes out is the velocity it was struck with. Turning the app down
// therefore means scaling the velocity of every note-on it sends, on the way out.
// src/midi.js does that in send(), which is the single door every such note goes
// through; the click is browser audio on a different route and is left alone.
//
// The level is one setting for the whole app, so it lives here rather than in any one
// transport, and is remembered the way the output mode is.

const STORE_KEY = 'middleman.volume';
const OLD_KEY = 'middleman.backing.volume';   // what this was called when it was the backing's

const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

function read() {
  try {
    const now = localStorage.getItem(STORE_KEY);
    if (now !== null) return clamp01(parseFloat(now));
    // the setting a previous version stored under its old name: carry it over once,
    // so nobody's chosen level is silently reset to full by the rename
    const was = localStorage.getItem(OLD_KEY);
    if (was === null) return 1;
    const l = clamp01(parseFloat(was));
    localStorage.setItem(STORE_KEY, String(l));
    localStorage.removeItem?.(OLD_KEY);
    return l;
  } catch { return 1; }            // no storage (a test, a locked-down browser)
}

let level = read();
const listeners = new Set();

export const getVolume = () => level;

export function setVolume(v) {
  level = clamp01(v);
  try { localStorage.setItem(STORE_KEY, String(level)); } catch { /* just not remembered */ }
  for (const fn of listeners) fn(level);
}

/** @param fn  called with the new level whenever it changes. @returns unsubscribe. */
export function onVolumeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * One note-on's velocity at the given level. Off means off -- 0 is a note-off in
 * MIDI, which is exactly what silence should be -- but anything above it stays
 * audible: rounding a quiet note down to 0 would turn "very soft" into "missing".
 */
export function scaleVelocity(v, lvl = level) {
  const l = clamp01(lvl);
  if (l <= 0) return 0;
  return Math.min(127, Math.max(1, Math.round(v * l)));
}

/**
 * Wire a range input (0-100) and its readout to the level. Four pages share the
 * markup as well as the value, so the handful of lines live here once.
 */
export function bindVolumeSlider(input, out) {
  if (!input) return;
  const show = l => {
    input.value = Math.round(l * 100);
    if (out) out.textContent = input.value + '%';
  };
  show(level);
  input.oninput = () => setVolume(+input.value / 100);
  onVolumeChange(show);
}

// What the learn pages remember between visits.
//
// One document per song under `middleman.learn.<songId>`: where you are in the
// plan, which steps are done, your best pass on each, and the tempo you set by
// hand per tier. It lives in its own module because two pages now read and write
// it -- the desktop page and the phone -- and a step finished on the laptop has
// to be finished on the phone. One shape, one place, no drift.
//
// `tempo` rides along inside the same document rather than a key of its own:
// missing means "use the plan's", which is exactly what a fresh song wants.

export const storeKey = songId => 'middleman.learn.' + (songId ?? '?');

const blank = () => ({ step: 0, done: new Set(), best: {}, tempos: {} });

/**
 * A step index that `plan[i]` is certain to answer: a whole number inside the plan.
 * Anything else -- a fraction, a string, a null written by an older build or by the
 * other page -- reads as step 0 rather than as `plan[i] === undefined`, which would
 * throw out of applyStep and take the whole page down with it. The document lives in
 * localStorage, so one bad value would break every load until it was cleared by hand.
 */
export const safeStep = (v, nsteps = Infinity) =>
  Number.isFinite(+v) ? Math.max(0, Math.min(Math.floor(+v), nsteps - 1)) : 0;

/** Read a song's document. `nsteps` clamps a saved step that a shorter plan no longer has. */
export function loadProgress(songId, nsteps = Infinity) {
  try {
    const d = JSON.parse(localStorage.getItem(storeKey(songId)) || 'null');
    if (!d) return blank();
    return {
      step: safeStep(d.step ?? 0, nsteps),
      done: new Set(d.done ?? []),
      best: d.best ?? {},
      tempos: d.tempo ?? {},
    };
  } catch { return blank(); }             // private mode, or a document we cannot read
}

export function saveProgress(songId, { step, done, best, tempos }) {
  try {
    localStorage.setItem(storeKey(songId),
      JSON.stringify({ v: 1, step, done: [...done], best, tempo: tempos ?? {} }));
  } catch { /* quota, or private mode */ }
}

/** A single remembered choice -- the stage's view, say. Each page names its own key. */
export function readSetting(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function writeSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

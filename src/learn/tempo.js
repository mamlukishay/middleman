// The tempo you set by hand outlives the step you set it on.
//
// The plan's `bpm` is a starting point, not a rule: 60 for the slow steps, 80% of
// the song for the faster ones. Sticking to that every time a step loads means
// re-dragging the slider all day, so a hand-set tempo is remembered -- per song,
// per tempo tier ('slow' | 'mid' | 'full', from the step) plus free practice.
//
// Per step would be too fine (thirty-odd tempos to keep in step); one per song too
// coarse (the "faster" steps want to sit above the slow ones, and should).

export const TIERS = ['slow', 'mid', 'full', 'free'];

/** Free practice's stand-in for a step: its own tier, the song's practice tempo as the default. */
export const freeStep = bpm => ({ tier: 'free', bpm });

const ok = (step, prefs) => !!step && TIERS.includes(step.tier) && !!prefs;

/** What a step loads at: your tempo for its tier if you have set one, else the plan's. */
export function resolveTempo(step, prefs = {}) {
  if (!ok(step, prefs)) return step?.bpm;
  const v = prefs[step.tier];
  return Number.isFinite(v) ? v : step.bpm;
}

/** Record a hand-set tempo under the step's tier. Returns fresh prefs; the old ones are untouched. */
export function rememberTempo(prefs = {}, step, bpm) {
  if (!ok(step, prefs) || !Number.isFinite(bpm)) return prefs;
  return { ...prefs, [step.tier]: bpm };
}

/** Forget the tier's tempo, so the plan's default comes back. */
export function forgetTempo(prefs = {}, step) {
  if (!ok(step, prefs) || !(step.tier in prefs)) return prefs;
  const next = { ...prefs };
  delete next[step.tier];
  return next;
}

/** True when the tempo showing is yours rather than the step's -- what the marker watches. */
export const isCustomTempo = (step, bpm) => !!step && Number.isFinite(bpm) && bpm !== step.bpm;

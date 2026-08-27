// Note spelling and chord theory. Anything a track author would want to change
// lives in tracks.json instead.

export const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT  = ['C','_D','D','_E','E','F','_G','G','_A','A','_B','B'];
const SHARP = ['C','^C','D','^D','E','F','^F','G','^G','A','^A','B'];

// the two notes that define each chord quality
export const GUIDES = { '7': [4,10], 'm7': [3,10] };

export const noteName   = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
export const chordLabel = (pc, q) => NAMES[pc % 12] + (q === 'm7' ? 'm7' : '7');

/** MIDI number -> ABC pitch, e.g. 46 -> "_B,," (flats) or "^A,," (sharps). */
export function abcPitch(n, sharps) {
  const s = (sharps ? SHARP : FLAT)[n % 12];
  const oct = Math.floor(n / 12) - 1;
  const letter = s.slice(-1), acc = s.slice(0, -1);
  if (oct >= 5) return acc + letter.toLowerCase() + "'".repeat(oct - 5);
  return acc + letter + ','.repeat(Math.max(0, 4 - oct));
}

const LETTER_PC = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

/** Scientific pitch name -> MIDI number, e.g. "F#4" -> 66, "Bb3" -> 58. */
export function pitchOf(s, where) {
  const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(String(s ?? '').trim());
  if (!m) throw new Error(`${where}: bad note ${JSON.stringify(s)} (want e.g. "F#4", "Bb3", "C4")`);
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const c of m[2]) pc += (c === '#' || c === '♯') ? 1 : -1;
  return pc + (+m[3] + 1) * 12;
}

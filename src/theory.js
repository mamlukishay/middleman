// Note spelling, scales and the raw material chords/bass lines are built from.

export const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT  = ['C','_D','D','_E','E','F','_G','G','_A','A','_B','B'];
const SHARP = ['C','^C','D','^D','E','F','^F','G','^G','A','^A','B'];

export const BLUES   = [0,3,5,6,7,10];
export const MINPENT = [0,3,5,7,10];

// 8 eighth-note offsets per bar, relative to the chord root
export const PATTERNS = {
  boogie:    [0,7,9,10,12,10,9,7],   // root 5 6 b7 8 b7 6 5
  minorVamp: [0,0,3,0,7,0,10,7],     // driving minor-seventh vamp
};

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

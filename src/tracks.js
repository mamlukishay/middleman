// Track definitions and the event list they expand into.
// Adding a song means adding a TRACKS entry -- nothing else needs to change.

import { PATTERNS, GUIDES, BLUES, MINPENT, chordLabel } from './theory.js';

const BLUES12 = [0,0,0,0,5,5,0,0,7,5,0,7];   // 12-bar form, semitones off the key

export const TRACKS = [
  { name:'C blues', sub:'100 bpm · shuffle', root:36, bpm:100, swing:2/3, sharps:false,
    pattern:'boogie', quality:'7', form:BLUES12, cols:6,
    scale:BLUES, scaleName:'Blues scale', blue:6 },
  { name:'F blues', sub:'88 bpm · slow', root:41, bpm:88, swing:2/3, sharps:false,
    pattern:'boogie', quality:'7', form:BLUES12, cols:6,
    scale:BLUES, scaleName:'Blues scale', blue:6 },
  { name:'G blues', sub:'132 bpm · fast', root:43, bpm:132, swing:2/3, sharps:false,
    pattern:'boogie', quality:'7', form:BLUES12, cols:6,
    scale:BLUES, scaleName:'Blues scale', blue:6 },
  // Billie Jean: the verse is a one-chord F#m vamp. Straight eighths, not swung.
  { name:'Billie Jean', sub:'117 bpm · F#m vamp', root:42, bpm:117, swing:.5, sharps:true,
    pattern:'minorVamp', quality:'m7', form:[0,0,0,0], cols:4,
    scale:MINPENT, scaleName:'F# minor pentatonic', blue:null },
];

export const COUNT_IN_BEATS = 4;
const CLICK_NOTE = 84;   // high C, so the count-in is audible over the bass register

/**
 * Expand a track into a flat, beat-stamped MIDI event list plus per-bar metadata.
 * `choruses` only sets how much is scheduled ahead; playback loops the form.
 */
export function build(t, choruses = 4) {
  const pat = PATTERNS[t.pattern], guides = GUIDES[t.quality], sw = t.swing;
  const ev = [];
  let beat = 0;

  for (let i = 0; i < COUNT_IN_BEATS; i++) {
    ev.push({ b: beat, on: 1, n: CLICK_NOTE, v: 50 },
            { b: beat + .25, on: 0, n: CLICK_NOTE });
    beat++;
  }

  const start = beat, bars = [];
  for (let c = 0; c < choruses; c++) for (const off of t.form) {
    const r = t.root + off;
    const bar = { beat, chord: chordLabel(r, t.quality), notes: [] };

    pat.forEach((o, i) => {
      // swung eighths: downbeats on the beat, offbeats `sw` of the way through
      const at  = beat + Math.floor(i / 2) + (i % 2 ? sw : 0);
      const len = (i % 2 ? 1 - sw : sw) * .9;
      ev.push({ b: at, on: 1, n: r + o, v: 82 }, { b: at + len, on: 0, n: r + o });
      bar.notes.push({ at, n: r + o });
    });

    for (const b of [1, 3]) for (const g of guides) {   // stabs on 2 and 4
      ev.push({ b: beat + b, on: 1, n: r + g + 12, v: 60 },
              { b: beat + b + .45, on: 0, n: r + g + 12 });
    }

    bars.push(bar);
    beat += 4;
  }

  ev.sort((a, b) => a.b - b.b);
  const nbars = t.form.length;
  return { ev, bars, total: beat, start, nbars, formBeats: nbars * 4 };
}

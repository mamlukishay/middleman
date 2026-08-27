// Engraved notation via abcjs (loaded as a global by index.html).
//
// Four abcjs behaviours drive the code here:
//   - noteheads carry `.abcjs-notehead`; there is no `.abcjs-note` class unless
//     `add_classes` is on -- which it is, because with two voices on the page
//     document order alone no longer tells you which staff a notehead is on
//   - chord symbols are bare <text> with no class, and # / b are typeset as the
//     glyphs U+266F / U+266D -- so they are matched by normalised text content
//   - a blank line anywhere in the header terminates the tune and drops the body
//   - K: must come last in the header, after any V: definitions

import { abcPitch } from './theory.js';

const dur = d => (d > 1 ? d : '');
const bassAbc = (bar, sharps) => bar.notes.map(x => abcPitch(x.n, sharps)).join('');
const melAbc  = (bar, sharps) => bar.mel
  .map(m => (m.n == null ? 'z' : abcPitch(m.n, sharps)) + dur(m.d)).join('');

/** `showMel` adds the melody as a second voice on a treble staff above the bass. */
export function buildAbc(cur, showMel) {
  const mel = showMel && cur.melody ? cur.melody : null;
  const bars = cur.bars.slice(0, cur.nbars), cols = cur.cols;
  const out = ['X:1', 'T: ', 'M:4/4', 'L:1/8', '%%stretchlast true'];
  // {} groups the staves under a piano brace; V1 is voice 0, V2 is voice 1
  if (mel) out.push('%%score {(V1) (V2)}', 'V:V1 clef=treble', 'V:V2 clef=bass', 'K:C');
  else     out.push('K:C clef=bass');

  for (let r = 0; r * cols < bars.length; r++) {
    const row = bars.slice(r * cols, r * cols + cols);
    // chords sit over the top staff, lead-sheet style
    if (mel) {
      out.push('[V:V1] ' + row.map(b => `"${b.chord}"` + melAbc(b, cur.sharps) + '|').join(''));
      out.push('[V:V2] ' + row.map(b => bassAbc(b, cur.sharps) + '|').join(''));
    } else {
      out.push(row.map(b => `"${b.chord}"` + bassAbc(b, cur.sharps) + '|').join(''));
    }
  }
  return out.join('\n');
}

const normalise = s => (s || '').replace(/♯/g, '#').replace(/♭/g, 'b').trim();

/** Deal out `els` into per-bar groups of the given sizes, in document order. */
function deal(els, counts) {
  let i = 0;
  return counts.map(n => els.slice(i, i += n));
}

/**
 * Render into `el`, shrinking to fit its box, and return the element map the
 * playhead needs. Returns an empty map if abcjs is unavailable.
 */
export function renderNotation(el, cur, showMel) {
  const mel = showMel && cur.melody ? cur.melody : null;
  const empty = { bars: [], chordEls: [], hasMel: false };
  if (!window.ABCJS) { el.textContent = '(notation library failed to load)'; return empty; }

  const abc = buildAbc(cur, showMel);
  let scale = 1;
  for (let pass = 0; pass < 4; pass++) {            // measure, shrink, re-render
    window.ABCJS.renderAbc(el.id, abc, {
      add_classes: true,
      staffwidth: Math.max(320, el.clientWidth - 16),
      scale, paddingtop: 2, paddingbottom: 2, paddingleft: 2, paddingright: 2,
    });
    const svg = el.querySelector('svg');
    const avail = el.clientHeight - 8;
    if (!svg || avail < 40) break;
    const h = svg.getBoundingClientRect().height;
    if (h <= avail) break;
    scale = Math.max(.3, scale * (avail / h) * .98);
  }

  const src = cur.bars.slice(0, cur.nbars);
  // rests are `.abcjs-rest`, so this is sounding notes only -- matching melNotes
  const voice = v => [...el.querySelectorAll(`.abcjs-note.abcjs-v${v}`)];
  const melNotes  = src.map(b => (mel ? b.mel.filter(m => m.n != null).map(m => m.n) : []));
  const bassNotes = src.map(b => b.notes.map(x => x.n));
  const melEls  = mel ? deal(voice(0), melNotes.map(a => a.length)) : src.map(() => []);
  const bassEls = deal(voice(mel ? 1 : 0), bassNotes.map(a => a.length));

  const want = new Set(src.map(b => b.chord));
  const chordEls = [...el.querySelectorAll('text')]
                     .filter(t => want.has(normalise(t.textContent)));

  const bars = src.map((_, i) => ({
    bass: bassEls[i], bassNotes: bassNotes[i],
    mel:  melEls[i],  melNotes:  melNotes[i],
  }));

  const bad = bars.find(b => b.bass.length !== b.bassNotes.length
                          || b.mel.length  !== b.melNotes.length);
  if (bad || chordEls.length !== cur.nbars)
    console.warn('notation map:', 'bass', bars.map(b => b.bass.length).join(''),
                 'mel', bars.map(b => b.mel.length).join(''),
                 'chords', chordEls.length, '/', cur.nbars);

  return { bars, chordEls, hasMel: !!mel };
}

/** Box the current bar's chord symbol. Measured in screen coords to dodge SVG transforms. */
export function updateBarHl(box, wrap, view, bi) {
  const bar = view.bars[bi];
  if (bi < 0 || !bar || !bar.bass.length) { box.style.display = 'none'; return; }

  const wb = wrap.getBoundingClientRect();
  let x0 = Infinity, x1 = -Infinity;                 // bar span, from its noteheads
  for (const el of bar.bass) {
    const r = el.getBoundingClientRect();
    x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right);
  }
  if (!isFinite(x0)) { box.style.display = 'none'; return; }

  let left = x0, top, height;
  const chord = view.chordEls[bi];
  if (chord) {
    const r = chord.getBoundingClientRect();
    left = Math.min(left, r.left - 6); top = r.top - 3; height = r.height + 6;
  } else {                                           // fallback: float above the stave
    const r = bar.bass[0].getBoundingClientRect();
    top = r.top - 34; height = 18;
  }
  box.style.display = 'block';
  box.style.left   = (left - wb.left) + 'px';
  box.style.top    = (top - wb.top) + 'px';
  box.style.width  = (x1 - left + 8) + 'px';
  box.style.height = height + 'px';
}

/**
 * Light the notes you're holding. The bass line is matched by pitch class -- you
 * solo an octave or two above it, so exact pitches would never fire -- but the
 * melody sits in your own register, so there it has to be the actual note.
 */
export function paintPlayed(view, held) {
  const pcs = new Set([...held].map(n => n % 12));
  for (const bar of view.bars) {
    bar.bass.forEach((el, i) => el.classList.toggle('you-note', pcs.has(bar.bassNotes[i] % 12)));
    bar.mel.forEach((el, i)  => el.classList.toggle('you-note', held.has(bar.melNotes[i])));
  }
}

// Engraved notation via abcjs (loaded as a global by index.html).
//
// Three abcjs behaviours drive the code here:
//   - noteheads carry `.abcjs-notehead`; there is no `.abcjs-note` class
//   - chord symbols are bare <text> with no class, and # / b are typeset as the
//     glyphs U+266F / U+266D -- so they are matched by normalised text content
//   - a blank line anywhere in the header terminates the tune and drops the body

import { abcPitch } from './theory.js';

export function buildAbc(cur) {
  const out = ['X:1', 'T: ', 'M:4/4', 'L:1/8', 'K:C clef=bass', '%%stretchlast true'];
  const bars = cur.bars.slice(0, cur.nbars), cols = cur.cols;
  for (let r = 0; r * cols < bars.length; r++) {
    let line = '';
    for (let c = 0; c < cols && r * cols + c < bars.length; c++) {
      const b = bars[r * cols + c];
      line += `"${b.chord}"` + b.notes.map(x => abcPitch(x.n, cur.sharps)).join('') + '|';
    }
    out.push(line);
  }
  return out.join('\n');
}

const normalise = s => (s || '').replace(/♯/g, '#').replace(/♭/g, 'b').trim();

/**
 * Render into `el`, shrinking to fit its box, and return the element map the
 * playhead needs. Returns empty arrays if abcjs is unavailable.
 */
export function renderNotation(el, cur) {
  const empty = { noteEls: [], chordEls: [], abcNotes: [] };
  if (!window.ABCJS) { el.textContent = '(notation library failed to load)'; return empty; }

  const abc = buildAbc(cur);
  let scale = 1;
  for (let pass = 0; pass < 3; pass++) {            // measure, shrink, re-render
    window.ABCJS.renderAbc(el.id, abc, {
      staffwidth: Math.max(320, el.clientWidth - 16),
      scale, paddingtop: 2, paddingbottom: 2, paddingleft: 2, paddingright: 2,
    });
    const svg = el.querySelector('svg');
    const avail = el.clientHeight - 8;
    if (!svg || avail < 40) break;
    const h = svg.getBoundingClientRect().height;
    if (h <= avail) break;
    scale = Math.max(.35, scale * (avail / h) * .98);
  }

  const noteEls  = [...el.querySelectorAll('.abcjs-notehead')];
  const want     = new Set(cur.bars.slice(0, cur.nbars).map(b => b.chord));
  const chordEls = [...el.querySelectorAll('text')]
                     .filter(t => want.has(normalise(t.textContent)));
  const abcNotes = cur.bars.slice(0, cur.nbars).flatMap(b => b.notes.map(x => x.n));

  if (noteEls.length !== cur.nbars * 8 || chordEls.length !== cur.nbars)
    console.warn('notation map: noteheads', noteEls.length, '/', cur.nbars * 8,
                 'chords', chordEls.length, '/', cur.nbars);

  return { noteEls, chordEls, abcNotes };
}

/** Box the current bar's chord symbol. Measured in screen coords to dodge SVG transforms. */
export function updateBarHl(box, wrap, view, bi) {
  const els = view.noteEls.slice(bi * 8, bi * 8 + 8);
  if (bi < 0 || !els.length) { box.style.display = 'none'; return; }

  const wb = wrap.getBoundingClientRect();
  let x0 = Infinity, x1 = -Infinity;                 // bar span, from its 8 noteheads
  for (const el of els) {
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
    const r = els[0].getBoundingClientRect();
    top = r.top - 34; height = 18;
  }
  box.style.display = 'block';
  box.style.left   = (left - wb.left) + 'px';
  box.style.top    = (top - wb.top) + 'px';
  box.style.width  = (x1 - left + 8) + 'px';
  box.style.height = height + 'px';
}

/** Light noteheads matching held pitch classes -- exact octaves would never match. */
export function paintPlayed(view, held) {
  if (!view.noteEls.length) return;
  const pcs = new Set([...held].map(n => n % 12));
  view.noteEls.forEach((el, i) =>
    el.classList.toggle('you-note', pcs.has(view.abcNotes[i] % 12)));
}

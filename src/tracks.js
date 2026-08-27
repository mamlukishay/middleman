// Loads tracks.json, resolves its named references, validates it, and expands a
// track into a beat-stamped event list.

import { GUIDES, chordLabel, pitchOf } from './theory.js';

export const COUNT_IN_BEATS = 4;
const CLICK_NOTE = 84;        // high C, audible over the bass register
const PATTERN_LEN = 8;        // eighth notes per bar
const BAR_EIGHTHS = 8;        // a melody bar must account for exactly this many

/** Accepts 0.5 or "2/3" -- fractions keep swing exact and readable in the file. */
function parseSwing(v, where) {
  if (typeof v === 'number') return v;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(v ?? ''));
  if (!m) throw new Error(`${where}: swing must be a number or "a/b", got ${JSON.stringify(v)}`);
  return +m[1] / +m[2];
}

/** Beat offset of eighth-note `k` within a bar: offbeats land `sw` of the way through. */
const swung = (k, sw) => Math.floor(k / 2) + (k % 2 ? sw : 0);

/** Named reference, or an inline value of the expected shape. */
function deref(value, table, kind, where) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  const hit = table?.[value];
  if (!hit) throw new Error(
    `${where}: unknown ${kind} "${value}" (available: ${Object.keys(table ?? {}).join(', ') || 'none'})`);
  return hit;
}

/**
 * A melody is bars of [pitchName|null, eighths] cells. Rests are null. Returns
 * bars of {n, d} with `n` as a MIDI number, or null for a rest.
 */
function normMelody(m, formBars, where) {
  const bars = m?.bars;
  if (!Array.isArray(bars) || !bars.length) throw new Error(`${where}: melody has no bars`);
  if (bars.length % formBars)
    throw new Error(`${where}: melody is ${bars.length} bars, `
                  + `want a multiple of the ${formBars}-bar form`);
  return {
    name: m.name ?? 'melody',
    bars: bars.map((bar, i) => {
      const at = `${where}: melody bar ${i + 1}`;
      if (!Array.isArray(bar)) throw new Error(`${at}: not a list of [note, eighths] cells`);
      let sum = 0;
      const cells = bar.map(cell => {
        const [p, d] = Array.isArray(cell) ? cell : [];
        if (!Number.isInteger(d) || d < 1)
          throw new Error(`${at}: duration must be a whole number of eighths, got ${JSON.stringify(d)}`);
        sum += d;
        return { n: p == null ? null : pitchOf(p, at), d };
      });
      if (sum !== BAR_EIGHTHS)
        throw new Error(`${at}: durations sum to ${sum} eighths, want ${BAR_EIGHTHS}`);
      return cells;
    }),
  };
}

function resolve(raw, doc) {
  const where = `track "${raw.id ?? raw.name ?? '?'}"`;
  for (const key of ['id','name','root','bpm','quality','pattern','form','scale'])
    if (raw[key] === undefined) throw new Error(`${where}: missing "${key}"`);
  if (!GUIDES[raw.quality])
    throw new Error(`${where}: unknown quality "${raw.quality}" (want ${Object.keys(GUIDES).join(' or ')})`);

  const pattern = deref(raw.pattern, doc.patterns, 'pattern', where);
  const form    = deref(raw.form,    doc.forms,    'form',    where);
  const scale   = deref(raw.scale,   doc.scales,   'scale',   where);
  const melody  = raw.melody === undefined ? null
    : normMelody(deref(raw.melody, doc.melodies, 'melody', where), form.length, where);

  if (pattern.length !== PATTERN_LEN)
    throw new Error(`${where}: pattern needs ${PATTERN_LEN} offsets, got ${pattern.length}`);
  if (!form.length) throw new Error(`${where}: form has no bars`);
  if (!scale.intervals?.length) throw new Error(`${where}: scale has no intervals`);

  return {
    id: raw.id, name: raw.name, sub: raw.sub ?? '', note: raw.note ?? '',
    root: raw.root, bpm: raw.bpm, sharps: !!raw.sharps, quality: raw.quality,
    swing: parseSwing(raw.swing ?? 0.5, where),
    cols: raw.cols ?? Math.min(form.length, 6),
    pattern, form,
    scale: scale.intervals,
    scaleName: scale.name ?? 'scale',
    blue: scale.blue ?? null,
    melody,
  };
}

export async function loadTracks(url = 'tracks.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const doc = await res.json();
  if (!Array.isArray(doc.tracks) || !doc.tracks.length)
    throw new Error(`${url}: no "tracks" array`);
  return doc.tracks.map(t => resolve(t, doc));
}

/**
 * Expand a resolved track into a flat, beat-stamped MIDI event list plus per-bar
 * metadata. `choruses` only sets how much is scheduled ahead; playback loops.
 */
export function build(t, choruses = 4) {
  const guides = GUIDES[t.quality], sw = t.swing;
  const mel = t.melody, melBars = mel ? mel.bars.length : 0;
  // a loop is long enough to hold both: the melody is a multiple of the form
  const nbars = Math.max(t.form.length, melBars);
  const ev = [];
  let beat = 0;

  for (let i = 0; i < COUNT_IN_BEATS; i++) {
    ev.push({ b: beat, on: 1, n: CLICK_NOTE, v: 50 },
            { b: beat + .25, on: 0, n: CLICK_NOTE });
    beat++;
  }

  const start = beat, bars = [];
  for (let c = 0; c < choruses; c++) for (let i = 0; i < nbars; i++) {
    const r = t.root + t.form[i % t.form.length];
    const bar = { beat, chord: chordLabel(r, t.quality), notes: [], mel: [] };

    t.pattern.forEach((o, k) => {
      const off = swung(k, sw), at = beat + off;
      const len = (swung(k + 1, sw) - off) * .9;
      ev.push({ b: at, on: 1, n: r + o, v: 82 }, { b: at + len, on: 0, n: r + o });
      bar.notes.push({ at, n: r + o });
    });

    for (const b of [1, 3]) for (const g of guides) {   // stabs on 2 and 4
      ev.push({ b: beat + b, on: 1, n: r + g + 12, v: 60 },
              { b: beat + b + .45, on: 0, n: r + g + 12 });
    }

    if (mel) {
      let e8 = 0;                                       // position in the bar, in eighths
      for (const m of mel.bars[i % melBars]) {
        const off = swung(e8, sw), at = beat + off;
        const len = (swung(e8 + m.d, sw) - off) * .92;
        if (m.n != null) {
          // `mel` lets the transport drop the note-ons when the melody is muted;
          // note-offs always go out, so muting mid-note can never hang one
          ev.push({ b: at, on: 1, n: m.n, v: 70, mel: 1 },
                  { b: at + len, on: 0, n: m.n, mel: 1 });
        }
        bar.mel.push({ at, n: m.n, d: m.d });
        e8 += m.d;
      }
    }

    bars.push(bar);
    beat += 4;
  }

  ev.sort((a, b) => a.b - b.b);
  return { ev, bars, total: beat, start, nbars, formBeats: nbars * 4 };
}

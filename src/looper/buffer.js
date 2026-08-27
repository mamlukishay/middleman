// A rolling window of everything played in, timestamped in absolute beats.
//
// This is what makes recording feel free: nothing is ever armed, so a take is only
// ever a slice of what is already here. Pressing record late is not a lost take, it
// is a slice that starts before the press.

const MIN_LEN = 0.03;    // a note has to last long enough to be worth sending
export const LEAD = 0.14;  // how far either side of an edge still counts as "on" it

export function makeBuffer(clock, { keepBeats = 128 } = {}) {
  let notes = [];              // { b, len, p, v }; len is null while the key is down
  const open = new Map();      // pitch -> the note still being held

  function prune(now) {
    const cut = now - keepBeats;
    let i = 0;
    // stop at the first note that is still open, or still inside the window
    while (i < notes.length && notes[i].len != null && notes[i].b + notes[i].len < cut) i++;
    if (i) notes = notes.slice(i);
  }

  return {
    get notes() { return notes; },
    get span() { return keepBeats; },

    clear() { notes = []; open.clear(); },

    /** @param ev  a note event straight off the MIDI port: { on, n, v, t }. */
    feed(ev) {
      if (ev.cc !== undefined) return;
      const b = clock.beat(ev.t);
      if (ev.on) {
        const prev = open.get(ev.n);
        if (prev) prev.len = Math.max(MIN_LEN, b - prev.b);   // re-struck before release
        const note = { b, len: null, p: ev.n, v: ev.v };
        open.set(ev.n, note);
        notes.push(note);
        prune(b);
      } else {
        const note = open.get(ev.n);
        if (!note) return;
        note.len = Math.max(MIN_LEN, b - note.b);
        open.delete(ev.n);
      }
    },

    /**
     * The take between two absolute beats, as beats relative to `from`.
     *
     * Both edges are forgiving, because nobody plays exactly on a bar line: a note
     * struck just before `from` is pulled onto it, and one struck just before `to`
     * belongs to the next time round, so it wraps to the start rather than being
     * clipped off the end. A note still held when the take ends is closed at the end.
     */
    slice(from, to) {
      const span = to - from;
      if (span <= 0) return [];
      const now = clock.beat();
      const out = [];
      for (const n of notes) {
        let b = n.b - from;
        if (b >= span - LEAD && b < span) b -= span;   // played into the next cycle
        if (b <= -LEAD || b >= span) continue;
        if (b < 0) b = 0;
        const len = n.len ?? Math.max(MIN_LEN, now - n.b);
        out.push({ b, len: Math.max(MIN_LEN, Math.min(len, span - b)), p: n.p, v: n.v });
      }
      return out.sort((x, y) => x.b - y.b);
    },
  };
}

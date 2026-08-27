# Middleman

A MIDI practice app for a digital piano. It plays backing tracks out to the piano
and shows what you're playing back, in the browser.

There are two pages: the **practice view** (`index.html`), and the **looper**
(`looper.html`), where you record your own playing into loops that keep going
underneath you.

## Running

```bash
./serve.sh          # then open http://localhost:8765 in Chrome
npm test            # or: node --test 'test/*.test.mjs'
```

Chrome is required — this uses the **Web MIDI API**, which needs a secure context.
`localhost` qualifies; opening `index.html` as a `file://` URL will not work.
Chrome asks for MIDI permission on first load.

## What it does

- **Left pane** — backing tracks. Click one to start it; it loops.
- **Top bar** — play/stop (or the space bar), a metronome toggle, a **Melody**
  checkbox, and tempo. Melody is greyed out on tracks that don't have one.
  Tempo can be dragged or typed by clicking the bpm number. Changing tempo
  mid-playback re-anchors the clock, so the playhead stays continuous.
- **Middle** — the form as a chord strip, plus engraved notation. The current
  bar's chord symbol is boxed, and the sounding note is blue.
- **Melody** — ticking it adds a treble staff above the bass one, on a grand
  staff, with the chord symbols moving up over the melody. The playhead lights
  both staves at once. `♪ Sound` next to it plays the melody out to the piano;
  switch it off once you want to play the line yourself. Muting only drops the
  note-ons, so a note can never be left hanging.
- **Bottom** — scale, chords, and a keyboard showing scale tones (amber),
  the backing track (blue), and **your playing (fuchsia)**.

Your played notes also light up on the staff by **pitch class** — you'll be
soloing an octave or two above the written bass line, so exact-pitch matching
would essentially never fire.

## The looper

`looper.html` records what you play into four lanes that loop underneath the
backing track. They are MIDI loops, not audio -- the piano is the only sound
source either way, so a loop is just a list of notes going back out to it.

The lanes sit **under the chord strip, one chorus wide**. That is the whole idea:
a loop remembers not only how long it is, but *where in the form* it was played
and *over which chord*. Everything else follows from that.

### Getting a loop in

Two ways, and the second is the one you will use:

- **Record** (`R`) -- arms, and starts on the next bar line. Press `R` again to
  end it. The take's length becomes the loop's length.
- **Capture** (`C`) -- take the last few bars *after* playing them. Nothing has
  to be armed: everything you play is already in a rolling 32-bar buffer, so a
  good idea does not have to be announced in advance.

Because the buffer is always there, the two are the same mechanism. Pressing `R`
late does not cost you the first note -- the take still starts on the bar line,
and what you already played since that line is pulled back in. Pressing early
just waits. Snapping is to the nearest line, so neither direction is a mistake.

### What a loop can do that an audio loop cannot

- **Follow the changes.** A four-bar lick played over the `F7` repeats over the
  `C7` and the `G7`, moved by the interval between the chords. On by default for
  a loop that repeats inside a form whose harmony actually moves.
- **Fill or phrase.** *Fill* tiles the chorus, every N bars; *phrase* plays once,
  in its own bars. Fill is only offered when the length divides the form.
- **Quantize after the fact**, non-destructively, and **on the track's shuffle** --
  a straight 1/8 grid would fight the boogie feel, so the grid points sit where
  the bass line puts them.
- **Layers.** Each overdub pass is kept separately, so `U` takes exactly one off.
  Clearing a lane is undoable too, which is why it asks for no confirmation.
- **Copy lane as melody** writes the loop out in the `melodies` shape from this
  file, so a captured line can come back engraved on the staff in the practice
  view. It exports a whole chorus, repeats and transpositions included -- both
  because that is what the loop sounds like, and because the loader only accepts
  a melody that is a multiple of the form.

Loop sets are kept in `localStorage` per track, and **Restore last set** brings
one back.

### Keys

Your hands are on the piano, so nothing needs to be hit *at* a musical moment --
arm early, or capture afterwards. The bindings are also printed along the deck.

| | |
|---|---|
| `1`–`4` | select a lane |
| `R` | record → end → overdub → end |
| `C` | capture the last bars from the buffer |
| `U` / `⇧U` | drop the last layer / put it back (also undoes a clear) |
| `X` | clear the lane |
| `M` / `S` | mute / solo |
| `F` | follow the changes |
| `[` `]` | halve / double the length |
| `↑` `↓` | move the lane an octave |
| `+` `-` | level |
| `Q` | quantize grid |
| `I` | inspector |
| `Esc` | every lane back to plain playback |
| `Space` | start / stop |

The damper pedal sends `CC64` and you need it for sustain, so it is deliberately
*not* bound to anything. `midi.js` passes controller messages through on its
event stream, so a second pedal on its own CC could be learned later.

## Tracks

| Track | Form | Feel |
|---|---|---|
| C / F / G blues | 12-bar, dominant 7ths | shuffle (swung eighths), boogie bass |
| Billie Jean | 4-bar F#m7 vamp, 8-bar melody | straight eighths |

The Billie Jean track is a vamp **in the style of** the verse groove — the chord
and feel, not a transcription of the bass line. Chorus changes aren't included.
Its melody is likewise an original F# minor pentatonic line over the vamp, not
the vocal line; swap the notes in `tracks.json` for whatever you want to work on.

## Layout

```
index.html          the practice view
looper.html         the looper
style.css           shared: tokens, buttons, track list, key strip
looper.css          the looper's own furniture, on top of style.css
tracks.json         the backing tracks (data, not code)
src/
  app.js            practice view: transport, playhead, panels, event handlers
  clock.js          performance.now() <-> absolute beats; shared by the looper
  tracks.js         loads/validates tracks.json, build() -> event list
  theory.js         note spelling, scales, bass patterns, chord labels
  midi.js           Web MIDI in/out, the `held` set, the timestamped event stream
  metronome.js      WebAudio click
  keyboard.js       the piano strip
  notation.js       abcjs rendering, chord-box geometry, played-note painting
  looper/
    buffer.js       the rolling input buffer, and what a take slices out of it
    loops.js        the loop model: placement, follow, quantize, melody export
    engine.js       scheduler and the one-key state machine
    ui.js           lanes, rolls, playhead, key strip
    app.js          wiring: keys, MIDI in, inspector, persistence
test/
  looper.test.mjs   the musical logic, run with `node --test`
vendor/
  abcjs-basic-min.js   abcjs 6.4.4, vendored so the app works offline
```

Native ES modules — no build step, no `node_modules`. Edit and refresh. The
`package.json` exists only so `node --test` reads `src/` as ES modules; there are
no dependencies.

## Adding a track

Tracks live in `tracks.json` — no code changes needed. The form length, chip
strip, notation layout, chorus folding and scale panel all derive from the entry.

```json
{
  "id": "am-groove",
  "name": "A minor groove",
  "sub": "90 bpm",
  "root": 45,
  "bpm": 90,
  "swing": 0.5,
  "sharps": false,
  "pattern": "minorVamp",
  "quality": "m7",
  "form": [0, 0, 5, 7],
  "scale": "minorPentatonic",
  "cols": 4
}
```

| field | meaning |
|---|---|
| `id` | stable identifier |
| `root` | MIDI note number of the key, in the bass register (36 = C2) |
| `bpm` | default tempo; the slider still overrides it |
| `swing` | where the offbeat lands: `"2/3"` swung, `0.5` straight. Fractions stay exact |
| `sharps` | `true` spells notation with sharps, `false` with flats |
| `pattern` | 8 eighth-note offsets per bar, relative to the chord root |
| `quality` | `"7"` or `"m7"` — picks the guide tones comped on beats 2 and 4 |
| `form` | one entry per bar, as semitones above `root` |
| `scale` | intervals + display name for the keyboard and info panel |
| `cols` | bars per notation line |
| `melody` | optional; a name from the `melodies` block, or an inline melody |
| `note` | optional; shown as a tooltip on the track |

### Melodies

A melody is bars of `[note, eighths]` cells — `null` is a rest, and each bar has
to account for exactly 8 eighths. Notes are scientific pitch names, so they read
at the register you'll actually play them.

```json
"melodies": {
  "bjVerse": {
    "name": "verse line",
    "bars": [
      [[null, 2], ["C#5", 1], ["B4", 1], ["A4", 2], ["F#4", 2]],
      [["F#4", 3], ["E4", 1], ["F#4", 2], [null, 2]]
    ]
  }
}
```

The melody may be longer than the form, as long as it's a whole multiple of it —
Billie Jean's is 8 bars over the 4-bar vamp, so the loop is 8 bars and the chords
repeat underneath. The displayed bar count doesn't change when you tick the box.
Melodies swing with the track: onsets use the same `swing` as the bass line, so a
melody written in eighths comes out shuffled on the blues tracks.

`pattern`, `form` and `scale` each take **either a name** from the shared
`patterns` / `forms` / `scales` blocks at the top of the file, **or an inline
value** — so the three blues keys share one form and pattern, while Billie Jean
inlines its own 4-bar form.

The file is validated on load. Errors are specific (`track "x": pattern needs 8
offsets, got 2`) and surface in the sidebar and the status line rather than
failing silently.

## Notes for future work

Two abcjs behaviours cost real debugging time and are worth remembering:

- Noteheads are `.abcjs-notehead`, and there is **no** `.abcjs-note` class —
  unless you pass `add_classes: true`, which adds `.abcjs-note` plus a
  `.abcjs-vN` voice tag to each note's `<g>`. With two voices that tag is the
  only reliable way to tell the staves apart: document order interleaves them
  per system. Rests are `.abcjs-rest`, so they stay out of the note map.
- `K:` must come **last** in the header, after any `V:` voice definitions.
- Chord symbols are bare `<text>` elements with **no class**, and abcjs typesets
  `#`/`b` as the glyphs `♯`/`♭` — so they're matched by normalised text content.
- A blank line anywhere in an ABC header **terminates the tune** and silently
  drops the entire body.

Two CSS traps cost time on the looper and will again:

- The `hidden` attribute is only `display: none` at the *user-agent* level, so any
  rule setting `display` on the element beats it. Anything toggled with `.hidden`
  needs its own `[hidden] { display: none }`.
- `height: 100%` on a grid item resolves against the **row**, and an implicit row
  is `auto` — so it silently behaves like `height: auto` and the page grows past
  the viewport instead of the content giving up space. The body grid needs an
  explicit `grid-template-rows: minmax(0, 1fr)`.
- The same on the other axis, one level down: a grid container's *implicit column*
  is content-sized, so `min-width: 0` on the container is not enough — a child row
  that cannot shrink (a no-wrap flex bar with `min-width`s in it) makes the
  container wider than its track and paints over whatever is beside it. `main`
  needs `grid-template-columns: minmax(0, 1fr)`, and the transport needs to wrap.
  Check overflow on **both** axes when testing a layout; the vertical one is the
  obvious half.
- A flex item wraps on its **flex-basis**, not on its shrunk width — so `min-width: 0`
  plus `overflow: hidden` still lets a growing label wrap the row and change the
  page's height. Text whose length varies with state (`PLAY` → `DUB NEXT`) needs
  `flex: 1 1 0`, and a label that must not move things needs a `min-width` wide
  enough for its longest value.


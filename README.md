# Middleman

A MIDI practice app for a digital piano. It plays backing tracks out to the piano
and shows what you're playing back, in the browser.

## Running

```bash
./serve.sh          # then open http://localhost:8765 in Chrome
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
index.html          markup only
style.css
tracks.json         the backing tracks (data, not code)
src/
  app.js            wiring: transport, playhead, panels, event handlers
  tracks.js         loads/validates tracks.json, build() -> event list
  theory.js         note spelling, scales, bass patterns, chord labels
  midi.js           Web MIDI in/out, the `held` set, panic()
  metronome.js      WebAudio click
  keyboard.js       the piano strip
  notation.js       abcjs rendering, chord-box geometry, played-note painting
vendor/
  abcjs-basic-min.js   abcjs 6.4.4, vendored so the app works offline
```

Native ES modules — no build step, no `node_modules`. Edit and refresh.

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


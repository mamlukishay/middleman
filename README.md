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
- **Top bar** — play/stop (or the space bar), a metronome toggle, and tempo.
  Tempo can be dragged or typed by clicking the bpm number. Changing tempo
  mid-playback re-anchors the clock, so the playhead stays continuous.
- **Middle** — the form as a chord strip, plus engraved notation. The current
  bar's chord symbol is boxed, and the sounding note is blue.
- **Bottom** — scale, chords, and a keyboard showing scale tones (amber),
  the backing track (blue), and **your playing (fuchsia)**.

Your played notes also light up on the staff by **pitch class** — you'll be
soloing an octave or two above the written bass line, so exact-pitch matching
would essentially never fire.

## Tracks

| Track | Form | Feel |
|---|---|---|
| C / F / G blues | 12-bar, dominant 7ths | shuffle (swung eighths), boogie bass |
| Billie Jean | 4-bar F#m7 vamp | straight eighths |

The Billie Jean track is a vamp **in the style of** the verse groove — the chord
and feel, not a transcription of the bass line. Chorus changes aren't included.

## Layout

```
index.html          markup only
style.css
src/
  app.js            wiring: transport, playhead, panels, event handlers
  tracks.js         TRACKS definitions + build() -> beat-stamped event list
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

Append to `TRACKS` in `src/tracks.js`. Nothing else needs to change — form length,
notation layout, the chip strip, and the scale panel all derive from the entry:

```js
{name:'A minor groove', sub:'90 bpm', root:45, bpm:90, swing:.5, sharps:false,
 pattern:'minorVamp', quality:'m7', form:[0,0,5,7], cols:4,
 scale:MINPENT, scaleName:'A minor pentatonic', blue:null}
```

`root` is a MIDI note number (bass register), `form` is one entry per bar as
semitones above `root`, `swing` is where the offbeat lands (`2/3` swung, `.5`
straight), and `cols` is bars per notation line.

## Notes for future work

Two abcjs behaviours cost real debugging time and are worth remembering:

- Noteheads are `.abcjs-notehead`. There is **no** `.abcjs-note` class.
- Chord symbols are bare `<text>` elements with **no class**, and abcjs typesets
  `#`/`b` as the glyphs `♯`/`♭` — so they're matched by normalised text content.
- A blank line anywhere in an ABC header **terminates the tune** and silently
  drops the entire body.


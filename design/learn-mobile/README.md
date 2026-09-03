# Learn on a phone: design canvas

The sources behind https://claude.ai/code/artifact/dd5d230d-2e58-401a-966d-ba1dbc8d3ebf.

Each `.dc.html` is one artboard; `canvas.json` lays them out. The published page is
assembled from these and is not committed. Static mockups, not a prototype: the
controls do not work, the states are drawn.

| Artboard | What it shows |
|---|---|
| `Main` | the step screen while playing, landscape, in the **Roll** view: compact roll, live meter, one Stop, keys with the next notes lit |
| `WaitMode` | the same screen with no clock: the cursor on the roll, the note being waited on, "notes found" instead of a percentage |
| `StepDone` | the transition: what was achieved, what is next, a countdown that starts the next step by itself |
| `Staff` | the same instant as `Main` in the **Staff** view: one system of the grand staff, bars 5–6 of 5–8, hits green, the miss red, the playhead through bar 6 |
| `StaffWait` | the same instant as `WaitMode` in the Staff view: no clock, no playhead, a box on the note being waited on |
| `Falling` | the **Falling** view: bars streaming down onto a full-width key strip, ~3 beats of look-ahead, a hands-together step so both hand colours show |
| `Home` | the song list with progress, and the reminder that the phone plays what the laptop serves |
| `Path` | the lesson path for a song: sections as a vertical path, steps as nodes (done / now / to do / locked), a sticky Continue |
| `FreeSheet` | free practice as a bottom sheet: bars, hands, challenge, click / wait / loop, tempo stepper, Start |

PNG exports sit next to this file (`step-landscape.png`, `wait-mode.png`,
`step-done.png`, `step-staff.png`, `step-staff-wait.png`, `step-falling.png`,
`home.png`, `lesson-path.png`, `free-practice-sheet.png`).

## What the teaching apps get right, and what this takes from them

Looked at as workflows, not features: Simply Piano, Flowkey, Yousician, Skoove,
and the Synthesia-style falling-notes players.

- **One clear next action.** Every screen has exactly one big button and it is
  always in the same place. Here: Continue at the bottom of the path, Start/Stop
  at the bottom-right while playing, Go now on the done card.
- **A visible path with progress.** The course is a path you can see, with the
  current node marked and what is behind you ticked. Locked steps ahead keep the
  path readable without inviting a skip you will regret. Here: `Path`, with the
  per-song progress ring on `Home`.
- **Short steps, immediate feedback.** A step is one section, one hand, one
  challenge; the feedback is on the notes themselves (green / red), not in a
  report. The live meter says how the current pass is going before it ends, so
  you know whether to push on or slow down.
- **A "wait for me" mode** for learning the notes before the rhythm. Every good
  app has it; here it is a first-class step, with the waited-on note named.
- **Hands-free transitions.** The apps that feel good never make you reach for
  the screen between steps. Here the done card counts down and starts the next
  step by itself; a tap skips the wait.
- **What to avoid:** clutter (a step description you cannot read while playing),
  small controls (a slider on a music stand), and hidden state (is the click on?
  is it looping? which hand is mine?). Every toggle here is a lit chip, and the
  hands are named by colour on the roll and on the keys.

One thing deliberately not copied: gamified streaks and stars. Ishay wants a
practice tool, not a game.

## The three views of the loop

The desktop Learn page shows the loop three ways and remembers which you chose;
the phone gets the same three, because the reason for each of them is stronger on
a phone, not weaker. They share one chrome — header, stage, meter + Stop, keys —
and only the middle band changes, so switching never moves anything else.

- **Staff** — an engraved grand staff. Noteheads turn green on a hit and red on a
  miss, a white playhead runs through the bars, the bar being played is tinted
  amber, and in wait mode a box sits on the notes being waited on. The hand the
  app plays is drawn as dimmed outlines, the same way the roll dims it.
- **Roll** — the existing piano roll: bars left to right, pitch bottom to top,
  blue left hand, amber right, green hit, red-outlined miss, a red tick where a
  wrong note was played.
- **Falling** — Synthesia-style bars in the hand's colour, aligned to the keys on
  screen, streaming down so a bar's bottom edge lands on its key at the onset.
  Same colouring; a hit glows green as it lands, a miss stays a red outline, and
  a wrong note leaves its tick on the line above the key that was played.

**The switch** is a compact segmented control in the stage header, in the same
spot on every playing screen (`Main`, `WaitMode`, `Staff`, `StaffWait`,
`Falling`). It is *recessed* — a raised, amber-lettered segment on a sunken
track — rather than a lit amber chip like Click / Wait / Loop: it picks a view,
it does not change what the app is doing, and the amber chips beside it are
reserved for state that does. Whole segments are 40px tall and 48px+ wide, so it
takes no aim while playing.

### How they trade off on a phone

Written on the canvas as sticky notes beside the artboards, in short:

- **Staff wants the most horizontal room.** The brace, clefs and key signature
  take the first 100px, and a bar has to stay wide enough to read, so two bars
  fit per system where the desktop fits the whole four-bar loop. The phone draws
  one system and scrolls the current one into view — which means the stage jumps
  once every two bars while you play. That is the price of real notation here.
- **Falling wants the keys at full screen width**, with the lane sitting directly
  on them; a bar has to land on its own key or the idea breaks. That pushes the
  meter and Stop up under the header, making it the one screen where the primary
  action is not bottom-right. 178px of lane is about three beats of look-ahead.
- **Roll is the most compact.** All four bars fit at once, so it is the only view
  that shows where you are *in the loop* rather than only what is coming next —
  and the loop is what every tutor step is built on.

**Recommended default on the phone: Roll**, deliberately not the desktop default.
On a laptop the staff has the width to hold the whole loop and it is the view
that teaches reading, so it earns the default there. On a phone it holds two bars
and has to scroll, and a stage that jumps while your hands are on the keys is the
one thing a music stand cannot afford. Staff is one tap away and is the right
view for a reading step, for wait mode (no clock, so nothing scrolls under you),
and when the phone is propped further back; falling is the one to reach for in a
hands-together step. The choice is remembered per device, so the phone can sit on
Roll while the laptop sits on Staff.

## Decisions

- **Landscape to play, portrait to browse.** The phone sits on the music stand;
  sideways gives the roll and the keys the width, and both hands are on the
  piano so nothing on that screen needs precision. Rotating is the mode switch.
- **Tap targets are 40px or more**, chips 40px, the primary button 52–56px.
- **Tempo is a stepper** (−5 / +5), not a slider.
- **The step text lives on the path node and the done card**, not on the playing
  screen.
- **The sheet holds free practice.** Bars (stepper plus section chips), hands
  (You / App / Off per hand), challenge, click / wait / loop, tempo, Start.
- **Same visual language as the desktop page**: dark, accent `#e8b44a`, left hand
  `#2f7fd0`, right hand `#e8b44a`, you `#ff2fd6`, hit `#5fbf7a`, miss `#e63d40`,
  the system font, 8px radii on controls, the monospace numerals.

## Implementation note

Reused unchanged: `src/song.js`, `src/learn/plan.js`, `src/learn/scorer.js`,
`src/learn/engine.js`, `src/learn/meter.js`, `src/midi.js`, `src/clock.js`,
`src/metronome.js`. The phone would open the same server (`./serve.sh`) over the
LAN; Web MIDI is not available on iOS Safari at all, and on Android Chrome it
works but sits behind a permission prompt and needs a secure context — which a
plain `http://<laptop-ip>` does not give. So for the first pass the piano stays
connected to the laptop and the phone is a **remote view**: the laptop page keeps the engine and the MIDI port, and the phone shows
state and sends commands over a WebSocket or a `BroadcastChannel`-style relay.
That is the one piece of new plumbing this design needs.

New for the phone: `learn-mobile.html` with its own layout, a keyboard strip
sized to the width, touch controls (steppers and chips instead of sliders and
the bar strip), the bottom sheet, and orientation handling.

The three view modules are reused as they are on the desktop — `src/learn/staff.js`,
`src/learn/roll.js`, `src/learn/fall.js` — since each already takes the loop, the
hands and the live hit/miss state and draws into an element it is given. What
differs on the phone:

- `roll.js`: nothing but size. It already takes a height and a pitch window, so
  the compact roll is CSS.
- `staff.js`: needs a **bars-per-system** input (2 on a phone against 4 on the
  desktop) and, with it, "scroll the current system into view" when the playhead
  crosses a system boundary — the one genuinely new behaviour of this design.
  Wait mode's box on the waited-on notes is the same call `roll.js` already has
  (`cursor(group)`), so the two views can share the engine's wait state untouched.
- `fall.js`: must take its key geometry from the on-screen key strip rather than
  computing its own, or the bars stop landing on their keys; the strip goes
  full-bleed on the phone while the desktop's is inset. Look-ahead is a parameter
  (~3 beats at the phone's lane height), not a constant.
- The switch: the same three-way choice as the desktop, stored under its own
  `localStorage` key, because the right default differs (Roll on the phone, Staff
  on the desktop).

Suggested order: (1) the remote-view relay, laptop side, with a tiny status page
to prove it; (2) the landscape step screen with the roll view against the live
engine state; (3) the done card and auto-advance (already exist on the desktop;
they only need the layout); (4) the path and home; (5) the free-practice sheet;
(6) the view switch — falling first (it only needs the key geometry), staff last,
because scrolling the system is the only part of this that is not already built.

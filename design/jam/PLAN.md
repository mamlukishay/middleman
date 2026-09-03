# Jam: the plan

Filed 2026-09-04 from a conversation about whether to advance the jam. The
mechanism is described in `ARCHITECTURE.md`; the interactive `explainer.html` is a
*simulation* of that design, not the app. Steps 1 and 2 of the tour (the agreed
clock, the snapshot fan-out) show what is built today; the note fan-out, the tape and
the cloud switch show what this plan proposes.

## The decision

Advance to the two-player slice only, then decide the rest after playing.

**For:** most of the engine exists (room, agreed clock, snapshot fan-out, a stamped
`note` event, Out routing, the looper); the design keeps one brain so multi-device
bugs do not multiply; a two-player evening answers the one real unknown, whether a
~30 ms hold on this Wi-Fi feels like music; and it gives the relay a reason to exist
beyond the mirror.

**Against:** it pulls away from the tutor, which is the product; the relay was built
for a mirror (notes are perishable and dropped past eight in flight, every note is a
separate HTTPS POST through a stdlib Python server); iPhone Safari has no Web MIDI so
an iPhone is a screen, not a player; it is same-room, same-Wi-Fi only; multi-device
timing bugs are hard to reproduce and the smoke test would have to grow; and the
shared log with per-player loops is where the real weeks go.

## Steps

1. **`from` on every note.** Every `note` that crosses the relay names the player it
   came from. The phone mirror keeps working exactly as it does.
2. **Two players, one room.** A second device with a MIDI input (laptop or Android,
   or the software piano) joins the laptop's room as a player. Each device plays
   every note that is not its own through its Out, scheduled at the note's room-time
   plus a small fixed hold (about 30 ms); a note later than the hold plays at once.
   Your own instrument sounds locally with no delay. Verified with `npm test`,
   `npm run smoke`, and a headless two-tab check.
3. The conductor's transport shared: start, click and loop everyone follows.
4. The log: record the room, loop a slice.

Steps 1 and 2 are in progress. Steps 3 and 4 wait on how step 2 feels to play.

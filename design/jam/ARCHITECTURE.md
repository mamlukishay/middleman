# Jam: many players, one room

The mirror, generalised. Nothing that exists is undone; two things are added.

## The mental model

A **room** is one shared clock and one mailbox. Today one device is the brain and
one is the screen. In a jam every device is a **player** (an instrument in, sound
out), a **screen** (draws the room), or both. One player, the one who opened the
room, is also the **conductor**: it owns start, stop, tempo and loop. Everyone else
sends commands, exactly as the phone does today. There is never a second brain, so
there is never a fight.

The room gains a **log**: every note anyone played, stamped in room time. A
recording is a slice of the log. A loop is a slice played again on the room's clock.
The looper we already have does this on one machine; it becomes per player.

## The same three messages, plus one field

| kind      | today                                   | jam                                                  |
|-----------|-----------------------------------------|------------------------------------------------------|
| snapshot  | the lesson: step, tempo, hands, anchor  | the session: tempo, loop, who is in the room, anchor |
| event     | hit / miss / extra / pass / note (sound)| `note` gains `from` (which player) and is sent by all |
| command   | the phone's taps                        | any player's taps, applied by the conductor          |

`note` is the whole of the new traffic: `{type:'note', from, data:[status, pitch, vel], t}`.
A device plays every note that is not its own through its Out, and records all of them.

## Q1. How does timing stay in sync?

The clock is not shared by streaming; it is *agreed*. Each device measures its
offset to the server's clock with a few round trips, keeps the median, and re-measures
every thirty seconds and after every reconnect (this is `sync.js`, in use today). On a
Wi‑Fi LAN that agreement is good to a couple of milliseconds. Everything that crosses
the wire carries a room-time stamp: the beat-0 anchor in the snapshot, and each note.

A receiver converts the stamp to its own clock and schedules the note at that time
**plus a small fixed hold** of about 30 ms. The hold is what keeps notes in order
when one packet is late; a note later than the hold plays at once. Your own instrument
sounds locally with no delay at all. You hear another player about 20 to 40 ms after
they play, the same as sitting seven to twelve metres apart, which musicians manage.

Over the internet this does not hold. The jam is a same-room, same-Wi‑Fi feature.

## Q2. Whole snapshots or diffs?

Whole, and not as a first step: as the design. A snapshot is a few hundred bytes and
goes out only when something changes, a few times a minute. There is nothing to
optimise. Diffs would add the one thing a mailbox cannot give: ordering. Miss one diff
and a device is wrong until the next full state; miss one snapshot and the next one
heals it. The traffic that matters is events, and those are already the minimum.

If a snapshot ever grew heavy, it would be because something that is not state crept
in, such as the log. The fix is to keep the log out of it, never to diff it.

## The simple path

1. Write the protocol down (this page is most of it) and give `note` its `from`.
2. Two players in a room: laptop and one more device, each hearing the other.
3. The conductor's transport shared: a start, a click and a loop everyone follows.
4. The log: record the room, loop a slice.

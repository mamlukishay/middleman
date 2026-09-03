# Getting around Middleman

A proposal for the navigation, the phone, and the way out of it.
Mockup: `mockup.html` / `mockup.png`. Screenshots of how it looks today are beside them.

---

## The idea in one paragraph

Middleman does three things and each one is a page: **Practice** (backing tracks),
**Looper** (record loops over them), **Learn** (a song, taught step by step). Those
three are equals, so they get one row of buttons in the same corner of every page,
and the one you are on is lit. The phone is **not a fourth thing**. The phone is the
Learn page put on the music stand, so it is not in that row at all — it is an action
inside Learn called **Put it on the phone**, which shows a QR code. The phone page
then works out for itself which of its two situations it is in: on an Android with the
piano plugged in it runs the lesson, and on an iPhone (which cannot talk to a piano at
all) the laptop keeps running the lesson and the phone shows it. You never choose
between those and you never see the words *remote*, *mirror* or *room* — the phone
just says, at the top, either **on this phone** or **showing the laptop**, and offers
one way out.

---

## The navigation

**One row, top of the left sidebar, on all three laptop pages.** It uses the segmented
control the app already has (the amber-on-dark `.seg`), so it looks like the view
switcher on the Learn stage and needs no new visual language.

```
┌────────────┬──────────┬─────────┐
│  Practice  │  Looper  │  LEARN  │   ← the current page is amber
└────────────┴──────────┴─────────┘
```

Labels, exactly: **Practice** · **Looper** · **Learn**. Nothing else, no arrows.
It is the first thing in the sidebar, above the track/song list, in the same 200px
column on every page, so it never moves and never has to be looked for.

Today's five grey text links at the bottom of the sidebars go away entirely (and two
of them on the practice view are not even styled — they render as blue underlined
browser links).

## The phone

On the **Learn** sidebar, under the progress bar, one full-width button:

| state | label | look |
|---|---|---|
| not sharing | `Put it on the phone` | normal button |
| sharing | `On the phone` | amber, panel open below |

Sharing opens the panel that is there today — the QR, the address — plus a one-line
hint that replaces having to explain a "room id":

> Scan it with the phone's camera. Code: **3wj42z**

and a status line: `Waiting for the phone…` → `Phone connected · 4 ms` →
`Reconnecting…`. Pressing the button again stops sharing.

**On the phone page**, the Home screen header says where it is and how to get out:

```
Learn                                   [ Stop mirroring ]
showing the laptop · 4 ms
```

- Standalone (Android, piano on the phone): second line reads **on this phone**, and
  there is no button — there is nothing to leave.
- Showing the laptop: second line reads **showing the laptop · 4 ms**, and the button
  reads **Stop mirroring**. One tap and the phone goes back to being just the phone.
- Connecting or dropped: **connecting…** / **reconnecting…**, button unchanged.

The phone's own "connect by hand" button (for when the camera cannot read the screen)
is relabelled **Connect to the laptop**, and it asks for *the code under the QR* rather
than a "room id".

## The way out of phone mode

Three ways in, three ways out, and none of them is buried:

1. **You are on a laptop looking at the phone page.** This mostly stops happening,
   because the "Learn on the phone" links that led here are gone. If you still land
   here (a bookmark, the QR opened on the wrong machine), a strip appears across the
   top — only on a wide screen with a mouse — saying
   **This is the phone screen.  → Learn on the laptop**. One click and you are back.
   It is a CSS media query and a link; there is no state to it.

2. **You are on the phone, mirroring the laptop.** The Home header says so and carries
   **Stop mirroring**. From the playing screen, `‹` gets you to the lesson path and `‹`
   again to Home — the chain that already exists — so it is never more than two taps.

3. **You are on the phone, full screen, and the browser bar is gone.** The `⛶` button
   in the playing screen's top bar becomes a **toggle**: press it again and full screen
   drops, the orientation unlocks and the browser comes back. Today it only goes in.

**What a reload does:** it keeps mirroring. That is what you want on a music stand —
the phone sleeps, the page reloads, the lesson is still there rather than a setup
screen. The price of remembering it is that it must be *visible*, which is exactly what
the header line is for: every reload lands on a screen that says **showing the laptop**
with **Stop mirroring** beside it. Stopping clears the memory, so the next reload comes
up plain.

## What gets removed

- `Looper →`, `Learn a song →`, `Learn on the phone →` from the practice view.
- `← practice view` from the looper.
- `← practice view`, `looper →`, `Phone view →` from Learn.
- The phone's whole **Also on this page** block — `Practice view`, `Looper`,
  `← Learn on the laptop`. Those two pages have no phone layout, so those buttons only
  lead somewhere unusable.
- The three-line paragraph under the phone's connect button, down to one line.

Ten links out, three controls in: the nav row, the leave button, the desktop strip.

## Two things I considered and did not do

**Put the tabs in the top transport bar instead of the sidebar.** That bar is already
full on every page and it wraps on the looper, so the tabs would sit in a different
place depending on the window width and on which page you were on — the opposite of
what is wanted.

**Keep the phone as a fourth tab.** It reads as a place you can go, but on a laptop
going there is always a mistake — which is complaint 3 in one sentence. Putting it up
as an equal of Practice and Looper would guarantee that mistake keeps happening.

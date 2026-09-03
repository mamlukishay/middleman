// Two pianists, one room: your hands come out of their Out, theirs come out of yours.
//
// This is the mirror generalised, and it reuses every part of it -- the same room, the
// same agreed clock (sync.js), the same three message kinds. Only one message is new
// traffic, and it is not even a new kind: `note` now carries `from`, the relay client
// id of the device whose hands (or whose app) played it.
//
// The two uses of `note` are told apart by one flag, and they have to be, because they
// are two different jobs on one message:
//
//   * `live: 1`  -- a pianist's hands, right now. Every player in the room plays it
//                   through its own Out and nobody else's. This module.
//   * no `live`  -- the app's own output, on its way to whichever speaker was asked
//                   for. That is the phone mirror (host.js -> remote.js), and a phone
//                   on a music stand must go on playing exactly the laptop's lesson
//                   and not the room's playing, so it ignores anything `live`.
//
// A device never plays its own notes back: the relay already skips the sender, and the
// `from` check below is the belt to that braces. Your own instrument is sounding under
// your hands with no delay -- an echo of it 30 ms later is not music, it is a fault.
//
// Being a player is *said*, never inferred: a Jam control on the Learn page, one per
// device, remembered like "Put it on the phone" is. There is no way to work it out
// from what a device can do -- a laptop with a piano attached is a player when it is
// asked to be and a mirror host when it is asked to be, and often both at once.
//
// What this does not do yet: the conductor's transport is not shared (each player
// still starts its own lesson), nothing is recorded, and the pedal does not travel.
// Those are steps 3 and 4 in design/jam/PLAN.md, and they wait on how this feels.

import { makeRelay, relayInfo } from './relay.js';
import { pickRoom } from './host.js';
import { toLocal, toServer } from './sync.js';
import { audio } from '../metronome.js';

/**
 * How long a received note is held before it sounds.
 *
 * The hold is the whole trick. Packets do not arrive evenly, and a note played the
 * instant it lands is a note whose rhythm is the network's rather than the pianist's.
 * Waiting a fixed 30 ms past the moment it was played puts every note that got here
 * inside that window back in the order and the spacing it was played in. 30 ms is
 * also about seven to twelve metres of air, which is two musicians on one stage --
 * a distance players deal with without noticing.
 */
export const HOLD_MS = 30;

/**
 * A stamp further ahead than this is not a note in the future, it is a clock that has
 * not agreed yet -- a device whose first sync round trips have not landed still has an
 * offset of 0, and its stamps are its own page-load origin, which can be anything.
 * Holding a note for a second on the strength of that is worse than playing it now.
 */
export const MAX_AHEAD_MS = 500;

/**
 * When a received note sounds, on this device's clock. `now` and `at` are both local
 * `performance.now()` -- `at` is the moment it was played, converted out of relay
 * time. The whole scheduling decision, and the only arithmetic in the jam.
 *
 * Late is the normal case for a long packet, not an error: it plays at once, which
 * costs the ordering of that one note and keeps the music moving.
 */
export function playWhen(now, at, hold = HOLD_MS, maxAhead = MAX_AHEAD_MS) {
  if (!Number.isFinite(at)) return now;          // a stamp we cannot read at all
  const t = at + hold;
  if (t <= now) return now;                      // it took longer than the hold: play it
  if (t > now + maxAhead) return now;            // a clock that has not agreed yet
  return t;
}

/** A MIDI note-on/off from `onMidi`, back in the three bytes that crossed the wire. */
const bytesOf = ev => (ev.on ? [0x90, ev.n, ev.v] : [0x80, ev.n, 0]);

/**
 * The wiring, with no page around it: notes in from this device's keyboard, notes out
 * to everybody else's Out.
 *
 * @param relay   a makeRelay, already in the room.
 * @param onMidi  midi.js's onMidi -- what the pianist is playing, note on and off.
 * @param play    midi.js's send -- the one door notes leave by, so the Out toggle and
 *                the volume apply to another player's notes exactly as to the app's.
 */
export function makeJam({ relay, onMidi, play, now = () => performance.now(),
                          hold = HOLD_MS, onChange }) {
  let on = false;
  const stats = { sent: 0, heard: 0, last: null };
  /** The other players who have said they are one, by relay client id. */
  const players = new Set();

  // Who is in the room is *said*, not counted: a room holds mirrors and players and
  // sometimes two connections from one laptop, and "how many are connected" answers
  // none of the questions anyone has. Announced when this stream goes live, again on
  // every join so a newcomer hears it, and again on every resync, which is one POST a
  // half minute and heals whoever was already here before this device arrived.
  const iAmAPlayer = () => { if (on) relay.send({ type: 'player', from: relay.client }); };
  relay.onStatus?.(s => { if (s === 'live') iAmAPlayer(); });
  relay.on('join', iAmAPlayer);
  relay.on('player', ev => {
    if (!ev.from || ev.from === relay.client || players.has(ev.from)) return;
    players.add(ev.from); onChange?.();
  });
  relay.on('leave', ev => { if (players.delete(ev.client)) onChange?.(); });

  // Out: every note the pianist plays, stamped in relay time. `ev.t` comes from the
  // MIDI subsystem, so it is the moment the key went down rather than the moment this
  // callback ran -- which is the only reason the hold is allowed to be as short as it
  // is. The pedal is deliberately not sent: it is the room's, not one note's, and it
  // belongs with the shared transport in step 3.
  onMidi(ev => {
    if (!on || ev.cc !== undefined) return;
    const sent = relay.send({
      type: 'note', live: 1, from: relay.client,
      data: bytesOf(ev), t: toServer(ev.t, relay.offset),
    });
    if (sent) stats.sent++;
  });

  // In: everybody else's. `live` keeps the mirror's own note stream out of this, and
  // `from` keeps this device's out of it -- the relay already skips the sender, so
  // that check only fires for a device that is in the room twice (a laptop hosting a
  // phone *and* playing has two subscriptions), which is a real arrangement.
  relay.on('note', ev => {
    if (!on || !ev.live || ev.from === relay.client) return;
    if (!Array.isArray(ev.data) || ev.data.length < 3) return;
    const t = now();
    const at = playWhen(t, toLocal(ev.t, relay.offset), hold);
    play(ev.data, at);
    stats.heard++;
    // `wait` is what was left of the hold when this note landed: the honest measure of
    // whether 30 ms is enough on this Wi-Fi, which is the one question step 2 exists
    // to answer. Zero means the note was already late and played at once.
    stats.last = { from: ev.from, data: ev.data, at, wait: at - t };
  });

  return {
    get on() { return on; },
    get players() { return players.size; },
    get sent() { return stats.sent; },
    get heard() { return stats.heard; },
    get last() { return stats.last; },
    // turning off forgets the room; turning on says nothing yet, because the stream is
    // not open until mountJam opens it and going live is itself the announcement
    set(v) { on = !!v; if (!on) players.clear(); },
  };
}

const ON_KEY = 'middleman.learn.jamming';
const ROOM_KEY = 'middleman.learn.room';       // the same one host.js remembers

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** The same shape, doing nothing, for a page with no Jam panel in it. */
const inertJam = () => ({
  on: false, room: null, client: null, players: 0, sent: 0, heard: 0, last: null,
  start() {}, stop() {},
});

/**
 * @param el   { btn, box, hint, state } -- the sidebar's Jam panel
 * @param deps { onMidi, play } -- midi.js's two doors, handed in rather than reached
 *             for, so the scheduling above can be tested without a browser.
 */
export function mountJam(el, { onMidi, play, now, wake = audio } = {}) {
  // like mountHost: a page without the panel must not throw and take the lesson with it
  if (!el || !el.btn || !el.box || !el.state) return inertJam();

  // A room named in the URL wins over the server's own. Two players on one server (the
  // second opened the first's address, as the phone does) need nothing; two players
  // each on their own server can only meet by naming a room, and this is where they say it.
  let urlRoom = null;
  try { urlRoom = new URLSearchParams(location.search).get('room'); } catch { /* no URL */ }
  let room = urlRoom || pickRoom(null, read(ROOM_KEY));

  const relay = makeRelay({ room });
  const jam = makeJam({ relay, onMidi, play, now, onChange: () => paint() });
  let on = false, noRelay = false, asking = null;
  // an address to print before the server has answered: the page's own is a fair guess
  // and a blank line in the panel is not
  let link = jamLink(location.href, null, room);

  /** Who this server is: the room to meet in, and whether there is a relay at all. */
  function loadInfo() {
    if (asking) return asking;
    asking = relayInfo().then(info => {
      asking = null;
      noRelay = info === null;
      if (!urlRoom && info?.room && info.room !== room) {
        room = info.room; write(ROOM_KEY, room); relay.setRoom(room);
      }
      link = jamLink(location.href, info ?? null, room);
      paint();
      return info;
    });
    return asking;
  }

  function paint() {
    el.box.hidden = !on && !noRelay;
    el.btn.classList.toggle('on', on);
    el.btn.textContent = on ? 'Jamming' : 'Jam with another player';
    if (el.box.hidden) return;
    const n = jam.players;
    const here = !noRelay && relay.status === 'live' && n > 0;
    const rtt = relay.synced ? ` · ${Math.round(relay.rtt)} ms` : '';
    el.state.textContent = noRelay ? 'No relay on this server'
      : relay.status !== 'live' ? 'Connecting…'
      : here ? `Jamming with ${n} other player${n > 1 ? 's' : ''}${rtt}`
      : 'Waiting for the other player…';
    el.state.classList.toggle('ok', here);
    if (!el.hint) return;
    el.hint.innerHTML = noRelay
      ? 'This server has no relay, so there is no room to jam in. Run ./serve.sh.'
      : `Open <b>${link}</b> on the other machine and turn Jam on there too.<br>`
        + `Room: <b>${room}</b> · notes are held ${HOLD_MS} ms so they arrive in order.`;
  }

  function start() {
    on = true; jam.set(true);
    write(ON_KEY, '1');
    paint();
    loadInfo().then(info => {
      if (!on) return;              // stopped while the answer was out
      if (info === null) return paint();
      relay.open();
    });
  }

  function stop() {
    on = false; jam.set(false); noRelay = false;
    write(ON_KEY, '');
    relay.close();
    paint();
  }

  // the click is also the gesture the audio context wants, before another player's
  // notes can come out of this machine's speakers. Only the click: the remembered
  // auto-start below is not a gesture, and an AudioContext built at load is a
  // suspended one that has to be resumed on the next tap anyway.
  el.btn.onclick = () => { wake?.(); return on ? stop() : start(); };
  relay.onStatus(paint);
  paint();
  loadInfo().then(info => { if (info !== null && read(ON_KEY)) start(); });

  return {
    get on() { return on; }, get room() { return room; }, get client() { return relay.client; },
    get players() { return jam.players; }, get status() { return relay.status; },
    // The jam's own connection, as mountHost exposes the mirror's. Not for the page:
    // it is how `scripts/measure-jam.mjs` reads the clock this room agreed on. A
    // latency between two machines is a number in *relay* time, and a tab that only
    // knows its own performance.now() cannot say one -- the offset has to come from
    // the same sync.js estimate the scheduling above is already using, or the answer
    // is a measurement of two unrelated page-load moments.
    get relay() { return relay; },
    get sent() { return jam.sent; }, get heard() { return jam.heard; }, get last() { return jam.last; },
    start, stop,
  };
}

/**
 * The address the other player opens, which is not the address of this page: the Learn
 * page is nearly always on localhost, and localhost on the other machine is the other
 * machine. Same swap as the phone's link in host.js, and the same reason -- the room
 * lives in *this* server's memory, so the second player has to land on this server.
 * Shown without a scheme, because it is read off a screen and typed in by hand.
 */
export function jamLink(pageUrl, info, room) {
  const u = new URL('learn.html', pageUrl);
  const ip = info?.addrs?.[0] ?? null;
  if (info) u.protocol = info.tls ? 'https:' : 'http:';
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && ip) u.hostname = ip;
  u.searchParams.set('room', room);
  return u.toString().replace(/^https?:\/\//, '');
}

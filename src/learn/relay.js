// The channel between the laptop and the phone in remote mode, on both ends.
//
// Server-sent events in, POSTs out, against the endpoints in serve.py. Nobody here
// knows what a room's messages *mean* -- host.js and remote.js do -- so this stays
// the small, boring part: connect, reconnect, keep a clock estimate, hand events to
// whoever asked for them.
//
// EventSource reconnects on its own, which is most of why it is used instead of
// hand-rolling a long poll: a laptop that sleeps, a Wi-Fi that blinks or a server
// restarted mid-session all come back without a line of code here. What does need
// saying is that the clock estimate has to be taken *again* after a reconnect, and
// every half minute anyway, because a phone that has been asleep comes back with a
// performance.now() that has drifted against everything else.
//
// Whether the server has a relay at all is decided *before* any of this is armed, by
// one `GET /relay/info` at the top of host.js and mobile.js (see `relayInfo` below).
// The repo served by `python3 -m http.server` answers it with a 404, and nothing here
// is ever opened: no EventSource, no clock samples, no POSTs. That question is asked
// once, in the page, because the page has to ask it anyway -- it is where the phone's
// address and the room come from -- and because a channel that spends its life
// wondering whether it exists is a channel with two jobs.
//
// So everything below assumes a relay. A drop is a Wi-Fi that blinked or a server
// being restarted, and every second it is not reconnected is a second of the phone
// showing a lesson that has stopped following the laptop -- so the retry is a second,
// doubling up to half a minute if the laptop has really gone away.

import { makeSync } from './sync.js';

const RESYNC_MS = 30_000;
/** How soon a dropped stream is tried again, and how far that backs off. */
const RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
/** Sends are fire-and-forget, so a stalled server must not be allowed to queue them. */
const MAX_INFLIGHT = 8;
/**
 * The ceiling for the messages that only happen once. Reached only by a server that
 * has stopped answering altogether, which is what the cap is for in the first place.
 */
const MAX_QUEUED = 64;
/**
 * The messages a dropped one of costs nothing: another is along in a few
 * milliseconds and it replaces this one entirely. Everything else -- a snapshot, a
 * hit, a miss, a command -- happens once, and losing one is a phone left on the
 * wrong bar or a notehead that never goes green.
 */
const PERISHABLE = new Set(['held', 'note']);

/** A short, unambiguous id: no vowels, so a room never spells anything. */
export const shortId = (n = 6) => {
  const abc = '23456789bcdfghjkmnpqrstvwxz';
  return Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
};

/**
 * Who the server is -- `{ port, tls, bind, addrs, room }` -- and, in the answering,
 * whether it has a relay in it at all. Three outcomes, and they are three different
 * situations that must not be confused:
 *
 *   an object    a relay. `room` is the room to pair in; the rest builds the phone's
 *                link. (An old server answers without `room`.)
 *   `null`       the server answered and has no relay: a 404, a 501, an HTML error
 *                page where JSON was expected. `python3 -m http.server`. Nothing is
 *                worth opening against it and nothing should keep asking.
 *   `undefined`  it could not be reached at all. A laptop that is asleep or a Wi-Fi
 *                that has not come up -- which is emphatically *not* "no relay", and
 *                the phone on the music stand must keep trying rather than give up.
 */
export async function relayInfo(base = '', net = globalThis) {
  let r;
  try { r = await net.fetch(`${base}/relay/info`, { cache: 'no-store' }); }
  catch { return undefined; }
  if (!r.ok) return null;
  try {
    const info = await r.json();          // an HTML error page throws here
    return info && typeof info === 'object' ? info : null;
  } catch { return null; }
}

/**
 * `room` is the pairing id; `client` names this end so the relay does not echo a
 * message back to whoever sent it. Nothing connects until `open()` is called.
 *
 * `net` is where `fetch` and `EventSource` come from -- the window in the browser, a
 * pair of fakes in a test, the same trick sync.js plays with `fetchTime`.
 */
export function makeRelay({ room, client = shortId(8), base = '', net = globalThis,
                            retryMs = RETRY_MS } = {}) {
  const listeners = {};
  const statusFns = new Set();
  let es = null, status = 'idle', timer = null, retryTimer = null, peers = 0;
  let want = false;               // open() called and close() not: nothing retries unless this
  let inflight = 0;
  let backoff = retryMs;

  const sync = makeSync({
    fetchTime: async () => {
      const r = await net.fetch(`${base}/relay/time`, { cache: 'no-store' });
      // reject on the status rather than on the body: a 404 page is HTML, and parsing
      // it to find that out is slower and noisier than reading one number
      if (!r.ok) throw new Error(`relay/time ${r.status}`);
      return (await r.json()).t;
    },
  });

  const emit = (type, x) => (listeners[type] || []).forEach(fn => fn(x));

  function setStatus(s) {
    if (s === status) return;
    status = s;
    statusFns.forEach(fn => fn(status));
  }

  async function resync() {
    await sync.measure();
    emit('sync', sync.last);
    statusFns.forEach(fn => fn(status));      // the readout carries the round trip
  }

  /**
   * One retry, at most one outstanding. A second, doubling to half a minute: the
   * phone is blind between the drop and the reopen, showing a picture of the laptop
   * that has stopped following it with nothing on screen to say so, so the first few
   * tries are quick -- and a laptop that has really gone to sleep is not worth a
   * request a second all evening.
   */
  function retryLater() {
    if (retryTimer || !want) return;
    const wait = backoff;
    backoff = Math.min(MAX_RETRY_MS, backoff * 2);
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
  }

  /** Drop the stream and its resync timer, leaving `want` alone. */
  function drop() {
    clearInterval(timer); timer = null;
    es?.close(); es = null;
  }

  function connect() {
    if (es || !want) return;
    setStatus('connecting');
    es = new net.EventSource(`${base}/relay/events?room=${encodeURIComponent(room)}&client=${client}`);
    es.onopen = () => {
      backoff = retryMs;                      // it came back: the next drop is quick again
      setStatus('live');
      resync();
    };
    es.onerror = () => {
      if (!es) return;
      // CLOSED means the browser has given up and will not reopen -- so the backoff
      // above does it instead. CONNECTING means EventSource is retrying by itself,
      // which is most of why it is used at all, and is left alone.
      if (es.readyState === 2) { drop(); setStatus('closed'); retryLater(); }
      else setStatus('reconnecting');
    };
    es.onmessage = m => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.type === 'open') { setStatus('live'); return; }
      if (ev.type === 'join' || ev.type === 'leave') peers = Math.max(0, (ev.subs ?? 1) - 1);
      emit(ev.type, ev);
      emit('*', ev);
    };
    // the first measurement waits for `onopen`: eight round trips against a socket
    // that has not connected yet are eight requests spent finding out what the stream
    // is about to say anyway
    timer = setInterval(resync, RESYNC_MS);
  }

  return {
    client,
    get room() { return room; },
    get status() { return status; },
    get offset() { return sync.offset; },
    get rtt() { return sync.rtt; },
    get peers() { return peers; },
    get synced() { return sync.ready; },

    on(type, fn) { (listeners[type] ||= []).push(fn); return () => listeners[type] = listeners[type].filter(f => f !== fn); },
    onStatus(fn) { statusFns.add(fn); fn(status); return () => statusFns.delete(fn); },

    /**
     * Move to another room, rejoining if the stream is open.
     *
     * The server owns the room now (see `relayInfo`), and both ends learn it from
     * `/relay/info` -- which arrives a moment after the page has already built its
     * relay out of whatever the URL or localStorage remembered. A phone kept on the
     * Home screen with a stale `?room=` frozen into it catches up here.
     */
    setRoom(r) {
      if (!r || r === room) return;
      room = r;
      if (!want) return;
      drop();
      clearTimeout(retryTimer); retryTimer = null;
      backoff = retryMs;
      connect();
    },

    open() {
      if (want) return;
      want = true;
      connect();
    },

    close() {
      want = false;
      drop();
      clearTimeout(retryTimer); retryTimer = null;
      setStatus('idle');
    },

    /** Fire and forget: a command that does not arrive is resent by the next tap. */
    send(event) {
      // Nothing goes out unless a stream is actually open. A POST into a connection
      // that is down cannot arrive, and saying so -- returning null rather than a
      // promise that resolves to nothing -- is what lets host.js know its snapshot
      // never left and send it again on the next tick.
      if (!want || status !== 'live') return null;
      // Two kinds of message share this pipe and they must not share a budget. The
      // small cap keeps a stalled server from queueing the stream of held keys and
      // notes, where the next message replaces this one anyway; a snapshot or a hit
      // happens once, so it keeps going up to a ceiling only a dead server reaches.
      // Spending one budget on both is how a pianist's key strip starves the very
      // events -- state, hit, miss -- that the phone cannot recover on its own.
      if (inflight >= (PERISHABLE.has(event.type) ? MAX_INFLIGHT : MAX_QUEUED)) return null;
      inflight++;
      return net.fetch(`${base}/relay/send?room=${encodeURIComponent(room)}&client=${client}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) })
        .catch(() => null)
        .finally(() => { inflight--; });
    },
  };
}

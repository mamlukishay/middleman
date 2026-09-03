#!/usr/bin/env python3
"""The dev server behind serve.sh and phone.sh. Python's stdlib only, like the rest.

`python3 -m http.server` would nearly do, but not quite. It has no TLS switch, and
it does not know what a .webmanifest is -- Chrome refuses a manifest served as
application/octet-stream, so the phone page would never be installable. It also has
no way for two browsers to talk to each other, which remote mode needs (see below).

    python3 serve.py PORT [BIND] [CERT KEY [CAFILE]]

CAFILE is served at /rootCA.pem, so the phone can fetch the certificate authority
it has to trust straight from the address bar. It is read from wherever mkcert
keeps it rather than copied into the project, so there is nothing to clean up.

That download cannot happen over this server's own HTTPS, though: the phone does not
trust the certificate yet -- that is the whole point of fetching it -- and neither
iOS nor Android will take a certificate or a configuration profile across a
connection it distrusts. Safari's "visit this website anyway" covers pages only; a
profile handed over a bad connection is dropped without a word. So when TLS is on,
a second listener goes up on PORT+1 over plain HTTP, serving nothing but the CA and
a one-paragraph page pointing at it.
"""
import http.server
import json
import os
import queue
import secrets
import socket
import ssl
import sys
import threading
import time
from urllib.parse import urlsplit, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
BIND = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
CERT, KEY = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else (None, None)
CAFILE = sys.argv[5] if len(sys.argv) > 5 else None


# ---------------------------------------------------------------- the relay
# Remote mode: iOS has no Web MIDI, so on an iPhone the laptop keeps the piano and
# runs the whole engine, and the phone on the music stand is a live mirror of it.
# The two need a channel, and this server is the only thing they both already talk to.
#
# It is deliberately the smallest thing that works. http.server cannot do WebSockets
# and this project has no dependencies, so: server-sent events one way (a GET that
# never finishes) and ordinary POSTs the other. That asymmetry is the right shape
# anyway -- the laptop broadcasts a stream of events, the phone sends the occasional
# command.
#
# What crosses the wire is *events*, never frames and never ticks: one state snapshot
# per change, one message per hit or miss, and the phone runs its own clock from the
# snapshot's anchor. A room is a handful of messages a second at worst.
#
# The last snapshot per room is kept so a phone that connects late is up to date
# immediately. Only the snapshot is kept, not a log of the marks -- replaying old
# hits onto a fresh screen would paint colours for playing that has already scrolled
# past. Rooms live in memory and die with the process, which is what "the laptop is
# on and near the piano" already implies.

RELAY_QUEUE = 256          # events buffered per subscriber before it is declared stuck
RELAY_PING = 15.0          # seconds between keep-alive comments

_rooms = {}                # id -> { "subs": [Sub], "state": event or None }
_rooms_lock = threading.Lock()

# ---------------------------------------------------------------- the room id
# The room belongs to the *machine*, not to a browser tab.
#
# It used to be minted in the page and kept in localStorage, which is per origin --
# so the Learn page opened on http://localhost:8765 and the same page on
# http://192.168.1.5:8765 were two different rooms on one server, and clearing the
# site data was a third. The phone's link, and more to the point the phone installed
# on the Home screen with `?room=` frozen into it, then pointed at a room the laptop
# had quietly stopped publishing into: a detached app, still connected, showing a
# lesson that never moves again.
#
# So the server mints it, once, into a file beside the development certificate --
# certs/ is git-ignored, so the id is this laptop's and is never shared -- and every
# origin, every restart and every cleared browser gets the same answer from
# /relay/info. Six characters from an alphabet with no vowels in it, so a room never
# spells anything and can be read aloud off the screen.

ROOM_ABC = "23456789bcdfghjkmnpqrstvwxz"
ROOM_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs", "room")


def _room_id():
    """This machine's room: whatever is in certs/room, else a fresh one written there."""
    try:
        with open(ROOM_FILE) as f:
            rid = f.read().strip()
        if rid and rid.isalnum() and len(rid) <= 32:
            return rid
    except OSError:
        pass
    rid = "".join(secrets.choice(ROOM_ABC) for _ in range(6))
    try:
        os.makedirs(os.path.dirname(ROOM_FILE), exist_ok=True)
        with open(ROOM_FILE, "w") as f:
            f.write(rid + "\n")
    except OSError:
        pass                # a read-only checkout: the id still holds for this run
    return rid


ROOM = _room_id()


class Sub:
    """One subscriber's mailbox. `cid` lets a sender skip its own messages."""

    def __init__(self, cid):
        self.cid = cid
        self.q = queue.Queue(maxsize=RELAY_QUEUE)


def _room(rid):
    with _rooms_lock:
        return _rooms.setdefault(rid, {"subs": [], "state": None})


def _publish(rid, event, sender=None):
    """Fan one event out to a room, and keep it if it is the state snapshot."""
    room = _room(rid)
    line = json.dumps(event, separators=(",", ":"))
    with _rooms_lock:
        if event.get("type") == "state":
            room["state"] = line
        subs = list(room["subs"])
    for s in subs:
        if s.cid and s.cid == sender:
            continue
        try:
            s.q.put_nowait(line)
        except queue.Full:
            pass       # a subscriber that cannot keep up is dropped, not waited for


def _addrs():
    """This machine's own IPv4 addresses, the one the phone should use first.

    The laptop's share panel builds the phone's link from this: the page itself is
    usually open on localhost, and "localhost" on the phone is the phone. Loopback is
    dropped -- an address that cannot leave the laptop is exactly the bug this fixes.

    The default-route address comes first because a laptop can have several (Wi-Fi,
    a docking station, a VM bridge) and only one of them is the network the phone is
    on. Connecting a UDP socket sends nothing; it only asks the routing table which
    interface a packet to the outside world would leave by. The hostname lookup after
    it is the fallback for the odd setup where that answers nothing. Neither may
    raise: a laptop with the Wi-Fi off still has to serve the page.
    """
    out = []

    def add(a):
        if a and a not in out and not a.startswith("127.") and a != "0.0.0.0":
            out.append(a)

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        add(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except OSError:
        pass
    return out


def _send_ca(h):
    """Hand over mkcert's root certificate, shaped so a phone recognises it."""
    try:
        with open(CAFILE, "rb") as f:
            body = f.read()
    except OSError:
        h.send_error(404)
        return
    h.send_response(200)
    # a content type Android's certificate installer and iOS's profile installer
    # both recognise, and a filename, so it lands as rootCA.pem, not "download"
    h.send_header("Content-Type", "application/x-x509-ca-cert")
    h.send_header("Content-Disposition", 'attachment; filename="rootCA.pem"')
    h.send_header("Content-Length", str(len(body)))
    h.end_headers()
    h.wfile.write(body)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
    }

    # ------------------------------------------------------------ helpers
    def _json(self, obj, code=200):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _query(self):
        u = urlsplit(self.path)
        q = parse_qs(u.query)
        return u.path, {k: v[0] for k, v in q.items()}

    # ------------------------------------------------------------ GET
    def do_GET(self):
        path, q = self._query()
        if path == "/relay/time":
            # a monotonic clock, in milliseconds, for the NTP-style round trips in
            # src/learn/sync.js. Both ends measure against this one, so neither has to
            # know anything about the other's performance.now() origin.
            return self._json({"t": time.monotonic() * 1000})
        if path == "/relay/info":
            # who this process is, so the share panel can build a link the phone can
            # reach. It has to be *this* process: rooms live in memory, so a phone
            # sent to some other server on the LAN would join an empty room.
            #
            # `room` is the one both ends pair on. Answering it here is what lets a
            # phone that was installed on the Home screen months ago, with a room
            # frozen into its URL, find the room the laptop is actually in.
            return self._json({"port": PORT, "tls": bool(CERT), "bind": BIND,
                               "addrs": _addrs(), "room": ROOM})
        if path == "/relay/events":
            return self._events(q.get("room", ""), q.get("client", ""))
        if CAFILE and path == "/rootCA.pem":
            return _send_ca(self)
        super().do_GET()

    def _events(self, rid, cid):
        """One subscriber's stream. It never returns until the socket goes away."""
        if not rid:
            return self._json({"error": "room required"}, 400)
        room = _room(rid)
        sub = Sub(cid)
        with _rooms_lock:
            room["subs"].append(sub)
            snapshot = room["state"]
            others = len(room["subs"])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(b'data: {"type":"open"}\n\n')
            if snapshot:
                self.wfile.write(b"data: " + snapshot.encode() + b"\n\n")
            # tell whoever is already here that someone arrived, so the host can send a
            # snapshot with a fresh anchor rather than leaving the newcomer on a stale one
            _publish(rid, {"type": "join", "client": cid, "subs": others}, sender=cid)
            while True:
                try:
                    line = sub.q.get(timeout=RELAY_PING)
                    self.wfile.write(b"data: " + line.encode() + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")     # keeps proxies and phones from hanging up
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass                                        # the page navigated away or the Wi-Fi blinked
        finally:
            with _rooms_lock:
                if sub in room["subs"]:
                    room["subs"].remove(sub)
                left = len(room["subs"])
            _publish(rid, {"type": "leave", "client": cid, "subs": left})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        path, q = self._query()
        if path != "/relay/send":
            return self._json({"error": "not found"}, 404)
        rid = q.get("room", "")
        if not rid:
            return self._json({"error": "room required"}, 400)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            event = json.loads(self.rfile.read(n) or b"null")
        except (ValueError, TypeError):
            return self._json({"error": "bad json"}, 400)
        if not isinstance(event, dict):
            return self._json({"error": "expected an object"}, 400)
        _publish(rid, event, sender=q.get("client") or event.get("from"))
        with _rooms_lock:
            subs = len(_rooms.get(rid, {}).get("subs", []))
        return self._json({"ok": True, "subs": subs})

    def end_headers(self):
        # the pages are edited and reloaded all day; a cached module is a wasted hour
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # the relay is chatty by design: one line per command would bury everything else
        if self.path.startswith("/relay/"):
            return
        super().log_message(fmt, *args)


# ------------------------------------------------------- the certificate window
# Plain HTTP, PORT+1, and it serves two things: the certificate, and a page saying
# what the certificate is for. Everything else is a 404 -- this listener exists to
# solve one chicken-and-egg problem and should not become a second way into the app.

CA_PAGE = """<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Trust this laptop</title>
<style>
 body{{font:16px/1.55 -apple-system,system-ui,sans-serif;margin:0;padding:28px 22px;
      max-width:34em;color:#1b1b1f;background:#fbfbfd}}
 h1{{font-size:1.35rem;margin:0 0 .6em}} h2{{font-size:1rem;margin:1.8em 0 .4em}}
 a.btn{{display:block;text-align:center;background:#2a5bd7;color:#fff;
        text-decoration:none;padding:14px;border-radius:11px;font-weight:600;margin:1.2em 0}}
 ol{{padding-left:1.2em}} li{{margin:.35em 0}}
 p.after{{margin-top:2em;border-top:1px solid #e2e2e8;padding-top:1.2em}}
 code{{background:#ececf2;padding:1px 5px;border-radius:4px}}
</style>
<h1>Trust this laptop</h1>
<p>The app needs HTTPS to reach the piano, and this laptop signs its own certificate.
Install the certificate below once and the phone will stop complaining.
This page is plain HTTP on purpose — the phone cannot download a certificate over a
connection it does not trust yet.</p>
<a class=btn href="/rootCA.pem" download="rootCA.pem">Download rootCA.pem</a>
<h2>iPhone (Safari — Chrome cannot do this)</h2>
<ol><li>Tap <b>Allow</b> when it offers the profile.</li>
<li>Settings → General → <b>VPN &amp; Device Management</b> → mkcert → <b>Install</b>.</li>
<li>Settings → General → About → <b>Certificate Trust Settings</b> → switch mkcert on.</li></ol>
<p>Both steps are needed — the second one is the one everybody forgets.</p>
<h2>Android (Chrome)</h2>
<ol><li>The file lands in Downloads.</li>
<li>Open the <b>Settings app</b>, search <code>certificate</code>, choose
<b>Install a certificate</b> → <b>CA certificate</b> → <b>Install anyway</b>.</li>
<li>Pick <code>rootCA.pem</code> from Downloads.</li></ol>
<p class=after>Then come back to the app:<br>
<a href="{app}">{app}</a></p>
"""


class CAHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/rootCA.pem":
            return _send_ca(self)
        if path == "/":
            host = (self.headers.get("Host") or f"{BIND}:{PORT + 1}").rsplit(":", 1)[0]
            body = CA_PAGE.format(app=f"https://{host}:{PORT}/learn-m.html").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


srv = http.server.ThreadingHTTPServer((BIND, PORT), Handler)
srv.daemon_threads = True
ca_srv = None
if CERT:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    if CAFILE:
        ca_srv = http.server.ThreadingHTTPServer((BIND, PORT + 1), CAHandler)
        ca_srv.daemon_threads = True
        threading.Thread(target=ca_srv.serve_forever, daemon=True).start()
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    srv.server_close()
    if ca_srv:
        ca_srv.shutdown()
        ca_srv.server_close()

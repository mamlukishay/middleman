# Getting Learn onto the music stand

How the phone or tablet becomes the main way to practise. Researched September 2026;
every claim that can move is dated and sourced at the bottom.

The short version: **there is exactly one hard problem, and it is MIDI on iOS.**
Everything else — layout, offline, audio, keeping the screen awake — is ordinary work.

---

## 1. The hard constraint: MIDI on mobile

### iOS and iPadOS: no Web MIDI, and no sign of it

Safari has never shipped the Web MIDI API, on any iOS version through 26.x, and neither
has any other iOS browser — they are all WKWebView underneath, so Chrome for iOS and
Edge for iOS inherit the same gap. The WebKit bug is [107250][wk], open and unassigned
since January 2013; the most recent comments (July 2025) are still users asking. Apple
listed Web MIDI among the APIs it declined to implement on fingerprinting grounds, and
the WebKit feature-status page that used to track it has been retired. **Treat "Web MIDI
arrives on iOS" as something that will not happen inside this project's horizon.**

There is an old App Store app, *Web MIDI Browser*, that wraps a WKWebView and injects a
Web MIDI shim. It was last updated in **March 2016** (v1.0.6, minimum iOS 9). Assume it
no longer runs; do not build on it.

So on iOS, MIDI reaches the piano only through **native CoreMIDI**, which means native
code in the app:

| Transport | How it works on iOS | Notes |
|---|---|---|
| USB | USB-C directly (iPhone 15 and later, recent iPads) or a Lightning/USB-C camera adapter. Class-compliant USB MIDI needs no driver. | Adapters cap bus power around 500 mA; a mains-powered digital piano is fine. |
| BLE MIDI | CoreMIDI has native BLE MIDI. The app presents Apple's own pairing sheet (`CABTMIDICentralViewController`). | Once paired the piano is an ordinary CoreMIDI source and destination. |
| Network MIDI (RTP-MIDI) | CoreMIDI has `MIDINetworkSession`, but iOS ships **no UI to start one** and cannot initiate a session — it needs an external initiator (a Mac's Audio MIDI Setup, or a helper app like NetMIDI / RTP-MIDI). | Only interesting if the laptop is already in the room, in which case the remote view (option D) is simpler. |

### Android: Web MIDI works, with two footnotes

Chrome for Android has shipped Web MIDI since Chrome 43 and it is on by default today
(caniuse lists Chrome Android 151 as supported, September 2026). Under the hood Chrome
uses `android.media.midi`, the platform MIDI stack that has existed since Android 6.0 and
covers USB, BLE and virtual transports.

Two footnotes that matter in practice:

- **Permission.** Since **Chrome 124 (April 2024)** the *whole* API is behind a
  permission prompt, not just SysEx. `navigator.requestMIDIAccess()` now prompts, and
  rejects with `SecurityError` on refusal. `src/midi.js` already catches the rejection
  and reports it, so nothing breaks — but the first load on the phone will ask.
- **BLE MIDI does not just appear.** Android's normal Bluetooth settings pair a BLE MIDI
  device without enabling MIDI on it. The device only becomes a `MidiDevice` after some
  app calls `MidiManager.openBluetoothDevice()` — in practice you run a helper such as
  *MIDI BLE Connect* and leave it in the background, after which Chrome sees the piano
  like any other port. **Over USB OTG there is no such step**: plug the cable in and the
  piano is there.

### Secure context, and why the LAN address bites

Web MIDI needs a secure context. `localhost` qualifies; `http://192.168.1.x:8765` does
**not**. The moment the phone opens the laptop's server over the LAN, Web MIDI, the
Screen Wake Lock API and service workers all go away. Three ways out, in order of how
much they annoy:

1. Serve HTTPS from `serve.sh` with a locally-trusted cert (mkcert), and install the CA
   on the phone. On iOS that is two steps: install the profile, then switch on
   Settings → General → About → Certificate Trust Settings.
2. On Android only, `chrome://flags/#unsafely-treat-insecure-origin-as-secure` accepts a
   comma-separated origin list and works without root — enter `http://192.168.1.x:8765`.
3. Sidestep it: in a Capacitor app the WebView serves from `capacitor://` /
   `https://localhost`, which *is* a secure context. This is one of Capacitor's quieter
   advantages.

`serve.sh` also binds `127.0.0.1` today; a phone needs `--bind 0.0.0.0`.

---

## 2. The options

### a. PWA / mobile web, as-is

Open the existing pages on the phone, add to home screen, add a manifest and a service
worker so it works with the laptop off.

- **Android:** genuinely works. Chrome has Web MIDI; USB OTG to the piano needs no
  helper; an installed PWA (WebAPK) keeps the origin's MIDI permission. This is the
  cheapest complete answer that exists for Android.
- **iOS:** dead on arrival for MIDI. It would still be a fine *silent* practice view —
  score, click, falling notes with no scoring — but the app's whole point is hearing and
  scoring the piano.
- **Audio.** Web Audio needs a user gesture before the first sound. The learn page
  already handles this ("The very first step after a page load waits for you to press
  Start"). On iOS, Web Audio also obeys the hardware silent switch, unlike `<audio>`.
  The piano is the sound source for everything except the click, so the exposure is one
  metronome.
- **Screen and orientation.** Screen Wake Lock is supported everywhere now, including
  Safari 16.4+ (with a bug in installed iOS PWAs that Apple fixed in 18.4). Orientation
  lock is the weak spot: `screen.orientation.lock()` works in Android Chrome in
  fullscreen or installed, but on iOS it has been an experimental flag since 16.4 and
  should be assumed unavailable — the design's "landscape to play, portrait to browse"
  has to be a *response* to rotation, not something the page can enforce.
- **Background.** Backgrounding or locking the phone throttles timers and suspends the
  AudioContext. The metronome is already built for exactly this (drops past beats,
  resumes on the next gesture or on becoming visible). Wake lock plus the music stand
  means it rarely comes up.

### b. Capacitor wrapping the existing pages

Capacitor 8 is current (needs Node 22+, Xcode 26+, Android Studio 2025.2.1+). It puts the
existing HTML/CSS/ES modules in a WebView with no build step required, which fits this
codebase unusually well — there is nothing to bundle.

**Android.** Capacitor uses the system Chrome WebView, and the evidence says Web MIDI is
there: MDN's compat data mirrors Chrome Android for `webview_android`, the
capacitor-community MIDI proposal (issue #24) states flatly that "Web MIDI works out of
the box with Android & Electron", and the one live Capacitor MIDI plugin that supports
iOS ships **no Android code at all**, falling back to the web implementation. Better
still, Capacitor's `BridgeWebChromeClient.onPermissionRequest` grants any resource that
is not camera or microphone outright:

```java
if (!permissionList.isEmpty()) { … } else { request.grant(request.getResources()); }
```

so a MIDI permission arriving through that path is auto-granted with no prompt. **This is
converging evidence, not a first-party guarantee** — WebView has no permission UI of its
own and Chrome 124's non-SysEx gating may take a different path. Budget one hour to
verify on a device before committing; if it fails, an Android plugin over
`android.media.midi` is a day or two.

**iOS.** WKWebView has no Web MIDI, so this needs a native plugin bridging CoreMIDI into
the WebView. Survey of what exists:

| Plugin | Platforms | In | Out | BLE | State |
|---|---|---|---|---|---|
| [`capacitor-musetrainer-midi`][mt] | iOS native (MIKMIDI), Android/web via Web MIDI | yes | yes, with timestamp | via CoreMIDI once paired; no pairing UI | last push **Dec 2023**, Capacitor **4** peer dep, MIT, 15 stars |
| [`@midiative/capacitor-midi-device`][mi] | iOS (CoreMIDI) + Android (`android.media.midi`) | yes | **no** | not addressed | last push **Mar 2025**, Capacitor 7, MIT, 8 stars |
| [`capacitor-midi`][dm] (Dante1349) | Android + web | yes | — | — | **archived Jan 2025**, no iOS ever |
| `cordova-plugin-midi-sender` | Cordova | Program Change only | Program Change only | no | not usable here |

Neither live plugin is a fit. The midiative one is input-only — it opens
`MidiOutputPort` on Android and an input port on iOS, and its API has no send at all — so
the backing track, the app's hands and Guide would all be silent. The musetrainer one is
the closer fit (it has `sendCommand({command, timestamp})` and returns parsed note-on /
note-off / CC), but it is two years stale, pins Capacitor 4, and broadcasts sends to
*every* device rather than a chosen port.

**So plan on writing the plugin.** It is small and the shape is known:

- `list()`, `open(id)`, `onMessage` with a **native timestamp**, `send(bytes, at)`
  honouring a scheduled send time, `panic()`.
- iOS: CoreMIDI directly, or MIKMIDI as musetrainer does. Add
  `CABTMIDICentralViewController` for BLE pairing. ~300–400 lines of Swift.
- Android: only if the WebView Web MIDI check fails.
- A JS shim in front of it so `src/midi.js` keeps its current surface
  (`initMidi`, `onMidi`, `send`, `panic`, `held`) and nothing above it changes.

Estimate: **3–5 days** for the iOS plugin including BLE pairing and scheduled sends,
plus 2–3 more if Android needs one too.

**The rest of the Capacitor picture:**

- **Audio.** WKWebView ignores the hardware silent switch (documented WebKit behaviour,
  and the reason iOS apps set `AVAudioSession` explicitly). In a Capacitor app you own
  the `AVAudioSession` and can set `.playback` in the AppDelegate, so the click plays
  with the ringer off. That is one line of Swift and it is strictly better than Safari.
- **Secure context** comes free, as above.
- **Screen awake and orientation** become native: `UIApplication.isIdleTimerDisabled`
  (or the community keep-awake plugin) and a plain Info.plist orientation setting. This
  is the option where "landscape lock while playing" is actually enforceable on iOS.
- **Getting it onto the device.** For personal use, Xcode's free Personal Team signs the
  app onto Ishay's own iPhone/iPad — but the profile **expires after 7 days** and the app
  stops launching until it is re-signed from Xcode. That is a chore every week. The
  $99/year Apple Developer Program removes it: one-year profiles, and TestFlight for
  installing without a cable. No App Store review is needed for TestFlight internal
  testing, and none at all if he only ever sideloads. Android has no equivalent problem:
  build an APK, copy it over, allow install from the source once, done, no expiry, no fee.

### c. Tauri 2, React Native / Expo, Flutter

None of these change the MIDI picture — on iOS every one of them still needs a
Swift/CoreMIDI layer, because the constraint is Apple's, not the framework's. They only
change how much of the existing code survives.

- **Tauri 2 mobile.** Stable since October 2024 and usable, but mobile is explicitly the
  less mature half of Tauri and not every plugin is ported. The MIDI layer would be Rust
  (`midir`) plus Swift/Kotlin glue — more moving parts than Capacitor's Swift file, for
  the same result. A smaller binary is not worth anything here. **Skip.**
- **React Native / Expo.** Either you keep the app in a `react-native-webview` — in which
  case it is Capacitor with a heavier runtime and a worse story for local file serving —
  or you rewrite five view modules and 4,900 lines of vanilla JS in React. **Skip.**
- **Flutter.** A full rewrite, including re-implementing the abcjs-based staff engraving
  which has no Flutter equivalent. Weeks, not days. **Skip.**

The honest summary: against a plain-JS, no-build codebase whose hardest asset is an SVG
engraving pipeline, Capacitor is the only wrapper that costs near-zero to adopt.

### d. Remote view: the laptop keeps the piano, the phone is the stage

The laptop stays where it is, plugged into the piano over USB, running the engine, the
scorer and the MIDI port exactly as today. The phone opens a page over the LAN and shows
the stage, and its controls act on the laptop.

**The design that makes this fast is not streaming frames.** The phone gets the song, the
loop and the plan up front, plus the clock's anchor (`t0`, `bpm`, `running`) and a
one-time offset estimate from an NTP-style ping over the same channel. It then runs its
own `src/clock.js` and renders the playhead locally at 60 fps. Only *events* cross the
network — a hit, a miss, a wrong note, a pass score, a step change — and those are a
handful per second. Wi-Fi RTT on a home LAN is a few milliseconds, well under one
16.7 ms frame, and it does not accumulate because the phone's clock is anchored, not
driven. **Latency for MIDI is unchanged from today**, because no MIDI crosses the network
at all.

Transport: `python3 -m http.server` has no WebSocket, but it does not need one. Server-
sent events (`text/event-stream`) out of a `ThreadingHTTPServer`, plus ordinary `POST`s
back for commands, is about 60 lines of stdlib Python and no dependency. A WebSocket
(via the `websockets` package) is the alternative if bidirectional turns out to be
cleaner; WebRTC data channels buy nothing on a LAN and cost signalling.

- **Works on any phone, including iOS Safari**, because the phone needs no MIDI.
- **Limitations:** the laptop has to be on and running the page. Pairing is manual — show
  a QR code of `http://<laptop-ip>:8765` on the laptop page. The click can play on either
  end; on the laptop is simpler and puts it next to the piano where it belongs. Without
  HTTPS the phone gets no service worker and no wake lock, so either do the mkcert step
  or accept tapping the screen occasionally.
- It is also the only option where **nothing about the engine changes** — the phone is a
  mirror, and every scoring decision still happens where it happens now.

### e. Hybrid

PWA on Android (option a), Capacitor + plugin on iOS (option b), with the remote view
(option d) as the fallback both platforms share. In practice this is what the phased plan
below is: (d) first because it works everywhere and costs the least, then (a) or (b)
depending on the device.

---

## 3. Latency and timing

The scoring window is generous by design. `src/learn/scorer.js` uses `WINDOW = 0.28`
beats either side of an onset, in *beats*, so in absolute time:

| Tempo | Hit window (±) | Early/late report threshold (±0.08 beats) |
|---|---|---|
| 60 bpm (tutor's slow steps) | 280 ms | 80 ms |
| 96 bpm (*City of Stars*) | 175 ms | 50 ms |
| 120 bpm | 140 ms | 40 ms |

Against that:

- **USB MIDI: ~1–3 ms.** Invisible. This is what he has today.
- **BLE MIDI: ~5–20 ms latency with jitter measured around 11.5 ms** (NIME 2019). It never
  costs a hit — it is a fraction of the window even at 120 bpm — but at 96 bpm it eats a
  fifth to a quarter of the early/late threshold, so the "you are running late" readout
  would tilt. Two mitigations: the BLE MIDI packet format carries millisecond timestamps,
  so a good implementation recovers the true onset; and because the bulk of it is a
  roughly constant offset, a one-number calibration (the same shape as `CLICK_OFFSET_MS`
  in `metronome.js`) removes most of what is left. **Prefer USB where there is a choice.**
- **WebView bridge (Capacitor):** the fix is architectural, not a matter of shaving
  milliseconds. **The plugin must stamp every incoming message natively** and pass the
  stamp up, so the scorer uses the native time and bridge jitter only affects when a key
  lights up. `src/midi.js` already takes `t` on every event and defaults it to
  `performance.now()`, so this is a one-line change at the call site. Symmetrically, the
  plugin's `send` **must accept a scheduled timestamp** the way `MIDIOutput.send(data, at)`
  does, or the backing track and the app's hands will jitter audibly. This is the single
  most important requirement on the plugin and the one existing plugins get wrong.
- **Remote view:** MIDI never leaves the laptop, so nothing changes. The phone's playhead
  is driven by its own anchored clock; network jitter moves event *marks* by a few
  milliseconds, not the playhead.

**Audio and MIDI staying in sync on a phone** is already solved in the codebase and the
solution transfers: `metronome.js` schedules by beat number, maps `AudioContext` time to
`performance.now()` once per round via `getOutputTimestamp()`, adds `outputLatency +
baseLatency`, drops beats already past, and resumes a suspended context on the next
gesture. Phones have larger and more variable output latency than laptops, which is
exactly what `getOutputTimestamp()` is for. The only new work is measuring
`CLICK_OFFSET_MS` per device, since the click-versus-piano offset is a property of the
hardware.

---

## 4. Which device, and in what order

We do not know whether Ishay has an iPhone/iPad or an Android phone. It changes the
destination but not the first step.

**If Android.** Aim at the PWA. Serve over the LAN with the Chrome insecure-origin flag
(or mkcert), plug the piano in over USB OTG, grant MIDI once, add to home screen. Add a
manifest and a service worker and it runs with the laptop off. Capacitor becomes a *nice
to have* — a real icon, enforced landscape, no flag — not a necessity. Skip BLE unless he
wants the cable gone, and if he does, the *MIDI BLE Connect* helper has to stay running.

**If iPhone or iPad.** Standalone means Capacitor plus a CoreMIDI plugin — real work, a
Mac, Xcode 26, and either a weekly re-sign or $99/year. Do the remote view first: it
gets the tablet onto the music stand this month with the code that already exists, and it
is the fallback forever after. USB-C directly on an iPhone 15+ or a recent iPad, camera
adapter otherwise; BLE if he prefers, once the plugin has the pairing sheet.

### Recommended path

**Phase 1 — remote view (5–8 days).** Gets a phone on the stand now, on any device.

| Work | Days |
|---|---|
| SSE + POST relay in `serve.sh`, `--bind 0.0.0.0`, QR pairing, tiny status page | 1 |
| Client mirror: clock anchor + offset estimate, event stream, command send | 1–1.5 |
| `learn-mobile.html` landscape step screen, roll view, meter, keys — the canvas is already drawn | 2–3 |
| Done card / auto-advance layout, path and home screens | 1 |
| Free-practice sheet | 0.5–1 |
| Device testing, wake lock, orientation response | 0.5–1 |

Reused **unchanged**: `song.js`, `clock.js`, `midi.js`, `metronome.js`,
`learn/plan.js`, `learn/scorer.js`, `learn/engine.js`, `learn/meter.js`,
`learn/roll.js`, `learn/fall.js`, all of `songs/`. **New**: the relay (server + client
sync), `learn-mobile.html` and its CSS. **Changed**: `learn/staff.js` gains a
bars-per-system input and "scroll the current system into view" — the one genuinely new
behaviour, and the reason the design canvas puts Staff last.

**Phase 2 — standalone app (2–4 days on Android, 6–10 on iOS).**

| Work | Days |
|---|---|
| Capacitor 8 scaffold over the existing pages (no build step to add) | 0.5 |
| Verify Web MIDI in the Android WebView on a device | 0.1 |
| Android plugin over `android.media.midi`, in **and** out — only if the check fails | 2–3 |
| iOS CoreMIDI plugin: list/open/receive with native stamps/scheduled send/panic/BLE pairing sheet | 3–5 |
| JS shim so `src/midi.js` keeps its surface | 0.5 |
| `AVAudioSession .playback`, idle timer, orientation lock, icons, signing | 1–2 |

Phase 2 keeps every phase-1 screen and deletes the relay dependency; the relay stays
useful anyway, for the laptop-plus-tablet arrangement.

**Phase 3 — offline.** Manifest and service worker (or the Capacitor bundle), so
`songs/` and `vendor/abcjs-basic-min.js` are on the device. Half a day, and it applies to
whichever of the two he ends up on.

---

## 5. Comparison

| Option | iOS | Android | MIDI in | MIDI out | BLE | Offline | Effort | Risk |
|---|---|---|---|---|---|---|---|---|
| **a. PWA / mobile web** | no MIDI at all | yes, Chrome | Web MIDI | Web MIDI | via helper app | yes, service worker | 3–5 d | low on Android, zero value on iOS |
| **b. Capacitor + plugin** | yes, via CoreMIDI plugin | yes (WebView Web MIDI, likely) | plugin / Web MIDI | plugin / Web MIDI | yes, with pairing sheet | yes, bundled | 6–10 d iOS, 2–4 d Android | medium: no off-the-shelf plugin does in **and** out; 7-day signing or $99/yr |
| **c. Tauri 2 / RN / Flutter** | same plugin problem | same | same | same | same | yes | 10 d – weeks | high: more rewrite, no benefit |
| **d. Remote view** | yes, any browser | yes | laptop's USB port | laptop's USB port | n/a | no — needs the laptop | 5–8 d | low; only new code is the relay |
| **e. Hybrid (d → a or b)** | d now, b later | d now, a later | — | — | — | phase 3 | phased | low; this is the recommendation |

---

## Sources

Checked 3 September 2026.

- [Web MIDI API — caniuse][ciu] — Chrome Android 151 supported; Safari iOS 3.2–26.6 not
  supported.
- [MDN browser-compat-data, `Navigator.requestMIDIAccess`][bcd] — `safari: false`,
  `webview_android: mirror` (auto-derived, not independently verified).
- [WebKit bug 107250, "Web MIDI API"][wk] — NEW/unassigned since Jan 2013, latest comment
  Jul 2025.
- [Access to MIDI devices now requires user permission][cp] — Chrome dev blog, updated
  2024-04-16: the whole API behind a prompt from Chrome 124.
- [Give sites permission to MIDI devices in Chrome (Android)][gp] — Google support.
- [`android.media.midi` package][am] and [Android MIDI, source.android.com][as] — USB,
  BLE and virtual transports since Android 6.0.
- [MIDI BLE Connect][bc] / [`MidiBtlePairing`][bp] — BLE MIDI devices only appear after
  `MidiManager.openBluetoothDevice()`; the standard Bluetooth settings pairing is not
  enough.
- [capacitor-community/proposals issue #24, "MIDI"][pr] — 18 June 2020, still open: "Web
  MIDI works out of the box with Android & Electron", iOS does not.
- [`capacitor-musetrainer-midi`][mt] — iOS-only native (MIKMIDI), `@capacitor/core ^4.0.0`,
  last push 2023-12-13.
- [`@midiative/capacitor-midi-device`][mi] — iOS CoreMIDI + Android `MidiManager`, input
  only, last push 2025-03-04.
- [`Dante1349/capacitor-midi`][dm] — archived 2025-01-28, never had iOS.
- [Capacitor `BridgeWebChromeClient.java`][bw] — `onPermissionRequest` grants any non-
  camera/mic resource outright.
- [Capacitor getting started][cg] / [environment setup][ce] — v8, Node 22+, Xcode 26+,
  Android Studio 2025.2.1+.
- [WebKit Features in Safari 16.4][s164] — Screen Wake Lock shipped; Screen Orientation
  lock/unlock behind an experimental flag.
- [Screen Wake Lock API — caniuse][wl] and [web.dev: supported in all browsers][wd] —
  including the installed-PWA bug fixed in iOS 18.4.
- [WebKit bug 167788][wb] and [Apple developer forums: WKWebView ignores
  AVAudioSessionCategory][af] — WKWebView audio and the silent switch.
- ["Practical Considerations for MIDI over Bluetooth Low Energy", NIME 2019][ni] and the
  [BLE-MIDI 1.0 specification][bs] — latency and jitter figures, millisecond timestamps.
- [Signing with a free Personal Team][ft] and [Apple Developer Program][ad] — 7-day
  profiles vs $99/year.
- [Tauri 2.0][t2] — stable Oct 2024, mobile less mature than desktop.
- [RTP-MIDI][rt] — iOS cannot initiate a session; needs an external initiator.

[ciu]: https://caniuse.com/midi
[bcd]: https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json
[wk]: https://bugs.webkit.org/show_bug.cgi?id=107250
[cp]: https://developer.chrome.com/blog/web-midi-permission-prompt
[gp]: https://support.google.com/chrome/answer/14871962
[am]: https://developer.android.com/reference/android/media/midi/package-summary
[as]: https://source.android.com/docs/core/audio/midi
[bc]: https://play.google.com/store/apps/details?id=com.mobileer.example.midibtlepairing
[bp]: https://github.com/philburk/android-midisuite/tree/master/MidiBtlePairing
[pr]: https://github.com/capacitor-community/proposals/issues/24
[mt]: https://github.com/musetrainer/capacitor-musetrainer-midi
[mi]: https://github.com/midiative/capacitor-midi-device
[dm]: https://github.com/Dante1349/capacitor-midi
[bw]: https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java
[cg]: https://capacitorjs.com/docs/getting-started
[ce]: https://capacitorjs.com/docs/getting-started/environment-setup
[s164]: https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
[wl]: https://caniuse.com/wake-lock
[wd]: https://web.dev/blog/screen-wake-lock-supported-in-all-browsers
[wb]: https://bugs.webkit.org/show_bug.cgi?id=167788
[af]: https://developer.apple.com/forums/thread/24464
[ni]: https://www.nime.org/proceedings/2019/nime2019_paper006.pdf
[bs]: https://www.hangar42.nl/wp-content/uploads/2017/10/BLE-MIDI-spec.pdf
[ft]: https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates/
[ad]: https://developer.apple.com/programs/
[t2]: https://v2.tauri.app/
[rt]: https://en.wikipedia.org/wiki/RTP_MIDI

# Implementation checklist

Two lanes, **A: laptop** and **B: phone**. They share no file, so they can land in
either order and will not conflict.

| lane | files |
|---|---|
| A | `index.html`, `looper.html`, `learn.html`, `style.css`, `looper.css`, `learn.css`, `src/learn/host.js`, `src/learn/app.js` |
| B | `learn-m.html`, `learn-m.css`, `src/learn/mobile.js`, `src/learn/phone.js`, `test/wiring.test.mjs` |

---

## Lane A — the laptop

### A1. The nav row (new markup, identical on three pages)

Goes as the **first child of `#side`**, above the `<h2>Backing tracks</h2>` /
`<h2>Songs</h2>` block. Same block on all three, only the `on` class moves:

```html
<nav id="nav" class="seg nav">
  <a href="index.html">Practice</a>
  <a href="looper.html">Looper</a>
  <a href="learn.html" class="on" aria-current="page">Learn</a>
</nav>
```

New ids: `#nav` only. No JS reads it — `href` does the work — so no wiring-test
exposure.

`index.html` needs its `#side` wrapped the way the other two already are: it is a
plain block today, while `looper.css` gives `body.looper #side` `display:flex;
flex-direction:column;gap:16px`. Either add the same flex rule to `#side` in
`style.css` (preferred — one rule, all three pages) or wrap the list in a `<div>`.

### A2. Ids and links removed

| file | remove |
|---|---|
| `index.html` | `#looperlink`, `#learnlink`, `#phonelink` |
| `looper.html` | `#backlink` |
| `learn.html` | `#backlink`, `#backlink2`, `#phonelink` |

None of these ids is referenced from `src/` or `test/` (verified by grep), so nothing
else moves. `#setbox` stays on both `looper.html` and `learn.html` — it still holds the
loop-set controls and the tutor/progress/share block.

### A3. CSS

`style.css` — add, near the existing `.seg` rules:

```css
.seg > a{border:0;border-radius:0;padding:6px 9px;font-size:12px;white-space:nowrap;
  background:#2a2f3a;color:var(--fg);text-decoration:none;
  display:flex;align-items:center;justify-content:center}
.seg > a + a{border-left:1px solid var(--line)}
.seg > a.on{background:var(--accent);color:#14161a;font-weight:600}
.seg > a:hover{background:#333947}
.seg > a.on:hover{background:var(--accent)}
.nav{display:flex;width:100%}
.nav > a{flex:1 1 0}
#side{display:flex;flex-direction:column;gap:16px}
```

and **delete** the `#looperlink` / `#looperlink:hover` rules at the bottom of the file.

`looper.css` — delete `#backlink,#backlink2,#phonelink` and its `:hover` twin
(lines 27–28). Keep `#setbox`'s `margin-top:auto`.

`learn.css` — delete `#backlink2` and `#backlink2:hover` (lines 20–21). Add:

```css
#sharehint{font-size:11px;color:var(--dim);line-height:1.4}
#sharehint b{color:var(--fg);font-weight:700}
```

### A4. The share panel

`learn.html`, inside `#setbox` — keep every existing id (`shareBtn`, `sharebox`,
`shareqr`, `shareurl`, `sharestate`) and add **one**:

```html
<div id="sharehint"></div>   <!-- between #shareqr and #shareurl -->
```

`src/learn/app.js` (~line 672) — add it to the `mountHost` element bag:

```js
{ btn: $('shareBtn'), box: $('sharebox'), qr: $('shareqr'),
  hint: $('sharehint'), url: $('shareurl'), state: $('sharestate') }
```

⚠️ **Wiring test:** `test/wiring.test.mjs` scans `src/learn/app.js` for `$('…')` and
asserts each id exists in `learn.html`. Adding `$('sharehint')` without the `<div>`
fails the test — which is the behaviour we want. No renames in this lane, so nothing
else to declare.

`src/learn/host.js`:

- `mountHost`'s guard (`if (!el || !el.btn || …) return inertHost()`) — add `el.hint`
  to the list, or leave it out and guard the one write with `?.`.
- `paint()` — label:
  `el.btn.textContent = on ? 'On the phone' : 'Put it on the phone'` (drop the `◉`).
- `paint()` — status strings:
  `Phone connected · ${ms} ms` / `Waiting for the phone…` / `Reconnecting…` /
  `Connecting…`.
- `start()` — after drawing the QR, `el.hint.innerHTML = 'Scan it with the phone’s
  camera.<br>Code: <b>' + room + '</b>'` (the room id is already in scope).

`ROOM_KEY` = `middleman.learn.room` and `ON_KEY` = `middleman.learn.hosting` are
unchanged: the laptop still re-arms sharing after a reload, which is what keeps a
mirroring phone alive across an F5.

---

## Lane B — the phone

### B1. `learn-m.html`

**Header of `#home`** — replace the `.phead` block with:

```html
<header class="phead">
  <h1>Learn</h1>
  <span class="grow"></span>
  <button id="leaveBtn" class="leave" hidden>Stop mirroring</button>
</header>
<div id="modeLine" class="pmode">on this phone</div>
```

- `#midiHome` is **removed from the header** and its job moves into `#modeLine`
  (see B3). If you would rather not touch `paintMidi`, keep `id="midiHome"` on the new
  `#modeLine` element instead of adding a second id — but then `#modeLine` and
  `#midiHome` are the same node and only one of the two writers may own it. Pick one;
  the checklist below assumes **`#modeLine` replaces `#midiHome` on Home** and
  `#midiPlay` stays as it is on the playing screen.

**`#connectBtn`** — label `Connect to the laptop`. Id unchanged.

**`#disconnectBtn`** — **deleted**; `#leaveBtn` in the header takes over. (Renaming it
would be the same amount of work and leaves the button in the wrong place.)

**`#remoteNote`** — id kept, text down to one line:
*On an iPhone the piano stays on the laptop. Scan the QR on the laptop's Learn page, or
type the code under it.*

**Removed entirely** — the `Also on this page` block: the `<h2 class="lbl">`, the
`.row2` with `Practice view` and `Looper`, and the `<a class="btn2 wide">← Learn on the
laptop</a>`. None of them carries an id.

**New, first element inside `<body>`** (before `#home`):

```html
<div id="deskbar">This is the phone screen.<a href="learn.html">→ Learn on the laptop</a></div>
```

No JS: it is shown by media query alone (B2).

### B2. `learn-m.css`

```css
#deskbar{display:none}
@media (min-width:900px) and (pointer:fine){
  #deskbar{display:flex;align-items:center;gap:12px;padding:8px 14px;background:#22262f;
    border-bottom:1px solid var(--line);font-size:13px;color:var(--dim);
    position:fixed;left:0;top:0;width:100%;z-index:50}
  #deskbar a{margin-left:auto;color:var(--accent);text-decoration:none;font-weight:600}
  .screen{padding-top:calc(var(--sat) + 37px)}
}
.leave{background:#2a2f3a;border:1px solid var(--line);border-radius:9px;color:var(--fg);
  min-height:38px;padding:0 14px;font-size:13px}
.pmode{font-size:12px;color:var(--dim);padding:0 12px 10px;margin-top:-2px}
.pmode.bad{color:var(--accent)}
.grow{flex:1 1 auto}
```

Note `.mob [hidden]{display:none!important}` already exists, so `#leaveBtn[hidden]`
and `#deskbar` inside it behave.

### B3. `src/learn/mobile.js`

| what | where | change |
|---|---|---|
| leave | ~line 786 | rename the `el.disconnectBtn.onclick` handler to `el.leaveBtn.onclick`; before navigating, call `exitFullscreen()` (already exported from `phone.js`, currently unused) |
| arm the button | ~line 682 | `if (REMOTE) el.leaveBtn.hidden = false;` — replaces the `connectBtn/disconnectBtn` hidden pair. `el.connectBtn.hidden = REMOTE` stays. |
| mode line | ~line 661 `paintConn()` | write to `el.modeLine` instead of looping over `['midiHome','midiPlay']`: `showing the laptop · 4 ms` / `reconnecting…` / `connecting…`. `#midiPlay` keeps the same text it has now. |
| mode line, standalone | ~line 490 `paintMidi` | `el.midiHome` → `el.modeLine`, and the text becomes `on this phone` when a piano is there, the existing error text when it is not (`.bad`). `el.midiPlay` unchanged. |
| full screen | ~line 766 | make `el.fsBtn` a toggle: `isFullscreen() ? exitFullscreen() : await fullscreen()`, then `el.fsBtn.classList.toggle('on', isFullscreen())`. Add `isFullscreen, exitFullscreen` to the `./phone.js` import on line 42. |
| prompt wording | ~line 780 | `prompt('Code from the laptop’s Learn page (under the QR):')` |
| remote note | ~line 684 | shorten the `el.remoteNote.innerHTML` string to match B1 |

`src/learn/phone.js` needs no change — `isFullscreen` and `exitFullscreen` are already
exported.

### B4. localStorage

| key | written by | leave behaviour |
|---|---|---|
| `middleman.learn.remote` | `mobile.js` (`REMOTE_KEY`) | **cleared** by `#leaveBtn`. This is the flag that re-arms mirroring on reload. |
| `middleman.learn.room` | `remote.js` (`ROOM_KEY`) | **kept**. `REMOTE` needs both, so keeping the room is harmless and makes reconnecting one tap. |
| `middleman.learn.hosting` | `host.js` (`ON_KEY`) | laptop-side; untouched by the phone. |
| `middleman.learn.mview` | `mobile.js` (`VIEW_KEY`) | untouched. |
| `middleman.learn.a2hs` | `phone.js` (`HINT_KEY`) | untouched. |

`#leaveBtn` must also drop `?room=` from the URL — `location.href = location.pathname`,
exactly as `disconnectBtn` does today — because `roomFromUrl()` writes the flag back on
the next load.

### B5. ⚠️ The wiring test does not cover `learn-m.html`

`test/wiring.test.mjs` finds ids with `/(?:\$|getElementById)\(['"]([\w-]+)['"]\)/`.
`mobile.js` reaches every element through the `el` Proxy (`el.leaveBtn`), so **not one
of `learn-m.html`'s ids is checked today** — renaming `disconnectBtn` to `leaveBtn`
without touching the HTML would pass `npm test` and break only at the music stand.

Fix it in this lane, one line in `idsWanted`:

```js
const idsWanted = src => new Set([
  ...[...src.matchAll(/(?:\$|getElementById)\(\s*['"]([\w-]+)['"]\s*\)/g)].map(m => m[1]),
  // el.<name> through the Proxy, but not el.<name>?. — the `?.` reaches are the
  // deliberately optional ones
  ...[...src.matchAll(/\bel\.([A-Za-z_$][\w$]*)\b(?!\s*\?\.)/g)].map(m => m[1]),
]);
```

Checked against `main` as it stands: 74 `el.<name>` reaches, all present in
`learn-m.html`, **green** — the negative lookahead is what makes it so. Without it the
one hit is `el.pathFree?.addEventListener(…)` on line 716 of `mobile.js`, which points
at an element that has not existed for a while; delete that line while you are here and
the lookahead stops mattering.

With this in, the `leaveBtn` / `modeLine` renames are caught.

---

## Done when

- `npm test` green, including the widened wiring test.
- All three laptop pages show the same nav row in the same place, current page amber.
- `grep -rn "backlink\|phonelink\|looperlink\|learnlink" .` returns nothing outside
  `design/`.
- The phone's Home says either `on this phone` or `showing the laptop · N ms`, and
  `Stop mirroring` appears only in the second case.
- `⛶` on the playing screen goes in **and** out.
- `learn-m.html` opened at 1440px wide shows the `This is the phone screen` strip.

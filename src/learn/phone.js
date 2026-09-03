// The phone-only plumbing behind learn-m.html: filling the screen, keeping it
// awake, and installing.
//
// Chrome on Android gives back a third of a short screen the moment the address
// bar collapses, and all of it in an installed PWA -- so all four of these matter
// and none of them replaces the others:
//
//   fullscreen()  the Fullscreen API. It only works inside a user gesture, which
//                 is why it is wired to a tap and not to load. Orientation lock
//                 lives in the same gesture, and only succeeds once fullscreen is
//                 actually on -- so it is tried after the request resolves.
//   wake lock     a screen that sleeps mid-loop while your hands are on the piano.
//                 The lock is dropped by the system whenever the tab is hidden, so
//                 it has to be taken again on visibilitychange.
//   the manifest  display: fullscreen, so an installed copy opens with no chrome
//                 at all -- which is the only way to lose it permanently.
//   the hint      because nothing above tells you that installing is an option.

const HINT_KEY = 'middleman.learn.a2hs';

/**
 * Go full screen and lock to landscape. Must be called from inside a user gesture.
 * Everything here is best-effort: a desktop browser, a locked orientation setting or
 * a page already full screen all end up in the same place, so nothing throws outward.
 */
export async function fullscreen(el = document.documentElement) {
  try {
    if (!document.fullscreenElement && el.requestFullscreen)
      await el.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* denied, or not supported */ }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* desktop, or refused */ }
  return !!document.fullscreenElement;
}

export const isFullscreen = () => !!document.fullscreenElement;

/**
 * iPhone Safari has no Fullscreen API at all (iPad's has one), so the ⛶ button has
 * nothing to do there and is hidden rather than left to fail silently. Adding to the
 * Home screen is the iPhone's version of the same thing, and it is permanent.
 */
export const canFullscreen = () => !!document.documentElement.requestFullscreen;

/** iOS, including an iPad reporting itself as a Mac (it is the touch points that tell). */
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function exitFullscreen() {
  try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ }
}

/**
 * A screen wake lock held while the loop runs. `set(true/false)` follows the
 * transport; the lock is re-taken when the tab comes back, because the system
 * revokes it on every hide and never gives it back on its own.
 */
export function makeWakeLock() {
  let want = false, lock = null;

  async function acquire() {
    if (!want || lock || document.visibilityState !== 'visible') return;
    try { lock = await navigator.wakeLock?.request?.('screen') ?? null; }
    catch { lock = null; }                       // low battery, or no support
    lock?.addEventListener?.('release', () => { lock = null; });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });

  return {
    set(on) {
      want = !!on;
      if (want) acquire();
      else { try { lock?.release(); } catch { /* already gone */ } lock = null; }
    },
    get held() { return !!lock; },
  };
}

/**
 * The app shell cache. Registered from this page only -- the desktop pages are
 * opened from a laptop that is serving them anyway, and a stale shell there would
 * be a debugging trap rather than a feature.
 */
export function registerServiceWorker(url = 'sw.js') {
  if (!navigator.serviceWorker) return Promise.resolve(null);
  // a file:// or a plain-http LAN origin is not a secure context; registration
  // rejects there, and the page has to keep working
  return navigator.serviceWorker.register(url).catch(() => null);
}

/**
 * The one-line "Add to Home screen" hint. Chrome fires `beforeinstallprompt` when
 * the app qualifies; we keep the event so the hint's button can install in place.
 * Dismissing it is remembered, and an installed copy never shows it.
 */
export function installHint(el, btn, close) {
  let deferred = null;
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  let dismissed = true;
  try { dismissed = localStorage.getItem(HINT_KEY) === 'off'; } catch { /* private mode */ }

  const hide = () => { el.hidden = true; };
  const show = () => { if (!dismissed && !standalone) el.hidden = false; };

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', hide);
  // Safari never fires beforeinstallprompt and has no way to install from script, so
  // on iOS the hint has to be the instructions themselves, and it has to show itself
  if (isIOS()) {
    const label = el?.querySelector('span');
    if (label) label.textContent = 'Share → Add to Home Screen — it opens full screen, with no browser bar.';
    btn?.remove();
    show();
  }

  close?.addEventListener('click', () => {
    hide();
    try { localStorage.setItem(HINT_KEY, 'off'); } catch { /* private mode */ }
  });
  btn?.addEventListener('click', async () => {
    if (!deferred) return;                       // Chrome only: elsewhere the text stands alone
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    hide();
  });

  return { show, hide };
}

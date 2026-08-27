// WebAudio click. Deliberately not a MIDI note: it stays out of the piano's sound
// and off the MIDI bus, but is scheduled against the same clock as the notes.

let ctx = null;

export function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();       // browsers need a user gesture
  return ctx;
}

/** @param whenPerf  a performance.now() timestamp; mapped to AudioContext time here. */
export function schedClick(whenPerf, accent) {
  const a = audio();
  const when = a.currentTime + Math.max(0, (whenPerf - performance.now()) / 1000);
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1050;
  gain.gain.setValueAtTime(.0001, when);
  gain.gain.exponentialRampToValueAtTime(accent ? .22 : .12, when + .002);
  gain.gain.exponentialRampToValueAtTime(.0001, when + .05);
  osc.connect(gain).connect(a.destination);
  osc.start(when);
  osc.stop(when + .06);
}

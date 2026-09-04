// The guitar page: listen to the amp, say what note is coming out of it.
//
// A proof of concept and nothing else -- there is no tutor, no score and no chord
// here. The whole page is one loop: take the last few thousand samples off an
// AnalyserNode, ask pitch.js what note that is, and draw it.

import { renderKeys, paintKeys } from '../keyboard.js';
import { detect, noteOf, rms } from './pitch.js';

const $ = id => document.getElementById(id);

const FRAME    = 4096;   // 93 ms at 44.1 kHz. 2048 is enough arithmetically, but a low E
                         // only gets two periods into it and the answer flips octaves.
const GATE_DB  = -48;    // below this it is the amp's hiss, not a string
const CLARITY  = 0.55;   // how sure pitch.js has to be before the note goes on screen
const HOLD_MS  = 220;    // a note stays up this long after it stops being heard
const SWITCH_MS = 70;    // ...and a *different* note has to persist this long to take over
const NO_AGC   = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

let ctx = null, analyser = null, source = null, stream = null, buf = null, raf = 0;
let shown = null;                 // what the screen currently says: { midi, name, cents, freq, clarity }
let seenAt = 0;                   // when `shown` was last actually heard
let pending = null, pendingAt = 0;
let db = -Infinity;

const status = s => { $('statusEl').textContent = s; };

// ---------------------------------------------------------------- the inputs

/** Fill the picker. Labels only exist once some microphone permission has been given,
 *  so before Listen this is a list of blanks -- hence the placeholder. */
async function refreshDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  const ins = all.filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications');
  const keep = $('input').value;
  $('input').innerHTML = '<option value="">default input</option>'
    + ins.map((d, i) => `<option value="${d.deviceId}">${d.label || `input ${i + 1}`}</option>`).join('');
  $('input').value = keep;
  return ins;
}

/** The amp, if it is plugged in. Positive Grid calls it "Spark 40 USB". */
const sparkId = ins => ins.find(d => /spark/i.test(d.label))?.deviceId ?? '';

// ---------------------------------------------------------------- the audio

async function open(deviceId) {
  stream?.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    // The three defaults are tuned for a voice on a call and all three wreck a guitar:
    // AGC pumps the decay of every note, noise suppression treats a sustained string as
    // noise and mutes it, and the echo canceller filters whatever the speakers are doing.
    audio: { ...NO_AGC, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  });
  ctx ??= new AudioContext();
  await ctx.resume();
  source?.disconnect();
  source = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = FRAME;
  analyser.smoothingTimeConstant = 0;   // we want the raw samples, not a smeared average
  source.connect(analyser);
  // An analyser only gets rendered if something downstream is pulling it, so it goes to
  // the speakers through a gain of zero: the graph runs, and the guitar is not echoed
  // back into the room half a buffer late.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  analyser.connect(mute).connect(ctx.destination);
  buf = new Float32Array(analyser.fftSize);
}

async function start() {
  try {
    status('asking for the input…');
    // No labels before a grant, so we cannot tell which input is the amp yet: take
    // whatever we are given, read the labels that unlocks, then move to the Spark.
    await open($('input').value || undefined);
    const ins = await refreshDevices();
    if (!$('input').value) {
      const id = sparkId(ins);
      if (id) { $('input').value = id; await open(id); }
    }
    const label = $('input').selectedOptions[0]?.textContent ?? 'input';
    status(`listening to ${label} at ${ctx.sampleRate} Hz`);
    $('startBtn').classList.add('on');
    $('startBtn').textContent = '■ Stop';
    if (!raf) raf = requestAnimationFrame(tick);
  } catch (e) {
    status(`no input: ${e.name} — ${e.message}`);
  }
}

function stop() {
  cancelAnimationFrame(raf); raf = 0;
  stream?.getTracks().forEach(t => t.stop());
  stream = null; analyser = null;
  shown = pending = null; db = -Infinity;
  $('startBtn').classList.remove('on');
  $('startBtn').textContent = '● Listen';
  status('stopped');
  draw();
}

// ---------------------------------------------------------------- the loop

function tick() {
  raf = requestAnimationFrame(tick);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(buf);
  const level = rms(buf);
  db = 20 * Math.log10(level + 1e-9);
  const now = performance.now();

  // Two gates, and they catch different things. The level gate is for a quiet room:
  // there is always *something* periodic in a pickup's hiss and it would otherwise
  // flicker note names at you all evening. The clarity gate is for a struck note that
  // has decayed into the room, or two strings ringing at once -- loud enough, but no
  // longer one pitch.
  let heard = null;
  if (db >= GATE_DB) {
    const r = detect(buf, ctx.sampleRate);
    if (r && r.clarity >= CLARITY) heard = { ...noteOf(r.freq), freq: r.freq, clarity: r.clarity };
  }

  if (heard && shown && heard.midi === shown.midi) {
    // same note, still going: ease the numbers rather than letting them jitter
    shown.cents += (heard.cents - shown.cents) * 0.3;
    shown.freq += (heard.freq - shown.freq) * 0.3;
    shown.clarity = heard.clarity;
    seenAt = now;
    pending = null;
  } else if (heard) {
    // a different note. The first one on screen appears at once -- waiting to be sure
    // would put a visible delay on every attack -- but swapping one note for another
    // waits, because a plucked string's first few frames are all transient.
    if (!pending || pending.midi !== heard.midi) { pending = heard; pendingAt = now; }
    if (!shown || now - pendingAt >= SWITCH_MS) { shown = heard; seenAt = now; pending = null; }
  } else {
    pending = null;
    if (shown && now - seenAt > HOLD_MS) shown = null;
  }
  draw();
}

// ---------------------------------------------------------------- the screen

function draw() {
  const meter = Math.max(0, Math.min(1, (db + 70) / 70));   // -70..0 dB across the trough
  $('levelbarr').style.width = `${meter * 100}%`;
  $('db').textContent = db > -70 ? `${db.toFixed(0)} dB` : '–';

  $('note').textContent = shown ? shown.name : '–';
  $('note').classList.toggle('off', !shown);
  $('freq').textContent = shown ? shown.freq.toFixed(1) : '–';
  $('cents').textContent = shown ? (shown.cents > 0 ? '+' : '') + shown.cents.toFixed(0) : '–';
  $('clarity').textContent = shown ? shown.clarity.toFixed(2) : '–';

  const n = $('needle');
  n.classList.toggle('on', !!shown);
  n.classList.toggle('good', !!shown && Math.abs(shown.cents) < 5);
  if (shown) n.style.left = `${50 + shown.cents}%`;

  paintKeys($('kb'), { scale: null, root: 0, sounding: new Set(), held: new Set(shown ? [shown.midi] : []) });
}

// ---------------------------------------------------------------- boot

renderKeys($('kb'));
$('ticks').innerHTML = Array.from({ length: 11 }, (_, i) =>
  `<i class="${i === 5 ? 'mid' : ''}" style="left:${i * 10}%"></i>`).join('');
$('gate').style.left = `${(GATE_DB + 70) / 70 * 100}%`;
draw();

$('startBtn').onclick = () => (raf ? stop() : start());
$('input').onchange = () => { if (raf) start(); };
refreshDevices();   // shows how many inputs there are, even before the labels arrive

// what the headless check reads
window.__mm = {
  detect, noteOf,
  get last() { return shown && { ...shown }; },
  get db() { return db; },
  get running() { return !!raf && !!analyser; },
  get sampleRate() { return ctx?.sampleRate ?? 0; },
  start, stop,
};

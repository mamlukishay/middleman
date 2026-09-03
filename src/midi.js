// Web MIDI I/O, and the one place that decides where a note goes.
//
// Every page schedules notes by calling send() with a performance.now() timestamp, so
// the choice between the piano and the laptop's speakers belongs here rather than in
// three transports. send() parses the message it was already given -- note on/off and
// CC64 -- and hands it to the MIDI port, to the software piano (src/synth.js), or to
// both, with the same timestamp either way.
//
// send() is also the one place that can say what the app is playing, so remote mode
// listens on it (onSend) to play the same notes out of the phone -- and mutes the
// speakers here (setSynthMuted) while the phone has them.
//
// Being that one door makes it the right place for the volume too: every note the app
// plays is scaled by the level here, on both routes, and the pianist's own notes come
// in through receive() and never touch it. What goes out to onSend listeners is the
// *unscaled* note, because the machine at the other end plays it on a speaker of its
// own and applies its own level -- see playOn().
//
// The default is the piano when one is plugged in and the computer when there is not,
// so the app makes a sound out of the box; the user's own choice is remembered in
// localStorage and wins, except that "piano" with no piano falls back to audio.

import { synth } from './synth.js';
import { scaleVelocity } from './volume.js';

export const held = new Set();     // MIDI notes currently held down on the piano
let output = null;
const listeners = new Set();

export const getOutput = () => output;

// ---------------------------------------------------------------- output routing
const STORE_KEY = 'middleman.out';
const MODES = ['midi', 'audio', 'both'];

let pref = read();                 // the user's choice, or null for "decide for me"
// 'midi' until initMidi has looked: with no port that route is silent, which is the
// right thing to do before the page knows whether there is a piano to play to
let mode = 'midi';                 // what send() actually does right now
let synthImpl = null;              // created on first audible note; swappable for tests
let muted = false;                 // the speakers here are off; someone else has them
let inputCount = 0, statusCb = null, statusErr = null;
const modeListeners = new Set();
const sendListeners = new Set();

function read() {
  try { const v = localStorage.getItem(STORE_KEY); return MODES.includes(v) ? v : null; }
  catch { return null; }           // no storage (a test, a locked-down browser)
}

export const getOutputMode = () => mode;
export const hasMidiOutput = () => !!output;

/** @param fn  called with the mode whenever it changes, or a port appears. @returns unsubscribe. */
export function onOutputChange(fn) {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

export function setOutputMode(m) {
  if (!MODES.includes(m)) return;
  pref = m;
  try { localStorage.setItem(STORE_KEY, m); } catch { /* fine, just not remembered */ }
  applyMode();
}

/** Swap the sound source. The tests pass a recorder; nothing else should call it. */
export function setSynth(s) { synthImpl = s; }

/**
 * Everything send() handles, whatever the mode -- the tap remote mode listens on so a
 * phone mirroring this page can play the same notes out of its own speaker.
 * @returns unsubscribe.
 */
export function onSend(fn) { sendListeners.add(fn); return () => sendListeners.delete(fn); }

/**
 * Silence this machine's speakers without changing the route: in remote mode the
 * phone is playing the same notes a room away, and two speakers a beat apart is
 * worse than either alone. The port is untouched -- muting is about the audio route.
 */
export function setSynthMuted(m) {
  if (!!m === muted) return;
  muted = !!m;
  if (muted) synthImpl?.allOff();  // whatever is ringing here has to stop now
  notify();                        // "Out: Computer" is a lie while this is on
}
export const isSynthMuted = () => muted;

// built on the first audible note, not before: an AudioContext made without a user
// gesture starts suspended, and a page routing to the piano never needs one at all
const getSynth = () => (synthImpl ||= synth());

function applyMode() {
  const want = pref || (output ? 'midi' : 'audio');
  const next = want === 'midi' && !output ? 'audio' : want;
  if (next === mode) { notify(); return; }
  panic();                         // nothing may hang on the route we are leaving
  mode = next;
  notify();
}

function notify() {
  statusCb?.(statusText());
  for (const fn of modeListeners) fn(mode);
}

/** The status line says where the notes are going, and why if it was not our choice. */
function statusText() {
  const there = output ? output.name : 'no piano found';
  // an error already says why there is no piano, so it does not need saying twice
  const speakers = muted ? 'the phone' : 'computer audio';
  const route = mode === 'audio' ? (output || statusErr || muted ? speakers : 'computer audio (no piano found)')
              : mode === 'both' ? `${there} + ${muted ? 'the phone' : 'computer'}`
              : there;
  return statusErr ? `out: ${route} · ${statusErr}` : `out: ${route} · in: ${inputCount}`;
}

/**
 * Raw input events, for anything that needs timing rather than just "what is down".
 * `t` is a DOMHighResTimeStamp on the same origin as performance.now(), taken by the
 * MIDI subsystem -- so it is free of the jitter a setInterval would add.
 * @param fn  called with { on, n, v, t } for notes, { cc, v, t } for controllers.
 * @returns an unsubscribe function.
 */
export function onMidi(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** @param onNote  called after `held` changes, so the UI can repaint. */
let noteCb = null;

/** One incoming message, from a port or injected -- updates `held` and fans out. */
export function receive(data, t = performance.now()) {
  const [s, n, v] = data, kind = s & 0xf0;
  let ev;
  if (kind === 0x90 && v > 0) { held.add(n); ev = { on: 1, n, v, t }; }
  else if (kind === 0x80 || (kind === 0x90 && v === 0)) { held.delete(n); ev = { on: 0, n, v: 0, t }; }
  else if (kind === 0xb0) { ev = { cc: n, v, t }; }   // pedals; no note state to change
  else return;                                        // ignore pitch bend, clock
  for (const fn of listeners) fn(ev);
  if (ev.cc === undefined) noteCb?.();
}

export async function initMidi({ onNote, onStatus }) {
  noteCb = onNote;
  statusCb = onStatus;
  try {
    const access = await navigator.requestMIDIAccess();
    output = [...access.outputs.values()][0] || null;
    const inputs = [...access.inputs.values()];
    inputCount = inputs.length;
    inputs.forEach(i => i.onmidimessage = e => receive(e.data, e.timeStamp || performance.now()));
    applyMode();                 // a port (or the lack of one) decides the default
    return true;
  } catch (e) {
    statusErr = 'MIDI blocked: ' + e.message;
    applyMode();                 // no port: the computer takes over
    return false;
  }
}

/**
 * This machine's volume applied to one message: a note-on's velocity and nothing
 * else. A note-off, a pedal or a panic carries no loudness to turn down, and 0x90
 * with velocity 0 is a note-off spelled the other way.
 */
const atVolume = data =>
  ((data[0] & 0xf0) === 0x90 && data[2] > 0 ? [data[0], data[1], scaleVelocity(data[2])] : data);

/**
 * Schedule one message. `timestamp` is a performance.now() in the near future; the
 * synth gets the very same one, mapped onto audio time, so switching route does not
 * move a note. Anything but note on/off and CC64 is for the port alone.
 *
 * The volume is applied once, here, to what this machine plays -- the port reads
 * velocity and so does the synth, so both routes take it. Listeners get the note as
 * it was written: a phone mirroring this page has a level of its own.
 */
export function send(data, timestamp) {
  const out = atVolume(data);
  if ((mode === 'midi' || mode === 'both') && output) output.send(out, timestamp);
  if ((mode === 'audio' || mode === 'both') && !muted) toSynth(out, timestamp);
  for (const fn of sendListeners) fn(data, timestamp);
}

// already scaled by send(); onto the synth exactly as it stands
const toSynth = (data, timestamp) => strike(getSynth(), data, timestamp);

/** Is there anything a synth could do with this message? The rest is the port's. */
export function audible(data) {
  const kind = data[0] & 0xf0;
  return kind === 0x90 || kind === 0x80 || (kind === 0xb0 && [64, 120, 123].includes(data[1]));
}

/**
 * One message onto one synth. Exported because the phone's mirror plays the laptop's
 * notes on a synth of its own and has to split them in exactly the same way -- and
 * because the level belongs to the machine that makes the sound, this applies *this*
 * device's volume. In mirror mode that means the phone turns down what it plays and
 * the laptop what it plays, each by its own slider, which is what you want when the
 * two are in different rooms. send()'s own synth route does not come through here.
 */
export function playOn(piano, data, timestamp) {
  strike(piano, atVolume(data), timestamp);
}

function strike(piano, data, timestamp) {
  const [s, n, v] = data, kind = s & 0xf0;
  if (kind === 0x90 && v > 0) piano.noteOn(n, v, timestamp);
  else if (kind === 0x80 || (kind === 0x90 && v === 0)) piano.noteOff(n, timestamp);
  else if (kind === 0xb0) {
    if (n === 64) piano.setPedal(v >= 64, timestamp);
    else if (n === 120 || n === 123) piano.allOff(timestamp);
  }
}

/**
 * All notes off, on both routes whatever the mode is: the point of panic is that
 * nothing is left hanging, including on a route that was just switched away from.
 */
export function panic() {
  if (output) { output.send([0xb0, 123, 0]); output.send([0xb0, 120, 0]); }
  synthImpl?.allOff();
}

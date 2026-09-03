// The phone's speaker: the tap on midi.js that carries the app's notes to a mirror,
// the filter of what is worth carrying, and who owns the speakers while it does.
//
// The routing itself is tested in midi.test.mjs; what matters here is that the tap
// sees *everything* whatever the route is (a phone mirroring a laptop set to the
// piano still has to be told when the mode changes back), that muting takes the
// speakers here without touching the port, and that a laptop nobody is mirroring is
// never silenced.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance = { now: () => 1000, timeOrigin: 0 };
globalThis.document = { hidden: false };

const port = { name: 'Fake Piano', sent: [], send(d, t) { port.sent.push({ d, t }); } };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { requestMIDIAccess: async () => ({ outputs: new Map([[1, port]]), inputs: new Map() }) },
});

const midi = await import('../src/midi.js');
const { soundOnPhone } = await import('../src/learn/host.js');

/** A synth that records what it was asked to do, in place of the WebAudio one. */
const recorder = () => ({
  ev: [],
  noteOn(n, v, t) { this.ev.push(['on', n, v, t]); },
  noteOff(n, t) { this.ev.push(['off', n, t]); },
  setPedal(d, t) { this.ev.push(['pedal', d, t]); },
  allOff(t) { this.ev.push(['allOff', t]); },
});
const synth = recorder();
midi.setSynth(synth);
let status = '';
await midi.initMidi({ onStatus: s => status = s, onNote() {} });

const tap = [];
midi.onSend((data, t) => tap.push([[...data], t]));

function reset() { port.sent.length = 0; synth.ev.length = 0; tap.length = 0; }

// ---------------------------------------------------------------- the tap
test('every message send() handles reaches the tap, whatever the route is', () => {
  for (const mode of ['midi', 'audio', 'both']) {
    midi.setOutputMode(mode);
    reset();
    midi.send([0x90, 60, 90], 1200);
    midi.send([0x80, 60, 0], 1700);
    assert.deepEqual(tap, [[[0x90, 60, 90], 1200], [[0x80, 60, 0], 1700]], `mode ${mode}`);
  }
});

test('unsubscribing stops it', () => {
  const seen = [];
  const off = midi.onSend(d => seen.push(d[1]));
  midi.send([0x90, 62, 90], 1200);
  off();
  midi.send([0x90, 64, 90], 1200);
  assert.deepEqual(seen, [62]);
});

// ---------------------------------------------------------------- muting
test('muted, the speakers here get nothing -- the port and the tap still do', () => {
  midi.setOutputMode('both');
  midi.setSynthMuted(true);
  reset();
  midi.send([0x90, 67, 90], 1300);
  assert.deepEqual(synth.ev, []);
  assert.equal(port.sent.length, 1);
  assert.equal(tap.length, 1);
  assert.equal(midi.isSynthMuted(), true);
});

test('muting lets go of whatever was ringing, and says so on the status line', () => {
  midi.setOutputMode('audio');
  midi.setSynthMuted(false);
  reset();
  midi.send([0x90, 60, 90], 1200);
  assert.equal(synth.ev.length, 1);
  midi.setSynthMuted(true);
  assert.ok(synth.ev.some(e => e[0] === 'allOff'), 'the synth was left ringing');
  assert.match(status, /the phone/);
  midi.setSynthMuted(false);
  assert.match(status, /computer audio/);
});

test('unmuting is heard again', () => {
  midi.setOutputMode('audio');
  reset();
  midi.send([0x90, 60, 90], 1200);
  assert.equal(synth.ev.length, 1);
});

// ---------------------------------------------------------------- the filter
test('only what a synth can play is worth sending to the phone', () => {
  assert.equal(midi.audible([0x90, 60, 90]), true);
  assert.equal(midi.audible([0x80, 60, 0]), true);
  assert.equal(midi.audible([0xb0, 64, 127]), true);      // the pedal
  assert.equal(midi.audible([0xb0, 120, 0]), true);       // all sound off
  assert.equal(midi.audible([0xb0, 123, 0]), true);       // all notes off
  assert.equal(midi.audible([0xb0, 7, 100]), false);      // volume: the port's business
  assert.equal(midi.audible([0xe0, 0, 64]), false);       // pitch bend
});

test('a message is split onto a far-away synth exactly as onto the near one', () => {
  const there = recorder();
  midi.playOn(there, [0x90, 60, 90], 5);
  midi.playOn(there, [0x90, 60, 0], 6);                   // velocity 0 is a note-off
  midi.playOn(there, [0x80, 62, 0], 7);
  midi.playOn(there, [0xb0, 64, 127], 8);
  midi.playOn(there, [0xb0, 64, 0], 9);
  midi.playOn(there, [0xb0, 123, 0], 10);
  midi.playOn(there, [0xb0, 7, 100], 11);
  assert.deepEqual(there.ev, [
    ['on', 60, 90, 5], ['off', 60, 6], ['off', 62, 7],
    ['pedal', true, 8], ['pedal', false, 9], ['allOff', 10],
  ]);
});

// ---------------------------------------------------------------- who has the sound
test('the phone has the speakers only when it is there and the app is playing audio', () => {
  assert.equal(soundOnPhone(true, 1, 'audio'), true);
  assert.equal(soundOnPhone(true, 0, 'audio'), false);    // sharing, but no phone yet
  assert.equal(soundOnPhone(false, 1, 'audio'), false);   // not sharing at all
  assert.equal(soundOnPhone(true, 1, 'midi'), false);     // the piano is making the sound
  assert.equal(soundOnPhone(true, 2, 'both'), false);     // half of it is the piano's
});

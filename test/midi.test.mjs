// Output routing: which of the piano and the software piano a scheduled message
// reaches, and that the timestamp is the same one either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance = { now: () => 1000, timeOrigin: 0 };
globalThis.document = { hidden: false };

const port = { name: 'Fake Piano', sent: [], send(d, t) { port.sent.push({ d, t }); } };
// node's own `navigator` is a getter-only global, so it has to be redefined
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { requestMIDIAccess: async () => ({ outputs: new Map([[1, port]]), inputs: new Map() }) },
});

const midi = await import('../src/midi.js');
const { setVolume, scaleVelocity } = await import('../src/volume.js');

/** A synth that records what it was asked to do, in place of the WebAudio one. */
const synth = {
  ev: [],
  noteOn(n, v, t) { this.ev.push(['on', n, v, t]); },
  noteOff(n, t) { this.ev.push(['off', n, t]); },
  setPedal(d, t) { this.ev.push(['pedal', d, t]); },
  allOff(t) { this.ev.push(['allOff', t]); },
};
midi.setSynth(synth);

let status = '';
await midi.initMidi({ onStatus: s => status = s, onNote() {} });

function reset() { port.sent.length = 0; synth.ev.length = 0; }

test('with a port present the default is the piano', () => {
  assert.equal(midi.hasMidiOutput(), true);
  assert.equal(midi.getOutputMode(), 'midi');
  assert.match(status, /out: Fake Piano/);
});

test('mode midi: the port gets it, the synth does not', () => {
  midi.setOutputMode('midi');
  reset();                       // a mode change panics both routes; start clean
  midi.send([0x90, 60, 100], 1200);
  assert.equal(port.sent.length, 1);
  assert.deepEqual(port.sent[0], { d: [0x90, 60, 100], t: 1200 });
  assert.equal(synth.ev.length, 0);
});

test('mode audio: the synth gets it, the port does not, with the same timestamp', () => {
  midi.setOutputMode('audio');
  reset();
  midi.send([0x90, 64, 77], 1200);
  midi.send([0x80, 64, 0], 1700);
  assert.equal(port.sent.length, 0);
  assert.deepEqual(synth.ev, [['on', 64, 77, 1200], ['off', 64, 1700]]);
  assert.equal(midi.getOutputMode(), 'audio');
  assert.match(status, /out: computer audio/);
});

test('a note-on with velocity 0 is a note-off, as on the wire', () => {
  midi.setOutputMode('audio');
  reset();
  midi.send([0x90, 60, 0], 1200);
  assert.deepEqual(synth.ev, [['off', 60, 1200]]);
});

test('mode both: the note reaches the piano and the speakers', () => {
  midi.setOutputMode('both');
  reset();
  midi.send([0x90, 67, 90], 1300);
  assert.equal(port.sent.length, 1);
  assert.deepEqual(synth.ev, [['on', 67, 90, 1300]]);
  assert.match(status, /Fake Piano \+ computer/);
});

test('CC64 sets the pedal; other controllers are for the port alone', () => {
  midi.setOutputMode('audio');
  reset();
  midi.send([0xb0, 64, 127], 1400);
  midi.send([0xb0, 64, 0], 1500);
  midi.send([0xb0, 7, 100], 1600);          // volume: nothing the synth can do
  assert.deepEqual(synth.ev, [['pedal', true, 1400], ['pedal', false, 1500]]);
});

test('panic silences both routes whatever the mode is', () => {
  midi.setOutputMode('audio');
  reset();
  midi.panic();
  assert.deepEqual(port.sent.map(s => s.d), [[0xb0, 123, 0], [0xb0, 120, 0]]);
  assert.deepEqual(synth.ev, [['allOff', undefined]]);
});

test('a mode change lets go of whatever the old route was holding', () => {
  reset();
  midi.setOutputMode('audio');
  midi.send([0x90, 60, 100], 1200);
  reset();
  midi.setOutputMode('midi');
  assert.ok(synth.ev.some(e => e[0] === 'allOff'), 'the synth was left ringing');
  assert.equal(midi.getOutputMode(), 'midi');
});

test('the mode listener fires on every change', () => {
  const seen = [];
  const off = midi.onOutputChange(m => seen.push(m));
  midi.setOutputMode('audio');
  midi.setOutputMode('midi');
  off();
  midi.setOutputMode('audio');
  assert.deepEqual(seen, ['audio', 'midi']);
});

// ------------------------------------------------------------------ the volume
// send() is the one door everything the app plays goes through, so it is where the
// level is applied -- to both routes, since the port and the synth both read velocity.
test('the level turns down a note-on on the port and on the synth alike', () => {
  midi.setOutputMode('both');
  reset();
  setVolume(0.3);
  try {
    midi.send([0x90, 60, 100], 1200);
    assert.deepEqual(port.sent[0].d, [0x90, 60, 30]);
    assert.deepEqual(synth.ev, [['on', 60, 30, 1200]]);
  } finally { setVolume(1); }
});

test('only a note-on carries loudness: offs, pedals and panics go out untouched', () => {
  midi.setOutputMode('both');
  reset();
  setVolume(0.3);
  try {
    midi.send([0x80, 60, 64], 1200);          // a note-off's velocity is not loudness
    midi.send([0x90, 62, 0], 1250);           // the other spelling of a note-off
    midi.send([0xb0, 64, 127], 1300);         // the pedal is down or it is not
    assert.deepEqual(port.sent.map(x => x.d),
      [[0x80, 60, 64], [0x90, 62, 0], [0xb0, 64, 127]]);
    assert.deepEqual(synth.ev,
      [['off', 60, 1200], ['off', 62, 1250], ['pedal', true, 1300]]);
  } finally { setVolume(1); }
});

test('the tap sees the note unscaled: a phone mirroring this has a level of its own', () => {
  midi.setOutputMode('audio');
  reset();
  const seen = [];
  const off = midi.onSend(d => seen.push([...d]));
  setVolume(0.3);
  try { midi.send([0x90, 60, 100], 1200); } finally { setVolume(1); off(); }
  assert.deepEqual(seen, [[0x90, 60, 100]], 'as written');
  assert.deepEqual(synth.ev, [['on', 60, 30, 1200]], 'while this machine played it quietly');
});

test('playOn applies this device the level, which is how the phone turns itself down', () => {
  const phone = { ev: [], noteOn(n, v, t) { this.ev.push(['on', n, v, t]); },
    noteOff() {}, setPedal() {}, allOff() {} };
  setVolume(0.5);
  try { midi.playOn(phone, [0x90, 72, 80], 900); } finally { setVolume(1); }
  assert.deepEqual(phone.ev, [['on', 72, scaleVelocity(80, 0.5), 900]]);
});

// The whole point of the setting: it is the app against you, so your own playing has
// to be untouchable. It reaches the piano by wire and reaches the page through
// receive(), which fans out to listeners and never calls send() -- so nothing on the
// way in can be scaled, whatever the level is.
test('the pianist\'s own notes never pass through send(), so nothing scales them', () => {
  midi.setOutputMode('both');
  reset();
  setVolume(0.1);
  const heard = [];
  const off = midi.onMidi(e => heard.push(e));
  const tapped = [];
  const offSend = midi.onSend(d => tapped.push([...d]));
  try {
    midi.receive([0x90, 60, 100], 500);
    midi.receive([0x80, 60, 0], 900);
  } finally { off(); offSend(); setVolume(1); }
  assert.deepEqual(heard, [{ on: 1, n: 60, v: 100, t: 500 }, { on: 0, n: 60, v: 0, t: 900 }],
    'the velocity you played is the velocity the page sees');
  assert.deepEqual(tapped, [], 'and it never went out through send() at all');
  assert.equal(port.sent.length, 0);
  assert.equal(synth.ev.length, 0, 'nothing was played back at you');
});

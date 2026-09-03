// The app's volume: what a velocity becomes at a level, and that the level is
// remembered. src/volume.js reads storage at import time, so the fake has to be in
// place before the module is loaded -- hence the dynamic import. The fake starts with
// only the old key, which is also how the migration gets tested.

import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map([['middleman.backing.volume', '0.4']]);
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const {
  scaleVelocity, getVolume, setVolume, onVolumeChange,
} = await import('../src/volume.js');

test('full level leaves the played velocity exactly as it was', () => {
  assert.equal(scaleVelocity(100, 1), 100);
  assert.equal(scaleVelocity(1, 1), 1);
  assert.equal(scaleVelocity(127, 1), 127);
});

test('a level scales the velocity, rounded to a whole MIDI value', () => {
  assert.equal(scaleVelocity(100, 0.3), 30);
  assert.equal(scaleVelocity(100, 0.5), 50);
  assert.equal(scaleVelocity(81, 0.5), 41);       // 40.5 rounds up, not to a fraction
});

test('off is off, but a soft note is never rounded away to silence', () => {
  assert.equal(scaleVelocity(100, 0), 0);
  assert.equal(scaleVelocity(1, 0.01), 1, 'still audible, just very quiet');
  assert.equal(scaleVelocity(20, 0.001), 1);
});

test('a level out of range is clamped rather than trusted', () => {
  assert.equal(scaleVelocity(100, 2), 100, 'above 1 cannot make it louder than played');
  assert.equal(scaleVelocity(100, -1), 0);
  assert.equal(scaleVelocity(100, NaN), 100, 'a broken value falls back to full');
});

test('a level stored under the old backing name is carried over, not lost', () => {
  assert.equal(getVolume(), 0.4, 'read at import from what the old version wrote');
  assert.equal(store.get('middleman.volume'), '0.4', 'and written under the new name');
  assert.equal(store.has('middleman.backing.volume'), false, 'the old one is gone');
});

test('the level comes back from storage, and set writes it there', () => {
  assert.equal(scaleVelocity(100), 40, 'the default level is the remembered one');
  setVolume(0.25);
  assert.equal(getVolume(), 0.25);
  assert.equal(store.get('middleman.volume'), '0.25');
  assert.equal(scaleVelocity(100), 25);
});

test('listeners hear the change, and stop hearing it once unsubscribed', () => {
  const seen = [];
  const off = onVolumeChange(l => seen.push(l));
  setVolume(0.75);
  setVolume(1.5);                   // clamped on the way in
  off();
  setVolume(0.1);
  assert.deepEqual(seen, [0.75, 1]);
  setVolume(1);                     // leave it full for anything that follows
});

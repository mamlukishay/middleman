// Web MIDI I/O. Requires a secure context -- localhost qualifies, file:// does not.

export const held = new Set();     // MIDI notes currently held down on the piano
let output = null;
const listeners = new Set();

export const getOutput = () => output;

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
export async function initMidi({ onNote, onStatus }) {
  try {
    const access = await navigator.requestMIDIAccess();
    output = [...access.outputs.values()][0] || null;
    const inputs = [...access.inputs.values()];
    inputs.forEach(i => i.onmidimessage = e => {
      const [s, n, v] = e.data, kind = s & 0xf0;
      const t = e.timeStamp || performance.now();
      let ev;
      if (kind === 0x90 && v > 0) { held.add(n); ev = { on: 1, n, v, t }; }
      else if (kind === 0x80 || (kind === 0x90 && v === 0)) { held.delete(n); ev = { on: 0, n, v: 0, t }; }
      else if (kind === 0xb0) { ev = { cc: n, v, t }; }   // pedals; no note state to change
      else return;                                        // ignore pitch bend, clock
      for (const fn of listeners) fn(ev);
      if (ev.cc === undefined) onNote?.();
    });
    onStatus(output ? `out: ${output.name} · in: ${inputs.length}`
                    : 'no MIDI output found');
    return true;
  } catch (e) {
    onStatus('MIDI blocked: ' + e.message);
    return false;
  }
}

export function send(data, timestamp) {
  if (output) output.send(data, timestamp);
}

/** All notes off on every channel -- used on stop so nothing can hang. */
export function panic() {
  if (!output) return;
  output.send([0xb0, 123, 0]);
  output.send([0xb0, 120, 0]);
}

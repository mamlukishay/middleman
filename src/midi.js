// Web MIDI I/O. Requires a secure context -- localhost qualifies, file:// does not.

export const held = new Set();     // MIDI notes currently held down on the piano
let output = null;

export const getOutput = () => output;

/** @param onNote  called after `held` changes, so the UI can repaint. */
export async function initMidi({ onNote, onStatus }) {
  try {
    const access = await navigator.requestMIDIAccess();
    output = [...access.outputs.values()][0] || null;
    const inputs = [...access.inputs.values()];
    inputs.forEach(i => i.onmidimessage = e => {
      const [s, n, v] = e.data, kind = s & 0xf0;
      if (kind === 0x90 && v > 0) held.add(n);
      else if (kind === 0x80 || (kind === 0x90 && v === 0)) held.delete(n);
      else return;                                   // ignore CC, pitch bend, clock
      onNote();
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

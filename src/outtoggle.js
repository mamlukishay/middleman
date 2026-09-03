// The "Out: Piano | Computer" control, one implementation for all three transports.
//
// It only reflects and sets the mode -- midi.js owns the decision, the fallback when
// no piano is there, and the remembering. Clicking is also the gesture the browser
// wants before an AudioContext will make a sound, so the click wakes it.

import { getOutputMode, setOutputMode, hasMidiOutput, onOutputChange, isSynthMuted } from './midi.js';
import { audio } from './metronome.js';

const TIPS = {
  midi: 'Notes go to the piano over MIDI',
  audio: "Notes play through the computer's speakers — for checking the app without a piano",
  phone: 'Notes play through the phone that is mirroring this page, not through this computer',
  none: 'No MIDI output found, so there is no piano to send to',
};

/**
 * @param host  the element to build the control inside.
 * @param opts.tip  'title' (the practice view) or 'data-tip' (the pages with tooltips).
 */
export function mountOutToggle(host, { tip = 'title' } = {}) {
  if (!host) return;
  host.className = 'seg';
  host.innerHTML = '<b>Out:</b>'
    + '<button data-out="midi">Piano</button>'
    + '<button data-out="audio">Computer</button>';
  const btn = m => host.querySelector(`[data-out="${m}"]`);

  function sync() {
    const mode = getOutputMode(), has = hasMidiOutput();
    // 'both' lights both halves; there is no button for it, only the console
    btn('midi').classList.toggle('on', mode === 'midi' || mode === 'both');
    btn('audio').classList.toggle('on', mode === 'audio' || mode === 'both');
    btn('midi').disabled = !has;
    btn('midi').setAttribute(tip, has ? TIPS.midi : TIPS.none);
    // while a phone is mirroring this page it is the one making the sound, and the
    // speakers here are muted -- so the half that is lit has to name the right speaker
    const onPhone = isSynthMuted();
    btn('audio').textContent = onPhone ? 'Phone' : 'Computer';
    btn('audio').setAttribute(tip, onPhone ? TIPS.phone : TIPS.audio);
  }

  host.onclick = e => {
    const b = e.target.closest('[data-out]');
    if (!b || b.disabled) return;
    audio();                     // the click is the gesture the audio context needs
    setOutputMode(b.dataset.out);
    sync();
  };
  onOutputChange(sync);
  sync();
  return sync;
}

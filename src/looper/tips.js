// Tooltips for the small controls. One element on <body>, positioned against whatever
// the pointer is resting on, so no scroll container -- and there are several here --
// can clip it.
//
// They wait, because a tooltip that appears the instant you cross a button is noise
// while you are working; and they go away on a keypress, because the shortcuts are
// the point and a label hanging over the lanes would be in the way.

const DELAY = 500;

export function initTips(root = document) {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);

  let timer = null, cur = null;

  function hide() {
    clearTimeout(timer);
    timer = null;
    cur = null;
    tip.hidden = true;
  }

  function show(el) {
    if (!el.isConnected || !el.dataset.tip) return hide();
    tip.textContent = el.dataset.tip;
    if (el.dataset.key) {
      const k = document.createElement('kbd');
      k.textContent = el.dataset.key;
      tip.append(k);
    }
    tip.hidden = false;

    const a = el.getBoundingClientRect(), b = tip.getBoundingClientRect();
    const left = Math.max(6, Math.min(innerWidth - b.width - 6, a.left + a.width / 2 - b.width / 2));
    const above = a.top - b.height - 8;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(above < 6 ? a.bottom + 8 : above) + 'px';
  }

  root.addEventListener('pointerover', e => {
    const el = e.target?.closest?.('[data-tip]');
    if (!el || el === cur) return;
    clearTimeout(timer);
    tip.hidden = true;
    cur = el;
    timer = setTimeout(() => show(el), DELAY);
  });

  root.addEventListener('pointerout', e => {
    const from = e.target?.closest?.('[data-tip]');
    // moving between children of the same control is not leaving it
    if (from && from !== e.relatedTarget?.closest?.('[data-tip]')) hide();
  });

  addEventListener('pointerdown', hide, true);
  addEventListener('keydown', hide, true);
  addEventListener('scroll', hide, true);
  addEventListener('blur', hide);
}

// The piano strip at the bottom. Equal-width whites with blacks straddling the seams.

const LO = 36, HI = 84;                         // C2..C6
const BLACK_PCS = [1,3,6,8,10];
const HAS_BLACK_ABOVE = [0,2,5,7,9];

export function renderKeys(el) {
  const whites = [];
  for (let n = LO; n <= HI; n++) if (!BLACK_PCS.includes(n % 12)) whites.push(n);
  const w = 100 / whites.length;
  let html = '';
  whites.forEach((n, i) =>
    html += `<div class="w" data-n="${n}" style="left:${i * w}%;width:${w}%"></div>`);
  whites.forEach((n, i) => {
    if (HAS_BLACK_ABOVE.includes(n % 12) && n + 1 <= HI)
      html += `<div class="b" data-n="${n + 1}" `
            + `style="left:${(i + 1) * w - w * .3}%;width:${w * .6}%"></div>`;
  });
  el.innerHTML = html;
}

export function paintKeys(el, { scale, root, sounding, held }) {
  const inScale = n => scale && scale.includes(((n % 12) - root + 12) % 12);
  el.querySelectorAll('[data-n]').forEach(key => {
    const n = +key.dataset.n;
    key.classList.toggle('scale', inScale(n));
    key.classList.toggle('play',  sounding.has(n));
    key.classList.toggle('you',   held.has(n));
  });
}

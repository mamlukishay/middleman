// A QR code for one short URL, drawn in the page.
//
// The learn page has to hand the phone an address that includes a room id, and
// typing `https://192.168.1.23:8765/learn-m.html?room=k3f9qa` off a laptop screen is
// exactly the kind of chore that stops a feature being used. `phone.sh` shells out
// to `qrencode` for its terminal QR, but a page cannot, and this project has no
// dependencies -- so here is the encoder, at the smallest size that does the job.
//
// **Byte mode, error correction level L, versions 1-10** -- up to 271 bytes, which is
// six times the longest URL this will ever be asked for. Anything past that throws
// rather than silently producing something a phone cannot read. Numeric, alphanumeric
// and kanji modes are not here: byte mode encodes any URL correctly, and picking the
// tighter mode would only buy a smaller picture.
//
// The layout follows ISO/IEC 18004: Reed-Solomon over GF(256) with the primitive
// polynomial x^8 + x^4 + x^3 + x^2 + 1, data split into blocks and interleaved,
// modules placed in an upward-then-downward zigzag of two-column strips skipping the
// vertical timing pattern, then all eight masks scored by the standard four penalty
// rules and the best one kept.

// ---------------------------------------------------------------- GF(256)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The generator polynomial for `n` error-correction codewords, highest degree first. */
export function genPoly(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
    g = next;
  }
  return g;
}

/** The `n` Reed-Solomon codewords for one block of data codewords. */
export function ecCodewords(data, n) {
  const g = genPoly(n), rem = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift();
    rem.push(0);
    if (factor) for (let j = 0; j < n; j++) rem[j] ^= mul(g[j + 1], factor);
  }
  return rem;
}

// ---------------------------------------------------------------- the tables
// Versions 1-10 at error correction level L. `DATA` is derived rather than tabled:
// total codewords minus the error correction ones.
const TOTAL = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ECPB = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18];        // EC codewords per block
const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
               [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataCodewords = v => TOTAL[v - 1] - ECPB[v - 1] * BLOCKS[v - 1];
/** Bytes that fit in byte mode: the data codewords, less the mode and count header. */
export const capacity = v => Math.floor((dataCodewords(v) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);

/** The smallest version that holds `n` bytes at level L. */
export function versionFor(n) {
  for (let v = 1; v <= 10; v++) if (capacity(v) >= n) return v;
  throw new Error(`qr: ${n} bytes is past what this encoder does (max ${capacity(10)})`);
}

// ---------------------------------------------------------------- BCH
const bch = (data, gen, bits) => {
  let v = data << bits;
  const top = 1 << (31 - Math.clz32(gen));
  for (let b = 1 << (31 - Math.clz32(v)); b >= top; b >>= 1)
    if (v & b) v ^= gen * (b / top);
  return (data << bits) | v;
};

/** The 15 format bits for level L and a mask, already XOR'd with the spec's mask pattern. */
export const formatBits = mask => bch(0b01 << 3 | mask, 0x537, 10) ^ 0x5412;
/** The 18 version bits, for versions 7 and up. */
export const versionBits = v => bch(v, 0x1f25, 12);

// ---------------------------------------------------------------- the bit stream
function codewordsFor(bytes, v) {
  const need = dataCodewords(v);
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                                  // byte mode
  push(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, need * 8 - bits.length));     // terminator, as much as fits
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8)
    out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let i = 0; out.length < need; i++) out.push(i % 2 ? 0x11 : 0xec);   // the spec's pad bytes
  return out;
}

/** Split into blocks, add error correction to each, and interleave, as the spec asks. */
function interleave(data, v) {
  const n = BLOCKS[v - 1], ec = ECPB[v - 1];
  const short = Math.floor(data.length / n), longs = data.length % n;
  const blocks = [];
  for (let i = 0, at = 0; i < n; i++) {
    const len = short + (i >= n - longs ? 1 : 0);
    blocks.push(data.slice(at, at + len));
    at += len;
  }
  const out = [];
  for (let i = 0; i <= short; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  const ecs = blocks.map(b => ecCodewords(b, ec));
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

// ---------------------------------------------------------------- the grid
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => ((r >> 1) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function frame(v) {
  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Uint8Array(size));
  const fixed = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (r, c, on) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    m[r][c] = on ? 1 : 0; fixed[r][c] = 1;
  };

  // the three finders, with their separators: rings at Chebyshev distance 0-1 and 3
  for (const [fr, fc] of [[3, 3], [3, size - 4], [size - 4, 3]])
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      const d = Math.max(Math.abs(dr), Math.abs(dc));
      set(fr + dr, fc + dc, d !== 2 && d <= 3);
    }

  // alignment patterns at every pair of centres, except the three under a finder
  const cs = ALIGN[v - 1];
  for (const r of cs) for (const c of cs) {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }

  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

  // the format areas are written per mask later, but have to be off limits to data now.
  // Row 6 and column 6 are the timing pattern and are *not* part of the format band --
  // the band steps over them, and reserving them here would blank two timing modules.
  for (let i = 0; i <= 8; i++) if (i !== 6) { set(8, i, 0); set(i, 8, 0); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, 0); set(size - 1 - i, 8, 0); }
  if (v >= 7) for (let i = 0; i < 18; i++) { set(Math.floor(i / 3), size - 11 + i % 3, 0); set(size - 11 + i % 3, Math.floor(i / 3), 0); }

  return { m, fixed, size };
}

/** Zigzag the codeword bits into everything the frame left free. */
function placeData(m, fixed, size, codewords) {
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                        // the vertical timing column is skipped
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fixed[r][c]) continue;
        m[r][c] = bit < total ? (codewords[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
        bit++;
      }
    }
  }
}

function writeFormat(m, size, mask) {
  const f = formatBits(mask);
  const bit = i => (f >> i) & 1;
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
  m[size - 8][8] = 1;                                  // the module that is always dark
}

function writeVersion(m, size, v) {
  if (v < 7) return;
  const b = versionBits(v);
  for (let i = 0; i < 18; i++) {
    const on = (b >> i) & 1, a = size - 11 + i % 3, d = Math.floor(i / 3);
    m[d][a] = on; m[a][d] = on;
  }
}

// ---------------------------------------------------------------- mask scoring
const FINDERISH = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]];

export function penalty(m) {
  const size = m.length;
  let score = 0, dark = 0;

  const line = get => {
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    if (run >= 5) score += 3 + (run - 5);
    for (let i = 0; i + 11 <= size; i++)
      for (const p of FINDERISH) if (p.every((v, k) => get(i + k) === v)) score += 40;
  };

  for (let r = 0; r < size; r++) line(i => m[r][i]);
  for (let c = 0; c < size; c++) line(i => m[i][c]);

  for (let r = 0; r + 1 < size; r++) for (let c = 0; c + 1 < size; c++) {
    const v = m[r][c];
    if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
  }
  // the fourth rule: how far the share of dark modules strays from half, in steps of 5%
  for (const row of m) for (const v of row) dark += v;
  score += 10 * Math.abs(Math.ceil(dark * 100 / (size * size) / 5) - 10);
  return score;
}

// ---------------------------------------------------------------- the encoder
const utf8 = s => [...new TextEncoder().encode(s)];

/**
 * The QR modules for a string: an array of rows of 0/1, no quiet zone.
 * `version` forces a size; by default the smallest that fits is used.
 */
export function qrMatrix(text, { version } = {}) {
  const bytes = typeof text === 'string' ? utf8(text) : [...text];
  const v = version ?? versionFor(bytes.length);
  if (bytes.length > capacity(v)) throw new Error(`qr: ${bytes.length} bytes do not fit version ${v}`);
  const words = interleave(codewordsFor(bytes, v), v);
  const { m, fixed, size } = frame(v);
  writeVersion(m, size, v);
  placeData(m, fixed, size, words);

  // every mask decodes; the score picks the one a camera reads most easily
  let best = null, bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const t = m.map((row, r) => Array.from(row, (val, c) => (fixed[r][c] ? val : val ^ (MASKS[k](r, c) ? 1 : 0))));
    writeFormat(t, size, k);
    const s = penalty(t);
    if (s < bestScore) { bestScore = s; best = t; }
  }
  return best;
}

/**
 * The same as an SVG string: one path for all the dark modules, which keeps it to a
 * few kilobytes and scales to whatever box it is put in.
 */
export function qrSvg(text, { quiet = 2, dark = '#000', light = '#fff', size, ...opts } = {}) {
  const m = qrMatrix(text, opts);
  const n = m.length + quiet * 2;
  let d = '';
  m.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c + quiet} ${r + quiet}h1v1h-1z`; }));
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${dim} shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

// The QR encoder, against the vectors in ISO/IEC 18004 and one whole symbol.
//
// The generator polynomials, the format string and the version string are published
// tables, so they are the honest place to catch an arithmetic slip; the baked symbol
// below then catches everything downstream of them -- block interleaving, the zigzag,
// the masks and the scoring. It was checked module for module against a reference
// encoder over four hundred random strings at every version this supports; the
// reference is not a dependency of this project, so one representative symbol is
// kept here instead.

import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg, genPoly, ecCodewords, formatBits, versionBits, capacity, versionFor, penalty }
  from '../src/qr.js';

// the log table of GF(256), so a generator polynomial can be read as the spec prints
// it: a list of powers of alpha
const LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } }
const asAlpha = poly => poly.map(c => LOG[c]);

test('the generator polynomials match the published tables', () => {
  assert.deepEqual(asAlpha(genPoly(7)), [0, 87, 229, 146, 149, 238, 102, 21]);
  assert.deepEqual(asAlpha(genPoly(10)), [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
  assert.equal(genPoly(15).length, 16);
});

test('error correction codewords have the right count and are stable', () => {
  const ec = ecCodewords([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10);
  assert.equal(ec.length, 10);
  assert.ok(ec.every(b => b >= 0 && b < 256));
  // an all-zero block has no error correction to add
  assert.deepEqual(ecCodewords(new Array(19).fill(0), 7), new Array(7).fill(0));
});

test('the format string for level L, mask 0 is the one in the standard', () => {
  assert.equal(formatBits(0).toString(2).padStart(15, '0'), '111011111000100');
});

test('every format string is a valid BCH(15,5) codeword', () => {
  for (let mask = 0; mask < 8; mask++) {
    let v = formatBits(mask) ^ 0x5412;                 // undo the spec's XOR pattern
    for (let b = 14; b >= 10; b--) if (v & (1 << b)) v ^= 0x537 << (b - 10);
    assert.equal(v, 0, `mask ${mask} is not on the code`);
  }
});

test('the version string for version 7 is the one in the standard', () => {
  assert.equal(versionBits(7).toString(2).padStart(18, '0'), '000111110010010100');
  for (let ver = 7; ver <= 10; ver++) {
    let v = versionBits(ver);
    for (let b = 17; b >= 12; b--) if (v & (1 << b)) v ^= 0x1f25 << (b - 12);
    assert.equal(v, 0, `version ${ver} is not on the code`);
  }
});

test('byte capacities at level L match the standard', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capacity),
    [17, 32, 53, 78, 106, 134, 154, 192, 230, 271]);
});

test('the smallest version that fits is the one chosen', () => {
  assert.equal(versionFor(1), 1);
  assert.equal(versionFor(17), 1);
  assert.equal(versionFor(18), 2);
  assert.equal(versionFor(271), 10);
  assert.throws(() => versionFor(272), /past what this encoder does/);
});

// ---------------------------------------------------------------- a whole symbol
const SYMBOL = [
  '11111110001011001111101111111',
  '10000010101001110000101000001',
  '10111010000010100011101011101',
  '10111010111011111101001011101',
  '10111010010001001011001011101',
  '10000010110111111000101000001',
  '11111110101010101010101111111',
  '00000000011100101001100000000',
  '11111011110101101100110101010',
  '10101000001011000011011110001',
  '00000011001000110010011010000',
  '00111000000010111001110100010',
  '11110011111011000100100001100',
  '00101100000001101001011110101',
  '01001011001110111110101110100',
  '00010000110100111011101010010',
  '00011111000111100100100000100',
  '10000000111010001111001111101',
  '10110111111010010100010101100',
  '10010000111000111010001010010',
  '10001011001011111111111110111',
  '00000000101100001111100011111',
  '11111110101001010001101011100',
  '10000010011110010000100011011',
  '10111010110011000100111110101',
  '10111010100100101110100001111',
  '10111010101010010000101110010',
  '10000010101110101001100101010',
  '11111110110001000110010100100',
];

test('a whole symbol comes out module for module', () => {
  const m = qrMatrix('http://localhost:8767/learn-m.html?room=ab12cd');
  assert.deepEqual(m.map(r => r.join('')), SYMBOL);
});

test('the finders, separators and timing patterns are where they belong', () => {
  const m = qrMatrix('https://192.168.1.23:8765/learn-m.html?room=k3f9qa');
  const size = m.length;
  assert.equal(size, 29);                              // version 3
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      assert.equal(m[r0 + r][c0 + c], d === 2 ? 0 : 1, `finder at ${r0},${c0}`);
    }
  }
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0);
  }
  assert.equal(m[size - 8][8], 1);                     // the module that is always dark
});

test('the version grows with the payload', () => {
  assert.equal(qrMatrix('a').length, 21);              // version 1
  assert.equal(qrMatrix('x'.repeat(53)).length, 29);   // version 3
  assert.equal(qrMatrix('x'.repeat(271)).length, 57);  // version 10, with its version blocks
  assert.throws(() => qrMatrix('x'.repeat(272)), /past what this encoder does/);
});

test('multi-byte characters count as their UTF-8 bytes', () => {
  assert.equal(qrMatrix('é'.repeat(8)).length, 21);    // 16 bytes: still version 1
  assert.equal(qrMatrix('é'.repeat(9)).length, 25);    // 18 bytes: version 2
});

test('the penalty is the sum of the four standard rules', () => {
  const solid = Array.from({ length: 21 }, () => new Array(21).fill(1));
  // 21 runs of 21 across and 21 down, every 2x2 block, and every module dark
  const runs = 2 * 21 * (3 + 21 - 5), blocks = 3 * 20 * 20, dark = 10 * 10;
  assert.equal(penalty(solid), runs + blocks + dark);
});

test('the SVG carries the modules and a quiet zone', () => {
  const svg = qrSvg('hi', { quiet: 4, size: 160 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 29 29"/);            // 21 modules plus 4 either side
  assert.match(svg, /width="160" height="160"/);
  const m = qrMatrix('hi');
  const dark = m.flat().filter(Boolean).length;
  assert.equal(svg.match(/M\d+ \d+h1v1h-1z/g).length, dark);
});

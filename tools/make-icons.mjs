#!/usr/bin/env node
/* Generates the app icons as PNGs, with no image library.
 *
 *   node tools/make-icons.mjs
 *
 * Two installable apps, so two icon sets, and they have to be tellable apart on
 * a home screen at 60px:
 *   - dailyplan/ — the NOW -> WANT arrow, black on yellow.
 *   - the repo root ("Second Brain") — a 2x2 block of pages, black on teal.
 *
 * iOS applies its own corner rounding to home-screen icons, so these are drawn as
 * full squares with no rounding of their own.
 */

import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Neo-brutalist: one solid accent block, a heavy black border, black mark.
   High contrast so it still reads at 60px on a home screen. */
const YELLOW = [0xff, 0xd5, 0x3d];
const TEAL   = [0x00, 0xc2, 0xcb];
const ACCENT = [0x11, 0x11, 0x11];
const BORDER = 0.055;   // fraction of the icon size

/* node >= 20.15 exposes zlib.crc32; keep a fallback so this stays runnable. */
const crc32 = zlibCrc32 || (() => {
  const table = Int32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  return buf => {
    let c = -1;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type 2 = truecolour RGB
  // [10] compression, [11] filter, [12] interlace all default to 0

  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;   // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* A heavy black border, then the arrow: a thick shaft and a tapering head. */
function arrow(x, y, S) {
  const b = BORDER * S;
  if (x < b || y < b || x > S - b || y > S - b) return ACCENT;

  const cy = S / 2;
  const dy = Math.abs(y - cy);

  const shaft = x >= 0.22 * S && x <= 0.58 * S && dy <= 0.075 * S;

  let head = false;
  const hx0 = 0.52 * S, hx1 = 0.80 * S;
  if (x >= hx0 && x <= hx1) {
    const t = (x - hx0) / (hx1 - hx0);
    head = dy <= 0.24 * S * (1 - t);
  }

  return shaft || head ? ACCENT : YELLOW;
}

/* Four solid blocks in a 2x2 grid — the small pages the app is made of. */
function pages(x, y, S) {
  const b = BORDER * S;
  if (x < b || y < b || x > S - b || y > S - b) return ACCENT;

  const lo = 0.20 * S, hi = 0.80 * S;      // outer bounds of the grid
  const gap = 0.055 * S;                    // gutter between the blocks
  const mid = (lo + hi) / 2;

  const inCol = (x >= lo && x <= mid - gap) || (x >= mid + gap && x <= hi);
  const inRow = (y >= lo && y <= mid - gap) || (y >= mid + gap && y <= hi);

  return inCol && inRow ? ACCENT : TEAL;
}

const SETS = [
  { dir: "dailyplan", draw: arrow },
  { dir: ".",         draw: pages }
];

for (const { dir, draw } of SETS) {
  for (const size of [180, 192, 512]) {
    const file = join(ROOT, dir, `icon-${size}.png`);
    writeFileSync(file, png(size, draw));
    console.log(`wrote ${file}`);
  }
}

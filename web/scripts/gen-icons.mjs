// Generate the PWA / apple-touch icons with zero dependencies. iOS "Add to Home
// Screen" needs a real PNG apple-touch-icon (SVG is not accepted there), so we
// hand-roll a small PNG encoder (RGB, filter 0, zlib via node:zlib) and draw a
// simple "gate" motif: a deep indigo tile with a lighter rounded aperture and a
// vertical bar — recognisable as an app icon without needing font rendering.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "icons");

const BG = [11, 11, 18]; // #0b0b12 near-black (matches theme-color)
const TILE = [79, 70, 229]; // #4f46e5 indigo
const APERTURE = [237, 233, 254]; // #ede9fe light
const BAR = [79, 70, 229];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, draw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  // 10..12 = compression/filter/interlace = 0

  // scanlines: 1 filter byte (0) + size*3 RGB bytes
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x, y, size);
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Rounded-rect membership test.
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function drawPixel(x, y, size) {
  const m = size / 16; // grid unit
  // Full-bleed background.
  let color = BG;
  // Tile (rounded square, generous margin).
  if (inRoundRect(x, y, 1.2 * m, 1.2 * m, 14.8 * m, 14.8 * m, 3 * m)) color = TILE;
  // Aperture (the "gate" opening) — a light rounded rectangle in the middle.
  if (inRoundRect(x, y, 4.5 * m, 3.5 * m, 11.5 * m, 12.5 * m, 1.6 * m)) color = APERTURE;
  // Vertical bar splitting the gate.
  if (x >= 7.6 * m && x <= 8.4 * m && y >= 3.5 * m && y <= 12.5 * m) color = BAR;
  return color;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of [192, 512]) {
    const png = encodePNG(size, drawPixel);
    writeFileSync(join(OUT_DIR, `icon-${size}.png`), png);
  }
  console.log(`icons: wrote icon-192.png, icon-512.png to ${OUT_DIR}`);
}

main();

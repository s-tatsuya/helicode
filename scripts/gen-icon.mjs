// Renders the extension icon without any image dependency: media/icon.png
// (a 4x supersampled RGBA buffer encoded as a PNG with node:zlib) and
// media/helicode.svg (the same geometry as vector art), so the two can't drift.
//
//   node scripts/gen-icon.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const SS = 4; // supersampling factor
const W = SIZE * SS;

const BG = [0x1c, 0x1f, 0x2b, 255];
const STRAND_A = [0x7a, 0xa2, 0xf7, 255]; // blue
const STRAND_B = [0xbb, 0x9a, 0xf7, 255]; // violet
const RUNG = [0x56, 0x5f, 0x89, 255];
const CURSOR = [0x9e, 0xce, 0x6a, 255]; // green block cursor

const buf = new Uint8ClampedArray(W * W * 4);

function blend(x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= W || y >= W || alpha <= 0) return;
  const i = (y * W + x) * 4;
  const a = Math.min(1, alpha) * (color[3] / 255);
  for (let c = 0; c < 3; c++) buf[i + c] = buf[i + c] * (1 - a) + color[c] * a;
  buf[i + 3] = Math.max(buf[i + 3], a * 255);
}

/** Filled rounded rectangle. */
function roundedRect(x0, y0, x1, y1, r, color) {
  for (let y = Math.floor(y0); y < y1; y++) {
    for (let x = Math.floor(x0); x < x1; x++) {
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      if (dx * dx + dy * dy <= r * r) blend(x, y, color, 1);
    }
  }
}

/** Thick line segment with round caps. */
function segment(ax, ay, bx, by, width, color) {
  const minX = Math.floor(Math.min(ax, bx) - width);
  const maxX = Math.ceil(Math.max(ax, bx) + width);
  const minY = Math.floor(Math.min(ay, by) - width);
  const maxY = Math.ceil(Math.max(ay, by) + width);
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const half = width / 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
      const px = ax + t * vx;
      const py = ay + t * vy;
      const d = Math.hypot(x - px, y - py);
      if (d <= half) blend(x, y, color, 1);
    }
  }
}

/** A strand of the double helix: a sine wave drawn as a polyline. */
function strand(phase, color, width) {
  const top = W * 0.17;
  const bottom = W * 0.83;
  const midX = W * 0.44;
  const amp = W * 0.18;
  const turns = 1.5;
  let prev = null;
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const y = top + (bottom - top) * t;
    const x = midX + amp * Math.sin(t * turns * 2 * Math.PI + phase);
    if (prev) segment(prev[0], prev[1], x, y, width, color);
    prev = [x, y];
  }
}

function strandPoint(phase, t) {
  const top = W * 0.17;
  const bottom = W * 0.83;
  const midX = W * 0.44;
  const amp = W * 0.18;
  const turns = 1.5;
  return [midX + amp * Math.sin(t * turns * 2 * Math.PI + phase), top + (bottom - top) * t];
}

// ---- draw ----------------------------------------------------------------
roundedRect(0, 0, W, W, W * 0.22, BG);

// rungs first, so the strands sit on top
for (let i = 1; i < 12; i++) {
  const t = i / 12;
  const a = strandPoint(0, t);
  const b = strandPoint(Math.PI, t);
  segment(a[0], a[1], b[0], b[1], W * 0.018, RUNG);
}
strand(0, STRAND_A, W * 0.05);
strand(Math.PI, STRAND_B, W * 0.05);

// Block cursor: the selection-first editing model in one shape.
const cw = W * 0.15;
const ch = W * 0.21;
roundedRect(W * 0.7, W * 0.6, W * 0.7 + cw, W * 0.6 + ch, W * 0.025, CURSOR);

// ---- downsample ----------------------------------------------------------
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += buf[i];
        g += buf[i + 1];
        b += buf[i + 2];
        a += buf[i + 3];
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

// ---- PNG encoding --------------------------------------------------------
function crc32(bytes) {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const rawRows = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  rawRows[y * (SIZE * 4 + 1)] = 0; // filter: none
  out.copy(rawRows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(rawRows, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync('media', { recursive: true });
writeFileSync('media/icon.png', png);
console.log(`wrote media/icon.png (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`);

// ---- the same drawing as SVG --------------------------------------------
const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
const u = (v) => (v / SS).toFixed(1); // supersampled units -> SVG units
const polyline = (phase) => {
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const [x, y] = strandPoint(phase, i / 120);
    pts.push(`${u(x)},${u(y)}`);
  }
  return pts.join(' ');
};
const rungs = [];
for (let i = 1; i < 12; i++) {
  const a = strandPoint(0, i / 12);
  const b = strandPoint(Math.PI, i / 12);
  rungs.push(`    <line x1="${u(a[0])}" y1="${u(a[1])}" x2="${u(b[0])}" y2="${u(b[1])}"/>`);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" role="img" aria-label="Helicode">
  <rect width="${SIZE}" height="${SIZE}" rx="${u(W * 0.22)}" fill="${hex(BG)}"/>
  <g stroke="${hex(RUNG)}" stroke-width="${u(W * 0.018)}" stroke-linecap="round">
${rungs.join('\n')}
  </g>
  <polyline fill="none" stroke="${hex(STRAND_A)}" stroke-width="${u(W * 0.05)}" stroke-linecap="round" stroke-linejoin="round" points="${polyline(0)}"/>
  <polyline fill="none" stroke="${hex(STRAND_B)}" stroke-width="${u(W * 0.05)}" stroke-linecap="round" stroke-linejoin="round" points="${polyline(Math.PI)}"/>
  <rect x="${u(W * 0.7)}" y="${u(W * 0.6)}" width="${u(cw)}" height="${u(ch)}" rx="${u(W * 0.025)}" fill="${hex(CURSOR)}"/>
</svg>
`;
writeFileSync('media/helicode.svg', svg);
console.log('wrote media/helicode.svg');

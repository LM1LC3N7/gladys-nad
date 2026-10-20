// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark gradient, the front of
// a hi-fi amplifier (a lit display, a row of buttons, a large volume knob)
// and sound waves. Plain Node (zlib), no dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
/** Antialiased coverage of a signed distance (negative inside). */
const inside = (distance) => Math.min(1, Math.max(0, 0.5 - distance));

/** Signed distance to a rounded rectangle centred on (cx, cy). */
function roundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const DARK = [12, 13, 17];
const GREY = [46, 48, 58];
// A graphite front plate and a green display, the look of classic hi-fi amplifiers.
const FRONT = [92, 96, 104];
const FRONT_SHADE = [58, 61, 68];
const PANEL = [20, 21, 25];
const DISPLAY = [10, 18, 14];
const GLOW = [96, 232, 150];
const KNOB = [70, 72, 80];
const KNOB_LIGHT = [182, 184, 192];

const BODY = { cx: 380, cy: 270, w: 300, h: 92, r: 14 };
const KNOB_C = { x: 590, y: 270, r: 64 };

function pixel(x, y) {
  let color = mix(DARK, GREY, (x / WIDTH) * 0.6 + (y / HEIGHT) * 0.4);
  // Soft shadow under the amplifier.
  const shadow = Math.hypot((x - BODY.cx) / 330, (y - 392) / 18);
  color = mix(color, [0, 0, 0], (1 - shadow) * 0.7);
  // The brushed front plate.
  const body = roundRect(x, y, BODY.cx, BODY.cy, BODY.w, BODY.h, BODY.r);
  const brushed = ((x * 7 + Math.floor(y / 2) * 13) % 17) / 17;
  const front = mix(
    mix(FRONT, FRONT_SHADE, (y - BODY.cy + BODY.h) / (2 * BODY.h)),
    FRONT,
    brushed * 0.15,
  );
  color = mix(color, front, inside(body));
  // A thin dark band at the bottom of the plate.
  color = mix(color, PANEL, inside(roundRect(x, y, BODY.cx, BODY.cy + 80, BODY.w - 6, 6, 4)));
  // The display, with lit text lines.
  const display = roundRect(x, y, 250, 250, 120, 34, 6);
  color = mix(color, DISPLAY, inside(display));
  const lines = [
    [250, 236, 90, 5],
    [222, 258, 62, 4],
  ];
  for (const [cx, cy, hw, hh] of lines) {
    color = mix(color, GLOW, inside(roundRect(x, y, cx, cy, hw, hh, hh)) * 0.95);
  }
  // A row of small buttons under the display.
  for (let i = 0; i < 6; i += 1) {
    const bx = 150 + i * 40;
    color = mix(color, PANEL, inside(Math.hypot(x - bx, y - 318) - 8));
  }
  // The power led.
  color = mix(color, GLOW, inside(Math.hypot(x - 116, y - 250) - 4));
  // The volume knob: a ring, a brushed cap, a marker.
  const d = Math.hypot(x - KNOB_C.x, y - KNOB_C.y);
  color = mix(color, PANEL, inside(d - KNOB_C.r - 6));
  const angle = Math.atan2(y - KNOB_C.y, x - KNOB_C.x);
  const sheen = 0.5 + 0.5 * Math.cos(angle * 2 + 0.6);
  color = mix(color, mix(KNOB, KNOB_LIGHT, sheen * (1 - d / KNOB_C.r) + 0.2), inside(d - KNOB_C.r));
  const mx = KNOB_C.x + Math.cos(-2.2) * 44;
  const my = KNOB_C.y + Math.sin(-2.2) * 44;
  color = mix(color, GLOW, inside(Math.hypot(x - mx, y - my) - 5));
  // Sound waves to the right.
  const wd = Math.hypot(x - KNOB_C.x, y - KNOB_C.y);
  const waveAngle = Math.abs(Math.atan2(y - KNOB_C.y, x - KNOB_C.x));
  if (x > KNOB_C.x + 60 && waveAngle < 0.5) {
    for (const r of [110, 140, 170]) {
      color = mix(color, GLOW, inside(Math.abs(wd - r) - 4) * (1 - waveAngle / 0.5) * 0.9);
    }
  }
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);

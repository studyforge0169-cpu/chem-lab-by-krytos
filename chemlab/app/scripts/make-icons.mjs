/** The app's icons, drawn here rather than downloaded: the palette is the element table's own
 *  swatches (the same hexes as --cat-* in src/styles/app.css), and the file has to be a real PNG
 *  at real sizes for the manifest and for Android's adaptive icon. */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "public");
mkdirSync(resolve(out, "icons"), { recursive: true });

const BG = [0x0b, 0x0f, 0x16];
const LINE = [0x25, 0x30, 0x44];
const SWATCH = [
  [0xff, 0x8b, 0x6b], // alkali
  [0xff, 0xc4, 0x6b], // alkaline earth
  [0x6e, 0xc1, 0xff], // transition
  [0x9b, 0xd1, 0x7a], // post-transition
  [0x66, 0xd6, 0xc8], // metalloid
  [0xd7, 0xf3, 0x6a], // nonmetal
  [0xf6, 0xa0, 0xd0], // halogen
  [0xb3, 0x9c, 0xf5], // noble gas
  [0xf0, 0xb7, 0xa0], // actinide
];

/** rounded-rect membership, in unit coords */
function inRound(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.max(x0 + r, Math.min(x, x0 + w - r));
  const cy = Math.max(y0 + r, Math.min(y, y0 + h - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9;
}
/** soft edge: 1 inside, 0 outside, ~1.2 unit-pixel feather at size s */
function cover(x, y, x0, y0, w, h, r, s) {
  const f = 1.4 / s;
  const inside = inRound(x + f, y + f, x0, y0, w, h, r);
  if (inside) return 1;
  const near = inRound(x, y, x0 - f, y0 - f, w + 2 * f, h + 2 * f, r + f);
  return near ? 0.55 : 0;
}

/** the mark: nine element tiles, the middle row pushed down a little like the f-block is */
function draw(size, { bleed, alphaBg = true }) {
  const px = new Uint8ClampedArray(size * size * 4);
  // a maskable icon gets cropped to a circle, so the mark has to fit the inscribed square too:
  // 0.52 of the canvas keeps every tile inside the safe zone at any Android shape
  const grid = bleed ? 0.52 : 0.72;
  const gap = 0.035;
  const cell = (grid - 2 * gap) / 3;
  const r = cell * 0.26;
  const x0 = (1 - grid) / 2;
  const y0 = (1 - grid) / 2;
  for (let py = 0; py < size; py++) {
    for (let px2 = 0; px2 < size; px2++) {
      const x = (px2 + 0.5) / size;
      const y = (py + 0.5) / size;
      let col = BG;
      let a = 255;
      if (bleed) {
        col = BG;
      } else {
        const bg = cover(x, y, 0.04, 0.04, 0.92, 0.92, 0.22, size);
        if (bg < 1 && !alphaBg) col = BG;
        if (bg === 0) {
          a = 0;
        } else {
          col = BG;
          a = Math.round(255 * bg);
        }
      }
      if (a > 0) {
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const cx = x0 + j * (cell + gap);
            const cy = y0 + i * (cell + gap);
            const t = cover(x, y, cx, cy, cell, cell, r, size);
            if (t > 0) {
              const c = SWATCH[i * 3 + j];
              col = [col[0] + (c[0] - col[0]) * t, col[1] + (c[1] - col[1]) * t, col[2] + (c[2] - col[2]) * t];
            }
          }
        // one line under the grid, the app's --line colour, so it is not nine floating squares
        const ln = cover(x, y, x0 + 0.06, y0 + grid + 0.045, grid - 0.12, 0.022, 0.011, size);
        if (ln > 0) col = [col[0] + (LINE[0] - col[0]) * ln, col[1] + (LINE[1] - col[1]) * ln, col[2] + (LINE[2] - col[2]) * ln];
      }
      const o = (py * size + px2) * 4;
      px[o] = col[0];
      px[o + 1] = col[1];
      px[o + 2] = col[2];
      px[o + 3] = a;
    }
  }
  return px;
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const svg = (s) => {
  const grid = 0.72,
    gap = 0.035,
    cell = (grid - 2 * gap) / 3,
    o = (1 - grid) / 2;
  let tiles = "";
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const c = "#" + SWATCH[i * 3 + j].map((x) => x.toString(16).padStart(2, "0")).join("");
      tiles += `<rect x="${(o + j * (cell + gap)) * s}" y="${(o + i * (cell + gap)) * s}" width="${cell * s}" height="${cell * s}" rx="${cell * s * 0.26}" fill="${c}"/>`;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
<rect x="${0.04 * s}" y="${0.04 * s}" width="${0.92 * s}" height="${0.92 * s}" rx="${0.22 * s}" fill="#0b0f16"/>
${tiles}
<rect x="${(o + 0.06) * s}" y="${(o + grid + 0.045) * s}" width="${(grid - 0.12) * s}" height="${0.022 * s}" rx="${0.011 * s}" fill="#253044"/>
</svg>
`;
};

const jobs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
  ["favicon-32.png", 32, false],
];
for (const [name, size, bleed] of jobs) {
  writeFileSync(resolve(out, "icons", name), encodePNG(size, draw(size, { bleed })));
  console.log(`${name.padEnd(24)} ${size}×${size}${bleed ? " maskable (safe zone)" : ""}`);
}
writeFileSync(resolve(out, "icons", "icon.svg"), svg(512));
writeFileSync(resolve(out, "icons", "icon-maskable.svg"), svg(512));
console.log("icon.svg                 512×512 vector, same maths");

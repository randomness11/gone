import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const outputDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outputDir, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width - 1;
  const bottom = top + height - 1;
  if (x >= left + radius && x <= right - radius) return y >= top && y <= bottom;
  if (y >= top + radius && y <= bottom - radius) return x >= left && x <= right;
  const cx = x < left + radius ? left + radius : right - radius;
  const cy = y < top + radius ? top + radius : bottom - radius;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function makeIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const colors = {
    forest: [23, 61, 45, 255],
    paper: [243, 241, 234, 255],
    acid: [217, 255, 67, 255],
    transparent: [0, 0, 0, 0],
  };
  const outerInset = Math.max(1, Math.round(size * .04));
  const layers = [
    { x: .20, y: .20, color: colors.paper },
    { x: .29, y: .30, color: colors.paper },
    { x: .38, y: .40, color: colors.acid },
  ];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = colors.transparent;
      if (insideRoundedRect(x, y, outerInset, outerInset, size - outerInset * 2, size - outerInset * 2, Math.max(2, Math.round(size * .18)))) color = colors.forest;
      for (const layer of layers) {
        const left = Math.round(size * layer.x);
        const top = Math.round(size * layer.y);
        const width = Math.round(size * .43);
        const height = Math.round(size * .32);
        if (insideRoundedRect(x, y, left, top, width, height, Math.max(1, Math.round(size * .035)))) color = layer.color;
      }
      const offset = (y * size + x) * 4;
      pixels.set(color, offset);
    }
  }

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`icon-${size}.png`, outputDir), makeIcon(size));

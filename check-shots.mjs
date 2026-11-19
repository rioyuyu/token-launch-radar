// check-shots.mjs — Task 3 gate for the dashboard screenshots.
// For each of the 3 files asserts: exists, size <= 524288 bytes,
// PNG/JPEG magic bytes, dimensions (PNG IHDR / JPEG SOF),
// long side <= 1440 and short side >= 800.
// Usage: node check-shots.mjs   (cwd = repo root)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 524288;
const MAX_LONG = 1440;
const MIN_SHORT = 800;

const FILES = ['1-board.png', '2-detail.png', '3-filtered.png'];

function pngSize(buf) {
  // PNG: 8-byte signature, then IHDR chunk (length 4 + type 4 + width 4 + height 4).
  if (buf.length < 33) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  // JPEG: walk segments until a SOF0/SOF1/SOF2 marker (0xC0-0xCF except 0xC4, 0xC8, 0xCC).
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2 || off + 2 + len > buf.length) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

let failures = 0;
let passes = 0;
function check(ok, label) {
  if (ok) {
    passes++;
    console.log('PASS ' + label);
  } else {
    failures++;
    console.log('FAIL ' + label);
  }
}

for (const name of FILES) {
  const path = join(here, 'screenshots', name);
  check(existsSync(path), name + ': exists');
  if (!existsSync(path)) continue;
  const size = statSync(path).size;
  check(size <= MAX_BYTES, name + ': size ' + size + ' <= ' + MAX_BYTES);
  const buf = readFileSync(path);
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  check(isPng || isJpeg, name + ': PNG or JPEG magic bytes');
  const dims = isPng ? pngSize(buf) : isJpeg ? jpegSize(buf) : null;
  check(dims !== null, name + ': dimensions readable');
  if (dims) {
    const longSide = Math.max(dims.width, dims.height);
    const shortSide = Math.min(dims.width, dims.height);
    console.log('  ' + name + ': ' + dims.width + 'x' + dims.height + ', ' + size + ' bytes (' + (size / 1024).toFixed(1) + ' KiB)');
    check(longSide <= MAX_LONG, name + ': long side ' + longSide + ' <= ' + MAX_LONG);
    check(shortSide >= MIN_SHORT, name + ': short side ' + shortSide + ' >= ' + MIN_SHORT);
  }
}

console.log(failures === 0 ? 'ALL PASS (' + passes + ' checks)' : failures + ' FAILURES, ' + passes + ' passes');
process.exit(failures === 0 ? 0 : 1);

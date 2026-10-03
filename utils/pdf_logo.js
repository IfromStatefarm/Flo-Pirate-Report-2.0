// Bound untrusted theme logos before jsPDF parses or decompresses them.
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_EDGE = 2048;
const MAX_DECODED_BYTES = 16 * 1024 * 1024; // RGBA pixel buffer

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];
const u16le = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const u32be = (bytes, at) => (bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];

function assertDimensions(width, height, pixels = width * height) {
  if (!width || !height || width > MAX_EDGE || height > MAX_EDGE || pixels * 4 > MAX_DECODED_BYTES) {
    throw new Error('PDF logo decoded dimensions exceed the limit.');
  }
}

function skipGifBlocks(bytes, start) {
  let at = start;
  while (at < bytes.length) {
    const size = bytes[at++];
    if (!size) return at;
    at += size;
  }
  return -1;
}

function gifSize(bytes) {
  if (bytes.length < 13 || !['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return null;
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  assertDimensions(width, height);
  let at = 13;
  if (bytes[10] & 0x80) at += 3 * (1 << ((bytes[10] & 7) + 1));
  let frames = 0;
  let totalPixels = 0;
  while (at < bytes.length) {
    const block = bytes[at++];
    if (block === 0x3b) return frames && at === bytes.length ? [width, height] : null;
    if (block === 0x21) {
      if (at >= bytes.length) return null;
      at = skipGifBlocks(bytes, at + 1);
    } else if (block === 0x2c) {
      if (at + 9 > bytes.length) return null;
      const left = u16le(bytes, at);
      const top = u16le(bytes, at + 2);
      const frameWidth = u16le(bytes, at + 4);
      const frameHeight = u16le(bytes, at + 6);
      totalPixels += frameWidth * frameHeight;
      assertDimensions(frameWidth, frameHeight, totalPixels);
      if (left + frameWidth > width || top + frameHeight > height || ++frames > 32) return null;
      const packed = bytes[at + 8];
      at += 9;
      if (packed & 0x80) at += 3 * (1 << ((packed & 7) + 1));
      if (at >= bytes.length || bytes[at++] < 2) return null; // LZW code size
      at = skipGifBlocks(bytes, at);
    } else return null;
    if (at < 0) return null;
  }
  return null;
}

function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at++] !== 0xff) return null;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) return null;
    const length = u16be(bytes, at);
    if (length < 2 || at + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      return [u16be(bytes, at + 5), u16be(bytes, at + 3)];
    }
    at += length;
  }
  return null;
}

function imageSize(bytes, type) {
  if (type === 'png') {
    if (bytes.length < 24 || ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n' ||
        ascii(bytes, 12, 4) !== 'IHDR' || u32be(bytes, 8) !== 13) return null;
    return [u32be(bytes, 16), u32be(bytes, 20)];
  }
  if (type === 'gif') return gifSize(bytes);
  if (type === 'jpeg') return jpegSize(bytes);
  if (type === 'webp') {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
    const format = ascii(bytes, 12, 4);
    if (format === 'VP8X') {
      return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    }
    if (format === 'VP8L' && bytes[20] === 0x2f) {
      return [1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)];
    }
    if (format === 'VP8 ' && ascii(bytes, 23, 3) === '\x9d\x01\x2a') {
      return [u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff];
    }
  }
  return null;
}

export function validatePdfLogo(dataUrl) {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!match) throw new Error('Unsupported PDF logo data URL.');
  const encoded = match[2];
  if (encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || encoded.length % 4 !== 0) {
    throw new Error('PDF logo file exceeds 1 MB or has invalid base64.');
  }
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (bytes.length > MAX_FILE_BYTES) throw new Error('PDF logo file exceeds 1 MB.');
  const dimensions = imageSize(bytes, match[1]);
  if (!dimensions) throw new Error('PDF logo has an invalid image header.');
  const [width, height] = dimensions;
  assertDimensions(width, height);
  return { dataUrl, width, height };
}

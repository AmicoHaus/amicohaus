// Strips hidden metadata from uploaded photos before they're stored: phone photos carry the GPS position they were
// taken at (which would give away an address Amico Haus keeps private), plus camera details and timestamps. The
// browser re-saves most photos already (client.js shrinkImageForUpload), but uploads can skip that, so the server
// does it for every photo. Pure byte surgery, no image decoding:
//   - JPEG: the EXIF block is rebuilt with only the orientation tag (so the photo still shows the right way up);
//     XMP (APP1) and Photoshop/IPTC (APP13) blocks and JPEG comments are dropped.
//   - PNG: eXIf, tEXt, iTXt and zTXt chunks are dropped.
//   - WebP: EXIF and XMP chunks are dropped (and the header flags/size updated).
// Anything unexpected (truncated or unusual files) is returned unchanged rather than risk breaking the photo.

function u16be(b, i) { return (b[i] << 8) | b[i + 1]; }
function u32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }
function ascii(b, i, n) { return String.fromCharCode(...b.subarray(i, i + n)); }

// The orientation value (1-8) from an EXIF payload (starting at "Exif\0\0"), or 0 if absent/unreadable.
function readOrientation(seg) {
  const t = 6; // TIFF header starts after "Exif\0\0"
  if (seg.length < t + 8) return 0;
  const le = seg[t] === 0x49 && seg[t + 1] === 0x49;
  if (!le && !(seg[t] === 0x4d && seg[t + 1] === 0x4d)) return 0;
  const r16 = (i) => (le ? seg[i] | (seg[i + 1] << 8) : u16be(seg, i));
  const r32 = (i) => (le ? u32le(seg, i) : ((seg[i] << 24) | (seg[i + 1] << 16) | (seg[i + 2] << 8) | seg[i + 3]) >>> 0);
  const ifd = t + r32(t + 4);
  if (ifd + 2 > seg.length) return 0;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > seg.length) return 0;
    if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}

// A minimal EXIF payload holding only the orientation tag.
function orientationOnlyExif(orientation) {
  const out = new Uint8Array(6 + 8 + 2 + 12 + 4);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0); // "Exif\0\0"
  out.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8], 6); // big-endian TIFF, IFD0 at offset 8
  out.set([0, 1], 14); // one entry
  out.set([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, orientation, 0, 0], 16); // Orientation, SHORT, 1, value
  // next-IFD offset (4 zero bytes) already zero
  return out;
}

function scrubJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // not where a marker should be: leave the file alone
    const marker = b[i + 1];
    if (marker === 0xd9) { parts.push(b.subarray(i)); i = b.length; break; } // end of image
    if (marker === 0xda) { parts.push(b.subarray(i)); i = b.length; break; } // start of scan: the rest is image data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return b;
    const seg = b.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1) {
      if (seg.length >= 6 && ascii(seg, 0, 4) === 'Exif') {
        const o = readOrientation(seg);
        if (o) {
          const payload = orientationOnlyExif(o);
          const head = new Uint8Array([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]);
          parts.push(head, payload);
        }
      }
      // XMP and anything else in APP1 is dropped
    } else if (marker === 0xed || marker === 0xfe) {
      // APP13 (Photoshop/IPTC) and comments: dropped
    } else {
      parts.push(b.subarray(i, i + 2 + len));
    }
    i += 2 + len;
  }
  if (i < b.length) return b;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function scrubPng(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, k) => b[k] !== v)) return b;
  const drop = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
  const parts = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return b;
    if (!drop.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function scrubWebp(b) {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return b;
  const parts = [];
  let i = 12;
  let vp8xAt = -1;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    const end = i + 8 + len + (len % 2);
    if (end > b.length + 1) return b;
    if (type !== 'EXIF' && type !== 'XMP ') {
      if (type === 'VP8X') vp8xAt = parts.reduce((n, p) => n + p.length, 0);
      parts.push(b.subarray(i, Math.min(end, b.length)));
    }
    i = end;
  }
  const bodyLen = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(12 + bodyLen);
  out.set(b.subarray(0, 12), 0);
  let o = 12;
  for (const p of parts) { out.set(p, o); o += p.length; }
  const riffSize = out.length - 8;
  out[4] = riffSize & 0xff; out[5] = (riffSize >> 8) & 0xff; out[6] = (riffSize >> 16) & 0xff; out[7] = (riffSize >>> 24) & 0xff;
  if (vp8xAt >= 0) out[12 + vp8xAt + 8] &= ~(0x08 | 0x04); // VP8X flags: no EXIF, no XMP
  return out;
}

// Returns the bytes to store (an ArrayBuffer-compatible Uint8Array).
export function scrubImageMetadata(buffer, contentType) {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    if (contentType === 'image/jpeg') return scrubJpeg(b);
    if (contentType === 'image/png') return scrubPng(b);
    if (contentType === 'image/webp') return scrubWebp(b);
  } catch { /* leave the file as it was rather than break it */ }
  return b;
}

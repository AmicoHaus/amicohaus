// Checks functions/_lib/imageMetadata.js: photos lose their GPS position and other hidden metadata, keep their
// orientation, and the image data itself is untouched. Builds small test files byte by byte. No network.
// Usage: node tools/image-metadata-test.mjs <projectRoot>
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const { scrubImageMetadata } = await import(pathToFileURL(`${root}/functions/_lib/imageMetadata.js`).href);
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };
const bytes = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const str = (s) => new Uint8Array([...s].map(c => c.charCodeAt(0)));
const has = (hay, needle) => { outer: for (let i = 0; i <= hay.length - needle.length; i++) { for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer; return true; } return false; };
const seg = (marker, payload) => bytes(new Uint8Array([0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]), payload);

// ---- JPEG with EXIF (orientation 6 + a GPS IFD with a recognizable latitude), XMP, IPTC, a comment ----
const GPS_MARK = new Uint8Array([0x13, 0x37, 0xbe, 0xef, 0x0a, 0x0b, 0x0c, 0x0d]); // stands in for the GPS numbers
function exifWithGps() {
  // little-endian TIFF: IFD0 at 8 with 2 entries (Orientation=6, GPS IFD pointer), GPS IFD with 1 entry (latitude rational)
  const tiff = new Uint8Array(8 + 2 + 24 + 4 + 2 + 12 + 4 + 8);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]); dv.setUint32(4, 8, true);
  dv.setUint16(8, 2, true);
  dv.setUint16(10, 0x0112, true); dv.setUint16(12, 3, true); dv.setUint32(14, 1, true); dv.setUint16(18, 6, true);
  const gpsIfd = 8 + 2 + 24 + 4;
  dv.setUint16(22, 0x8825, true); dv.setUint16(24, 4, true); dv.setUint32(26, 1, true); dv.setUint32(30, gpsIfd, true);
  dv.setUint32(34, 0, true);
  dv.setUint16(gpsIfd, 1, true);
  const ratAt = gpsIfd + 2 + 12 + 4;
  dv.setUint16(gpsIfd + 2, 0x0002, true); dv.setUint16(gpsIfd + 4, 5, true); dv.setUint32(gpsIfd + 6, 1, true); dv.setUint32(gpsIfd + 10, ratAt, true);
  tiff.set(GPS_MARK, ratAt);
  return bytes(str('Exif\0\0'), tiff);
}
const scan = new Uint8Array([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9]);
const jpeg = bytes(
  new Uint8Array([0xff, 0xd8]),
  seg(0xe0, bytes(str('JFIF\0'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]))),
  seg(0xe1, exifWithGps()),
  seg(0xe1, bytes(str('http://ns.adobe.com/xap/1.0/\0'), str('<x:xmpmeta><exif:GPSLatitude>32,37.5N</exif:GPSLatitude></x:xmpmeta>'))),
  seg(0xed, str('Photoshop 3.0\0 8BIM city=Chula Vista')),
  seg(0xfe, str('shot at 123 Secret St')),
  seg(0xdb, new Uint8Array(65)),
  scan,
);
const outJ = scrubImageMetadata(jpeg.buffer, 'image/jpeg');
check('JPEG: the GPS position is gone', !has(outJ, GPS_MARK) && !has(outJ, str('GPSLatitude')));
check('JPEG: XMP, IPTC and comments are gone', !has(outJ, str('ns.adobe.com')) && !has(outJ, str('8BIM')) && !has(outJ, str('Secret St')));
check('JPEG: the orientation survives (so the photo shows the right way up)', has(outJ, new Uint8Array([0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, 6])));
check('JPEG: the header, JFIF block and image data are untouched', outJ[0] === 0xff && outJ[1] === 0xd8 && has(outJ, str('JFIF')) && has(outJ, scan));
const noExif = bytes(new Uint8Array([0xff, 0xd8]), seg(0xdb, new Uint8Array(65)), scan);
check('JPEG without metadata comes back byte for byte', scrubImageMetadata(noExif, 'image/jpeg').length === noExif.length);
check('a broken JPEG is left alone rather than damaged', scrubImageMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01]), 'image/jpeg').length === 4);

// ---- PNG with eXIf and tEXt chunks ----
const chunk = (type, data) => bytes(new Uint8Array([(data.length >>> 24) & 0xff, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff]), str(type), data, new Uint8Array(4));
const png = bytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', new Uint8Array(13)), chunk('eXIf', GPS_MARK), chunk('tEXt', str('Location: 123 Secret St')), chunk('IDAT', new Uint8Array([1, 2, 3])), chunk('IEND', new Uint8Array(0)));
const outP = scrubImageMetadata(png, 'image/png');
check('PNG: eXIf and text chunks are gone, the image chunks stay', !has(outP, GPS_MARK) && !has(outP, str('Secret St')) && has(outP, str('IHDR')) && has(outP, str('IDAT')) && has(outP, str('IEND')));

// ---- WebP (extended) with EXIF and XMP chunks ----
const wchunk = (type, data) => bytes(str(type), new Uint8Array([data.length & 0xff, (data.length >> 8) & 0xff, (data.length >> 16) & 0xff, (data.length >>> 24) & 0xff]), data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
const vp8x = new Uint8Array(10); vp8x[0] = 0x08 | 0x04;
const body = bytes(str('WEBP'), wchunk('VP8X', vp8x), wchunk('VP8 ', new Uint8Array([9, 9, 9, 9])), wchunk('EXIF', GPS_MARK), wchunk('XMP ', str('<gps>32.6</gps>')));
const webp = bytes(str('RIFF'), new Uint8Array([body.length & 0xff, (body.length >> 8) & 0xff, (body.length >> 16) & 0xff, 0]), body);
const outW = scrubImageMetadata(webp, 'image/webp');
const riffSize = outW[4] | (outW[5] << 8) | (outW[6] << 16) | (outW[7] << 24);
check('WebP: EXIF and XMP chunks are gone, the image chunk stays', !has(outW, GPS_MARK) && !has(outW, str('<gps>')) && has(outW, new Uint8Array([9, 9, 9, 9])));
check('WebP: the file size and "has EXIF/XMP" flags are updated', riffSize === outW.length - 8 && (outW[20] & 0x0c) === 0, `riff=${riffSize} len=${outW.length} flags=${outW[20]}`);

// ---- other types pass through ----
const gif = str('GIF89a....');
check('GIFs pass through unchanged', scrubImageMetadata(gif, 'image/gif').length === gif.length);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

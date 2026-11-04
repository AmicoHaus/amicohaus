// Checks functions/_lib/videoMetadata.js: uploaded MP4/MOV videos lose their location (the udta/meta/XMP boxes in
// moov, every trak and the top level are renamed "free" and zeroed), the file stays exactly the same length, the
// video and audio bytes are untouched, any chunk split gives the same result, and anything that isn't an MP4/MOV
// (or doesn't parse) passes through unchanged. Builds small test files box by box. No network.
// If ffprobe is on this PC (on the PATH, in FFPROBE, or in a node_modules/@ffprobe-installer folder next to the
// project), it also scrubs a real phone video found near the project (or VIDEO_SAMPLE) into the scratch folder and
// checks the location tag is gone and the video still decodes. The original is only ever read.
// Usage: node --disable-warning=ExperimentalWarning tools/video-metadata-test.mjs <projectRoot> [scratchDir]
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.argv[2];
const scratch = process.argv[3] || process.env.SCRATCH_DIR || tmpdir();
const lib = await import(pathToFileURL(`${root}/functions/_lib/videoMetadata.js`).href);
const { createVideoScrubber, scrubVideoBytes, scrubVideoUpload, MAX_MOOV_BYTES } = lib;
let failed = 0;
const check = (label, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + detail}`); };

// ---- byte helpers ----
const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const str = (s) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff); // latin1, so '©' is 0xA9
const u32b = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u64b = (n) => cat(u32b(Math.floor(n / 2 ** 32)), u32b(n >>> 0));
const has = (hay, needle) => { const s = Buffer.from(hay).indexOf(Buffer.from(needle)); return s >= 0; };
const same = (a, b) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed; };
const noise = (n) => Uint8Array.from({ length: n }, () => rand() & 255);

// ---- a tiny box builder that remembers which boxes must come out scrubbed ----
// node: { type, kids?, tail?, data?, scrub?, large? (64-bit size), toEnd? (size 0), badSize?, samples? }
function ser(node, offset, info) {
  const hs = node.large ? 16 : 8;
  let body;
  if (node.kids) {
    const parts = [];
    let o = offset + hs;
    for (const k of node.kids) { const b = ser(k, o, info); parts.push(b); o += b.length; }
    if (node.tail) parts.push(node.tail);
    body = cat(...parts);
  } else body = node.data || new Uint8Array(0);
  const size = hs + body.length;
  const declared = node.badSize ?? size;
  const header = node.toEnd ? cat(u32b(0), str(node.type))
    : node.large ? cat(u32b(1), str(node.type), u64b(declared))
    : cat(u32b(declared), str(node.type));
  if (node.scrub) info.marks.push({ offset, hs, size });
  if (node.samples) info.samples.push([offset + hs, offset + size]);
  if (node.type === 'moov' && !info.moovEnd) info.moovEnd = offset + size;
  return cat(header, body);
}
function build(nodes) {
  const info = { marks: [], samples: [], moovEnd: 0 };
  const parts = [];
  let o = 0;
  for (const n of nodes) { const b = ser(n, o, info); parts.push(b); o += b.length; }
  const bytes = cat(...parts);
  const expected = bytes.slice();
  for (const m of info.marks) { expected.set(str('free'), m.offset + 4); expected.fill(0, m.offset + m.hs, m.offset + m.size); }
  return { bytes, expected, ...info };
}

// ---- fixtures ----
const GPS = '+32.6400-117.0800/';
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];
const SECRETS = [GPS, '+32.64', 'ISO6709', 'GPSLatitude', 'loci', 'Secret St'];
const ftyp = (brand = 'isom') => ({ type: 'ftyp', data: cat(str(brand), u32b(512), str(`${brand}iso2avc1mp41`)) });
const mvhd = () => ({ type: 'mvhd', data: cat(u32b(0), noise(96)) });
const tkhd = () => ({ type: 'tkhd', data: cat(u32b(3), noise(80)) });
const mdia = (handler) => ({ type: 'mdia', kids: [{ type: 'mdhd', data: noise(24) }, { type: 'hdlr', data: cat(u32b(0), u32b(0), str(handler), new Uint8Array(13)) }, { type: 'minf', kids: [{ type: 'stbl', data: noise(60) }] }] });
const xyz = () => ({ type: '©xyz', data: cat(new Uint8Array([0, GPS.length, 0x15, 0xc7]), str(GPS)) });
const loci = () => ({ type: 'loci', data: cat(u32b(0), new Uint8Array([0x15, 0xc7]), str('123 Secret St\0'), noise(12)) });
const keysMeta = (fullBox, scrub = true) => ({ type: 'meta', scrub, data: cat(fullBox ? u32b(0) : new Uint8Array(0), u32b(33), str('hdlr'), u32b(0), u32b(0), str('mdta'), new Uint8Array(13), str('keys'), str('mdtacom.apple.quicktime.location.ISO6709'), str('ilst'), str('+32.6400-117.0800+012.345/')) });
const udta = (scrub, extra = []) => ({ type: 'udta', scrub, kids: [xyz(), ...extra] });
const xmp = (scrub = true) => ({ type: 'uuid', scrub, data: cat(Uint8Array.from(XMP_UUID), str('<x:xmpmeta><exif:GPSLatitude>32,38.4N</exif:GPSLatitude></x:xmpmeta>')) });
const otherUuid = () => ({ type: 'uuid', data: cat(new Uint8Array(16).fill(0x11), str('PROF camera profile, not metadata')) });
const mdat = (n, extra = {}) => ({ type: 'mdat', samples: true, data: noise(n), ...extra });

const fixtures = {
  'MP4, moov before mdat, three traks': build([
    ftyp(),
    { type: 'moov', kids: [
      mvhd(),
      { type: 'trak', kids: [tkhd(), mdia('vide'), udta(true)] },
      { type: 'trak', kids: [tkhd(), mdia('soun'), keysMeta(true)] },
      { type: 'trak', kids: [tkhd(), mdia('meta'), udta(true), keysMeta(true), otherUuid()] },
      udta(true, [loci(), keysMeta(true)]),
      keysMeta(true),
      xmp(),
      otherUuid(),
    ] },
    mdat(700),
  ]),
  'MP4, moov after a 64-bit largesize mdat': build([
    ftyp(),
    { type: 'free', data: new Uint8Array(0) },
    mdat(900, { large: true }),
    { type: 'moov', kids: [mvhd(), { type: 'trak', kids: [tkhd(), mdia('vide'), udta(true)] }, { type: 'trak', kids: [tkhd(), mdia('soun')] }, udta(true, [loci()]), keysMeta(true)] },
  ]),
  'MOV (QuickTime meta without version bytes, udta terminators)': build([
    ftyp('qt  '),
    { type: 'wide', data: new Uint8Array(0) },
    mdat(800),
    { type: 'moov', kids: [
      mvhd(),
      { type: 'trak', kids: [tkhd(), mdia('vide'), { type: 'udta', scrub: true, kids: [xyz()], tail: u32b(0) }] },
      keysMeta(false),
      { type: 'udta', scrub: true, kids: [xyz(), { type: '©mak', data: str('\0\x05\x15\xc7Apple') }], tail: u32b(0) },
    ] },
  ]),
  'top-level udta/meta/XMP, moov with a 64-bit size, mdat to the end of the file': build([
    ftyp(),
    xmp(),
    otherUuid(),
    { type: 'moov', large: true, kids: [mvhd(), { type: 'trak', kids: [tkhd(), mdia('vide'), keysMeta(true)] }, udta(true)] },
    { type: 'udta', scrub: true, kids: [xyz()] },
    { type: 'meta', scrub: true, data: str('top-level ISO6709 ' + GPS) },
    mdat(500, { toEnd: true }),
  ]),
  'top-level meta running to the end of the file': build([
    ftyp(), { type: 'moov', kids: [mvhd(), udta(true)] }, mdat(300), { type: 'meta', toEnd: true, scrub: true, data: str('ISO6709 ' + GPS + ' Secret St') },
  ]),
};

const scrubChunks = (bytes, sizes, options) => {
  const s = createVideoScrubber(options);
  const parts = [];
  let i = 0;
  let k = 0;
  while (i < bytes.length) { const n = Math.max(1, sizes[k++ % sizes.length]); parts.push(...s.push(bytes.slice(i, i + n))); i += n; }
  parts.push(...s.end());
  return cat(...parts);
};

for (const [name, f] of Object.entries(fixtures)) {
  const out = scrubVideoBytes(f.bytes);
  check(`${name}: same length`, out.length === f.bytes.length, `${out.length} vs ${f.bytes.length}`);
  check(`${name}: exactly the metadata boxes become zeroed "free" boxes (${f.marks.length}), every other byte the same`, same(out, f.expected), `first difference at ${firstDiff(out, f.expected)}`);
  check(`${name}: no location left anywhere in the file`, SECRETS.every(s => !has(out, str(s))), SECRETS.filter(s => has(out, str(s))).join(', '));
  check(`${name}: the video/audio sample bytes are untouched`, f.samples.length > 0 && f.samples.every(([a, b]) => same(out.subarray(a, b), f.bytes.subarray(a, b))));
  check(`${name}: the input buffer itself is never changed`, !same(f.bytes, f.expected) && SECRETS.some(s => has(f.bytes, str(s))));
  let bad = '';
  for (const sizes of [[1], [2], [3], [4], [5], [7], [8], [9], [13], [15], [16], [17], [23], [24], [25], [31], [32], [33], [64], [100], [4096], [1, 7, 2, 30], [3, 1, 1, 16]]) {
    if (!same(scrubChunks(f.bytes, sizes), f.expected)) { bad = `chunks of ${sizes.join('/')}`; break; }
  }
  check(`${name}: same result in 1-byte chunks and every odd chunk size`, !bad, bad);
  for (let cut = 1; cut < f.bytes.length && !bad; cut++) {
    const s = createVideoScrubber();
    const out2 = cat(...s.push(f.bytes.slice(0, cut)), ...s.push(f.bytes.slice(cut)), ...s.end());
    if (!same(out2, f.expected)) bad = `split at ${cut}`;
  }
  check(`${name}: same result split in two at every byte offset`, !bad, bad);
  for (let t = 0; t < 400 && !bad; t++) {
    const a = 1 + (rand() % (f.bytes.length - 2));
    const b = a + 1 + (rand() % (f.bytes.length - a - 1));
    const s = createVideoScrubber();
    const out3 = cat(...s.push(f.bytes.slice(0, a)), ...s.push(f.bytes.slice(a, b)), ...s.push(f.bytes.slice(b)), ...s.end());
    if (!same(out3, f.expected)) bad = `splits at ${a}/${b}`;
  }
  check(`${name}: same result split in three at random offsets`, !bad, bad);
  // Cut off at every length: never throws, same length as what arrived, only ever changes bytes the full scrub changes.
  for (let cut = 0; cut <= f.bytes.length && !bad; cut++) {
    let out4;
    try { out4 = scrubChunks(f.bytes.slice(0, cut), [37]); } catch (err) { bad = `cut at ${cut} threw ${err.message}`; break; }
    if (out4.length !== cut) { bad = `cut at ${cut}: length ${out4.length}`; break; }
    for (let k = 0; k < cut; k++) if (out4[k] !== f.bytes[k] && out4[k] !== f.expected[k]) { bad = `cut at ${cut}: byte ${k} changed unexpectedly`; break; }
    if (!bad && cut >= f.moovEnd && !same(out4.subarray(0, f.moovEnd), f.expected.subarray(0, f.moovEnd))) bad = `cut at ${cut} (after moov): moov not scrubbed`;
  }
  check(`${name}: a cut-off (truncated) file still comes out the same length, never throws, never changes anything else`, !bad, bad);
}

// ---- truncated and odd files pass through ----
const end = fixtures['MP4, moov after a 64-bit largesize mdat'];
const cutInMdat = end.bytes.slice(0, end.samples[0][0] + 100);
check('a file cut off inside mdat (moov never arrives) passes through byte for byte', same(scrubVideoBytes(cutInMdat), cutInMdat));
const tinyCut = end.bytes.slice(0, 5);
check('a file cut off inside its first box header passes through', same(scrubVideoBytes(tinyCut), tinyCut));
check('an empty upload stays empty', scrubVideoBytes(new Uint8Array(0)).length === 0);
const fast = fixtures['MP4, moov before mdat, three traks'];
check(`the moov limit is 16MB (${MAX_MOOV_BYTES})`, MAX_MOOV_BYTES === 16 * 1024 * 1024);
check('a moov bigger than the limit: the whole file passes through unchanged', same(scrubVideoBytes(fast.bytes, { maxMoovBytes: 200 }), fast.bytes));
check('...in any chunking', same(scrubChunks(fast.bytes, [1, 3], { maxMoovBytes: 200 }), fast.bytes));

// The moov buffer grows with the bytes that arrive (doubling from a small start), not the size the header claims.
let growBad = '';
for (const [name, f] of Object.entries(fixtures)) {
  for (const sizes of [[1], [5], [16], [33], [4096], [1, 7, 2, 30]]) {
    if (!same(scrubChunks(f.bytes, sizes, { moovStartBytes: 16 }), f.expected)) { growBad = `${name}, chunks of ${sizes.join('/')}`; break; }
  }
  for (let cut = 0; cut <= f.bytes.length && !growBad; cut += 7) {
    const out = scrubChunks(f.bytes.slice(0, cut), [11], { moovStartBytes: 16 });
    if (out.length !== cut || (cut >= f.moovEnd && !same(out.subarray(0, f.moovEnd), f.expected.subarray(0, f.moovEnd)))) growBad = `${name}, cut at ${cut}`;
  }
  if (growBad) break;
}
check('a moov buffer that starts tiny and doubles gives the same result in every chunking and cut-off', !growBad, growBad);
{
  // A header claiming a 60MB moov followed by only 1KB: the output is as long as the input and nothing near 60MB is
  // ever allocated (Uint8Array is watched while it runs). Also with the limit raised to 64MB, so the moov is buffered.
  const RealU8 = globalThis.Uint8Array;
  let biggest = 0;
  const claimed = 60 * 1024 * 1024;
  const file = cat(build([ftyp()]).bytes, u32b(claimed), str('moov'), noise(1024));
  let outLen = -1;
  let outLen64 = -1;
  globalThis.Uint8Array = new Proxy(RealU8, { construct(target, args, newTarget) { if (typeof args[0] === 'number') biggest = Math.max(biggest, args[0]); return Reflect.construct(target, args, newTarget); } });
  try {
    outLen = scrubChunks(file, [256]).length;
    outLen64 = scrubChunks(file, [256], { maxMoovBytes: 64 * 1024 * 1024 }).length;
  } finally { globalThis.Uint8Array = RealU8; }
  check('a moov header claiming 60MB with 1KB behind it: same length out, under the default limit and a 64MB one', outLen === file.length && outLen64 === file.length, `${outLen} / ${outLen64} vs ${file.length}`);
  check(`...and no buffer anywhere near the claimed size is allocated (largest ${biggest} bytes)`, biggest > 0 && biggest <= 2 * 1024 * 1024, String(biggest));
}

// WebM (EBML header), a JPEG, plain text, an unknown first box: all pass through.
const webm = cat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]), str('webm'), noise(300), str(`moov udta ${GPS}`));
check('a WebM file passes through unchanged', same(scrubVideoBytes(webm), webm) && same(scrubChunks(webm, [1]), webm));
const jpeg = cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]), str('Exif\0\0'), noise(200));
check('a JPEG passes through unchanged', same(scrubVideoBytes(jpeg), jpeg));
const text = str('this is not a video at all, moov udta meta');
check('plain text passes through unchanged', same(scrubVideoBytes(text), text));
const unknownFirst = build([{ type: 'abcd', data: noise(20) }, { type: 'moov', kids: [mvhd(), udta(false)] }, mdat(50)]);
check('a file whose first box is not an MP4/MOV box passes through unchanged', same(scrubVideoBytes(unknownFirst.bytes), unknownFirst.bytes));

// ---- sizes that don't add up: stop there, leave the rest exactly as it was ----
const badChild = build([
  ftyp(),
  { type: 'moov', kids: [mvhd(), udta(true), { type: 'trak', badSize: 100000, kids: [tkhd(), udta(false)] }, keysMeta(false, false)] },
  mdat(200),
  { type: 'udta', scrub: true, kids: [xyz()] },
]);
let out = scrubVideoBytes(badChild.bytes);
check('a moov child whose size runs past the moov: boxes before it scrubbed, it and later siblings untouched, the file goes on', same(out, badChild.expected), `first difference at ${firstDiff(out, badChild.expected)}`);
const badTop = build([ftyp(), { type: 'free', badSize: 4, data: noise(4) }, { type: 'moov', kids: [mvhd(), udta(false)] }, mdat(80)]);
check('a top-level box with an impossible size: the rest of the file passes through unchanged', same(scrubVideoBytes(badTop.bytes), badTop.bytes));
const badType = build([ftyp(), { type: '\x01\x02\x03\x04', data: noise(10) }, { type: 'moov', kids: [mvhd(), udta(false)] }]);
check('a top-level box type that is not text: the rest passes through unchanged', same(scrubVideoBytes(badType.bytes), badType.bytes));
const hugeLarge = cat(build([ftyp()]).bytes, u32b(1), str('mdat'), u32b(0xffffffff), u32b(0), noise(40));
check('a 64-bit size too big to be real passes through unchanged', same(scrubVideoBytes(hugeLarge), hugeLarge));

// ---- the Worker wrapper: a stream in, a FixedLengthStream of the same length out ----
class FakeFixedLengthStream {
  constructor(n) {
    let seen = 0;
    FakeFixedLengthStream.made.push(n);
    const ts = new TransformStream({
      transform(c, ctl) { seen += c.byteLength; ctl.enqueue(c); },
      flush() { if (seen !== n) { FakeFixedLengthStream.mismatch = `${seen} != ${n}`; throw new Error('length mismatch'); } },
    });
    this.readable = ts.readable;
    this.writable = ts.writable;
  }
}
FakeFixedLengthStream.made = [];
FakeFixedLengthStream.mismatch = '';
const streamOf = (bytes, size) => new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); } });
const readAll = async (stream) => new Uint8Array(await new Response(stream).arrayBuffer());
globalThis.FixedLengthStream = FakeFixedLengthStream;
for (const [name, f] of Object.entries(fixtures)) {
  const got = await readAll(scrubVideoUpload(streamOf(f.bytes, 7), f.bytes.length));
  if (!same(got, f.expected)) { check(`stream wrapper: ${name}`, false, `first difference at ${firstDiff(got, f.expected)}`); }
}
check('stream wrapper: every test file comes out scrubbed through a FixedLengthStream of the upload length', FakeFixedLengthStream.made.length === Object.keys(fixtures).length && !FakeFixedLengthStream.mismatch && Object.values(fixtures).every((f, i) => FakeFixedLengthStream.made[i] === f.bytes.length), FakeFixedLengthStream.mismatch || FakeFixedLengthStream.made.join());
check('stream wrapper: a WebM goes through unchanged', same(await readAll(scrubVideoUpload(streamOf(webm, 64), webm.length)), webm));
check('stream wrapper: one chunk per byte works too', same(await readAll(scrubVideoUpload(streamOf(fast.bytes, 1), fast.bytes.length)), fast.expected));
check('stream wrapper: no body stays no body', scrubVideoUpload(null, 0) === null);

// A byte stream (what a Worker's request.body is), read with a BYOB reader.
const byteStreamOf = (bytes, size) => {
  let i = 0;
  // (closing with a BYOB read waiting needs respond(0), or that read never settles)
  return new ReadableStream({ type: 'bytes', pull(c) { if (i >= bytes.length) { c.close(); if (c.byobRequest) c.byobRequest.respond(0); return; } c.enqueue(bytes.slice(i, i + size)); i += size; } });
};
let byteOk = true;
for (const f of Object.values(fixtures)) if (!same(await readAll(scrubVideoUpload(byteStreamOf(f.bytes, 5), f.bytes.length)), f.expected)) byteOk = false;
check('stream wrapper: a byte stream read with a BYOB reader gives the same result for every test file', byteOk);

// Workers' BYOB reader also has readAtLeast (big reads). This stand-in counts reads and whether the rest was piped.
function instrumented(bytes, size) {
  const stream = byteStreamOf(bytes, size);
  const stats = { reads: 0, piped: false };
  return {
    stats,
    body: {
      getReader(opts) {
        const real = stream.getReader(opts);
        if (!opts || opts.mode !== 'byob') return real;
        return {
          async readAtLeast(min, view) {
            stats.reads++;
            let buf = view.buffer;
            const offset = view.byteOffset;
            const length = view.byteLength; // read now: each BYOB read detaches the buffer it was given
            let filled = 0;
            let ended = false;
            while (filled < min) {
              const r = await real.read(new Uint8Array(buf, offset + filled, length - filled));
              if (r.value) buf = r.value.buffer;
              if (r.done) { ended = true; break; }
              filled += r.value.byteLength;
            }
            return { value: new Uint8Array(buf, offset, filled), done: ended && filled === 0 };
          },
          releaseLock: () => real.releaseLock(),
          cancel: (e) => real.cancel(e),
        };
      },
      pipeTo(dest) { stats.piped = true; return stream.pipeTo(dest); },
    },
  };
}
const MB3 = 3 * 1024 * 1024;
const bigWebm = cat(webm, noise(MB3));
let inst = instrumented(bigWebm, 64 * 1024);
let got = await readAll(scrubVideoUpload(inst.body, bigWebm.length));
check('stream wrapper: a 3MB WebM is looked at once, then piped straight through unchanged', same(got, bigWebm) && inst.stats.reads === 1 && inst.stats.piped, JSON.stringify(inst.stats));
const bigFast = build([ftyp(), { type: 'moov', kids: [mvhd(), { type: 'trak', kids: [tkhd(), mdia('vide'), udta(true)] }, udta(true, [loci()]), keysMeta(true)] }, mdat(MB3)]);
inst = instrumented(bigFast.bytes, 64 * 1024);
got = await readAll(scrubVideoUpload(inst.body, bigFast.bytes.length));
check('stream wrapper: index-first MP4 is scrubbed, then its 3MB mdat (the last box) is piped straight through', same(got, bigFast.expected) && inst.stats.reads === 1 && inst.stats.piped, JSON.stringify(inst.stats));
const bigEnd = build([ftyp(), mdat(MB3), { type: 'moov', kids: [mvhd(), { type: 'trak', kids: [tkhd(), mdia('vide'), udta(true)] }, keysMeta(true)] }]);
inst = instrumented(bigEnd.bytes, 64 * 1024);
got = await readAll(scrubVideoUpload(inst.body, bigEnd.bytes.length));
check('stream wrapper: index-last MP4 (how phones save) is read in 1MB pieces to reach the moov, and scrubbed', same(got, bigEnd.expected) && inst.stats.reads <= 5 && !inst.stats.piped, JSON.stringify(inst.stats));
check('...knowing the upload length changes nothing in the result', same(scrubVideoBytes(bigFast.bytes, { totalLength: bigFast.bytes.length }), bigFast.expected));
const s1 = createVideoScrubber({ totalLength: fast.bytes.length });
s1.push(fast.bytes.slice(0, fast.samples[0][0]));
check('...and passing turns true right after the last box header, never before', s1.passing === true && (() => { const s2 = createVideoScrubber({ totalLength: fast.bytes.length }); s2.push(fast.bytes.slice(0, fast.moovEnd)); return s2.passing === false; })());

// An upload that breaks off mid-way fails the stored copy (the R2 put fails) instead of storing a cut-off file.
let pulls = 0;
const failing = new ReadableStream({ pull(c) { if (pulls++ < 3) c.enqueue(bigEnd.bytes.slice((pulls - 1) * 1000, pulls * 1000)); else c.error(new Error('connection lost')); } });
const realConsole = console.log;
console.log = () => {};
let failedRead = false;
try { await readAll(scrubVideoUpload(failing, bigEnd.bytes.length)); } catch { failedRead = true; }
await new Promise(res => setTimeout(res, 20)); // let the wrapper log its failure line while the console is muted
console.log = realConsole;
check('stream wrapper: an upload that breaks off errors the output rather than ending it early', failedRead);
delete globalThis.FixedLengthStream;
check('stream wrapper without FixedLengthStream (local tools) still scrubs', same(await readAll(scrubVideoUpload(streamOf(fast.bytes, 11), fast.bytes.length)), fast.expected));

// ---- a real phone video, if ffprobe is on this PC ----
const exe = process.platform === 'win32' ? '.exe' : '';
const runs = (cmd) => { try { return spawnSync(cmd, ['-version'], { encoding: 'utf8' }).status === 0; } catch { return false; } };
const searchRoot = process.env.VIDEO_SEARCH_ROOT || path.dirname(path.resolve(root));
const SKIP_DIRS = new Set(['.git', 'dist', '_dist', 'frames', '__pycache__', '.cache']);
function findFiles() {
  const videos = [];
  const probes = [];
  const started = Date.now();
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > 9 || visited > 400000 || Date.now() - started > 25000) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      visited++;
      const p = path.join(dir, e.name);
      // node_modules is often a link to a shared copy; only look for an installed ffprobe there, never walk it.
      if (e.name === 'node_modules') {
        const candidate = path.join(p, '@ffprobe-installer', `${process.platform}-${process.arch}`, `ffprobe${exe}`);
        if (probes.length < 5 && existsSync(candidate)) probes.push(candidate);
      } else if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1);
      } else if (/\.(mp4|mov|m4v)$/i.test(e.name)) {
        try { const size = statSync(p).size; if (size > 100 * 1024 && size < 95 * 1024 * 1024) videos.push({ p, size }); } catch { /* skip */ }
      }
    }
  };
  walk(searchRoot, 0);
  // Folders of camera clips first (rendered reels rarely keep a location), smallest first within each.
  const score = (v) => (/[\\/](clips|raw\d*)[\\/]/i.test(v.p) ? 0 : /[\\/](inventory|source|footage|camera)[\\/]/i.test(v.p) ? 1 : 2);
  videos.sort((a, b) => score(a) - score(b) || a.size - b.size);
  return { videos, probes };
}
// Every format and stream tag, plus whether there's a video stream at all (some clips here are audio only).
const ffprobeTags = (ffprobe, file) => {
  const r = spawnSync(ffprobe, ['-v', 'quiet', '-show_entries', 'format_tags:stream_tags:stream=codec_type', '-of', 'json', file], { encoding: 'utf8' });
  try {
    const j = JSON.parse(r.stdout || '{}');
    const tags = [j.format && j.format.tags, ...((j.streams || []).map(st => st.tags))].filter(Boolean).reduce((all, t) => ({ ...all, ...t }), {});
    return { tags, hasVideo: (j.streams || []).some(st => st.codec_type === 'video') };
  } catch { return { tags: {}, hasVideo: false }; }
};
const locationTags = (tags) => Object.entries(tags).filter(([k, v]) => /location|xyz|iso6709|gps/i.test(k) || /^[+-]\d{1,3}\.\d+[+-]\d{1,3}\.\d+/.test(String(v)));
const decodeCount = (ffprobe, file) => {
  const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-read_intervals', '%+3', '-show_entries', 'stream=nb_read_frames,codec_name,width,height', '-of', 'json', file], { encoding: 'utf8' });
  let s = {};
  try { s = (JSON.parse(r.stdout || '{}').streams || [])[0] || {}; } catch { /* nothing */ }
  return { status: r.status, errors: (r.stderr || '').trim(), frames: Number(s.nb_read_frames) || 0, codec: s.codec_name, size: `${s.width}x${s.height}` };
};
const sha = async (stream) => { const h = createHash('sha256'); for await (const c of stream) h.update(c); return h.digest('hex'); };

let ffprobe = process.env.FFPROBE || (runs('ffprobe') ? 'ffprobe' : '');
let walked = null;
if (!ffprobe) { walked = findFiles(); ffprobe = walked.probes.find(runs) || ''; }
if (!ffprobe) {
  console.log('SKIP  real phone video check: no ffprobe on this PC');
} else {
  const videos = process.env.VIDEO_SAMPLE ? [{ p: process.env.VIDEO_SAMPLE }] : (walked || findFiles()).videos;
  let sample = null;
  let tagsBefore = [];
  for (const v of videos.slice(0, 80)) {
    const probe = ffprobeTags(ffprobe, v.p);
    const loc = locationTags(probe.tags);
    if (loc.length && probe.hasVideo) { sample = v.p; tagsBefore = loc; break; }
  }
  if (!sample) {
    console.log('SKIP  real phone video check: no video with a location tag found');
  } else {
    mkdirSync(scratch, { recursive: true });
    const outPath = path.join(scratch, `scrubbed-${process.pid}-${path.basename(sample)}`);
    check('the scrubbed copy is written to the scratch folder, not next to the original', path.resolve(path.dirname(outPath)) !== path.resolve(path.dirname(sample)));
    const s = createVideoScrubber();
    const ws = createWriteStream(outPath);
    for await (const chunk of createReadStream(sample, { highWaterMark: 64 * 1024 })) {
      for (const part of s.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))) if (!ws.write(part)) await once(ws, 'drain');
    }
    for (const part of s.end()) ws.write(part);
    ws.end();
    await once(ws, 'finish');
    const label = `${path.basename(path.dirname(sample))}/${path.basename(sample)}`;
    check(`real video ${label}: had a location tag before (${tagsBefore.map(([k, v]) => `${k}=${v}`).join(', ')})`, tagsBefore.length > 0);
    check('real video: same size after the scrub', statSync(outPath).size === statSync(sample).size, `${statSync(outPath).size} vs ${statSync(sample).size}`);
    const tagsAfter = locationTags(ffprobeTags(ffprobe, outPath).tags);
    check('real video: the location tag is gone', tagsAfter.length === 0, JSON.stringify(tagsAfter));
    const coords = String(tagsBefore[0][1]).slice(0, 8);
    let rawHit = false;
    let carry = Buffer.alloc(0);
    for await (const chunk of createReadStream(outPath, { highWaterMark: 1024 * 1024 })) {
      const window = Buffer.concat([carry, chunk]);
      if (window.includes(coords)) { rawHit = true; break; }
      carry = window.subarray(Math.max(0, window.length - 16));
    }
    check(`real video: the coordinates (${coords}...) aren't anywhere in the file's bytes either`, !rawHit);
    const before = decodeCount(ffprobe, sample);
    const after = decodeCount(ffprobe, outPath);
    check(`real video: still decodes (${after.codec} ${after.size}, ${after.frames} frames in the first 3 seconds, same as the original)`, after.status === 0 && after.frames > 0 && after.frames === before.frames && after.codec === before.codec && after.errors === before.errors, JSON.stringify({ before, after }));
    globalThis.FixedLengthStream = FakeFixedLengthStream;
    FakeFixedLengthStream.mismatch = '';
    const viaWrapper = await sha(scrubVideoUpload(Readable.toWeb(createReadStream(sample)), statSync(sample).size));
    delete globalThis.FixedLengthStream;
    check('real video: the Worker stream wrapper gives exactly the same bytes', viaWrapper === await sha(createReadStream(outPath)) && !FakeFixedLengthStream.mismatch);
    if (!process.env.KEEP_OUTPUT) { try { unlinkSync(outPath); } catch { /* fine */ } }
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

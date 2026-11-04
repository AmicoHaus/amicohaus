// Strips the hidden location from uploaded videos before they're stored. Phone videos (MP4 and MOV, both
// "ISO-BMFF": a file made of boxes, each with a 4-byte size and a 4-letter type) carry the GPS position they were
// recorded at in a few metadata boxes inside the "moov" box (the file's index), which would give away an address
// Amico Haus keeps private. Those boxes are renamed to "free" (padding every player skips) and their contents
// zeroed, at the same size, so the location is really gone, no other byte in the file moves and the video plays
// exactly as before:
//   moov/udta, moov/meta, moov/trak/udta, moov/trak/meta (every trak), any top-level udta/meta, and XMP uuid boxes.
// Works on the upload as it streams in: only the moov box is held in memory (up to 16MB; a phone video's is usually
// well under 2MB), and its buffer grows with the bytes that actually arrive, not the size its header claims, so a
// header that says "64MB" followed by a trickle can't tie up memory every other request on the Worker shares.
// Everything else passes straight through, and once nothing is left to change, the rest of the
// upload goes to R2 without passing through this code at all (Workers count CPU time). Anything unexpected (not an
// MP4/MOV, a moov bigger than that, sizes that don't add up) passes through unchanged rather than risk breaking the
// video. The output is always exactly as long as the input. Not covered: location written into the video frames
// themselves (a few drones and action cameras record a GPS track as data samples), which would need a re-encode.

export const MAX_MOOV_BYTES = 16 * 1024 * 1024;
// The moov buffer starts this big (or the moov's size, if smaller) and doubles as bytes come in, up to the moov's size.
export const MOOV_START_BYTES = 1024 * 1024;
// The Worker reads the upload in pieces this big, so a 95MB video is about a hundred steps, not thousands.
const READ_BYTES = 1024 * 1024;

// Box types a real MP4/MOV starts with. Anything else (WebM starts with an EBML header, for one) passes through.
const FIRST_BOX_TYPES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'styp', 'sidx', 'junk']);
const METADATA_BOX_TYPES = new Set(['udta', 'meta']);
// XMP packets (Adobe tools) sit in a uuid box with this id, and can hold the location too.
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];
const FREE = [0x66, 0x72, 0x65, 0x65]; // "free"

function u32(b, i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
// A 64-bit box size, or -1 when it's too big to be real (over 2^53 bytes).
function u64(b, i) {
  const hi = u32(b, i);
  if (hi >= 0x200000) return -1;
  return hi * 0x100000000 + u32(b, i + 4);
}
function fourcc(b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); }
// Box types are four printable characters (QuickTime also uses ©, 0xA9).
function isBoxType(b, i) {
  for (let k = i; k < i + 4; k++) if (!((b[k] >= 0x20 && b[k] <= 0x7e) || b[k] === 0xa9)) return false;
  return true;
}
function isXmpUuid(b, i) {
  if (i + 16 > b.length) return false;
  for (let k = 0; k < 16; k++) if (b[i + k] !== XMP_UUID[k]) return false;
  return true;
}
function isMetadataBox(b, p, headerSize) {
  const type = fourcc(b, p + 4);
  return METADATA_BOX_TYPES.has(type) || (type === 'uuid' && isXmpUuid(b, p + headerSize));
}

// Walks the boxes between start and end of a buffered moov (end is the declared end; the buffer can be shorter when
// the file was cut off) and renames the metadata ones in place. Stops at the first size that doesn't fit, leaving
// the rest as it is: every box renamed before that point is a real box, found by adding up real sizes.
function scrubChildren(buf, start, end, inTrak) {
  let p = start;
  while (p + 8 <= end && p + 8 <= buf.length) {
    const size32 = u32(buf, p);
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
      if (p + 16 > buf.length) return;
      size = u64(buf, p + 8);
      headerSize = 16;
    }
    if (size32 === 0 || size < headerSize || p + size > end) return; // a QuickTime terminator, or a size that doesn't fit
    if (!inTrak && fourcc(buf, p + 4) === 'trak') scrubChildren(buf, p + headerSize, p + size, true);
    else if (isMetadataBox(buf, p, headerSize)) blank(buf, p, headerSize, p + size);
    p += size;
  }
}

// Renames the box at p to "free" and zeroes what was in it (up to end, or as much of it as the buffer holds).
function blank(buf, p, headerSize, end) {
  buf.set(FREE, p + 4);
  buf.fill(0, p + headerSize, Math.min(end, buf.length));
}

function scrubMoov(buf, headerSize, declaredSize) {
  try { scrubChildren(buf, headerSize, declaredSize, false); } catch (err) { /* leave it as it is */ }
}

function toBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return new Uint8Array(chunk);
}

// The pure core: feed it the file's bytes in chunks of any size (push), then call end(). Each call returns the
// bytes to write out, in order; together they're exactly as long as what went in. totalLength (the upload's
// length, if known) lets it stop looking as soon as a box runs to the end of the file; passing is then true and
// every later byte would come out unchanged.
export function createVideoScrubber({ maxMoovBytes = MAX_MOOV_BYTES, totalLength = 0, moovStartBytes = MOOV_START_BYTES } = {}) {
  let mode = 'header'; // 'header' (reading a top-level box header), 'body' (passing a box through), 'moov', 'pass'
  let first = true;
  const head = new Uint8Array(32);
  let headLen = 0;
  let headNeed = 8;
  let remaining = 0;
  let zeroBody = false; // passing a top-level metadata box through as zeros
  let moov = null; // the moov bytes so far (the buffer can be bigger than moovFill, never bigger than moovSize)
  let moovFill = 0;
  let moovSize = 0; // the moov's declared size
  let moovHeaderSize = 8;
  let consumed = 0; // bytes pushed before the current chunk
  let headStart = 0; // where in the file the current header began

  // The header bytes read so far go out as they are, and so does everything after them.
  function giveUp() {
    const emit = head.slice(0, headLen);
    headLen = 0;
    headNeed = 8;
    mode = 'pass';
    return emit;
  }

  // Called once the header bytes needed so far are in. Returns the bytes to write out (or null while more header
  // bytes are needed, or when they went into the moov buffer). The header stays held until the very end, so if
  // anything here fails, the catch in push() can still send it out unchanged.
  function readHeader() {
    if (!isBoxType(head, 4) || (first && !FIRST_BOX_TYPES.has(fourcc(head, 4)))) return giveUp();
    const size32 = u32(head, 0);
    const headerSize = size32 === 1 ? 16 : 8;
    const type = fourcc(head, 4);
    const need = headerSize + (type === 'uuid' ? 16 : 0); // a uuid box's 16-byte id says whether it's XMP
    if (headLen < need) { headNeed = need; return null; }

    first = false;
    if (size32 === 0) {
      // A box that runs to the end of the file (usually mdat): nothing after it to look at.
      if (!isMetadataBox(head, 0, headerSize)) return giveUp();
      blank(head, 0, headerSize, need);
      const emit = head.slice(0, need);
      remaining = Infinity;
      zeroBody = true;
      mode = 'body';
      headLen = 0;
      headNeed = 8;
      return emit;
    }
    const size = size32 === 1 ? u64(head, 8) : size32;
    if (size < need) return giveUp();
    if (type === 'moov') {
      if (size > maxMoovBytes) return giveUp();
      const buf = new Uint8Array(Math.min(size, Math.max(need, moovStartBytes)));
      buf.set(head.subarray(0, need));
      moov = buf;
      moovFill = need;
      moovSize = size;
      moovHeaderSize = headerSize;
      mode = 'moov';
      headLen = 0;
      headNeed = 8;
      return moovFill === size ? finishMoov() : null;
    }
    zeroBody = isMetadataBox(head, 0, headerSize);
    // The last box in the file (usually mdat, on a video saved with its index first): nothing after it to look at.
    if (!zeroBody && totalLength > 0 && headStart + size >= totalLength) return giveUp();
    if (zeroBody) blank(head, 0, headerSize, need);
    const emit = head.slice(0, need);
    remaining = size - need;
    mode = remaining > 0 ? 'body' : 'header';
    headLen = 0;
    headNeed = 8;
    return emit;
  }

  function finishMoov() {
    const done = moov.length === moovSize ? moov : moov.slice(0, moovSize);
    scrubMoov(done, moovHeaderSize, moovSize);
    moov = null;
    mode = 'header';
    return done;
  }

  // Room for n more moov bytes: the buffer doubles (copying what's in it), never past the moov's declared size.
  function growMoov(n) {
    if (moovFill + n <= moov.length) return;
    const bigger = new Uint8Array(Math.min(moovSize, Math.max(moov.length * 2, moovFill + n)));
    bigger.set(moov.subarray(0, moovFill));
    moov = bigger;
  }

  // Whatever is held back, as it came in (used when something unexpected happens).
  function heldBytes() {
    const parts = [];
    if (mode === 'header' && headLen) parts.push(head.slice(0, headLen));
    if (moov) parts.push(moov.subarray(0, moovFill));
    headLen = 0;
    moov = null;
    return parts;
  }

  return {
    push(chunk) {
      const b = toBytes(chunk);
      const out = [];
      let i = 0;
      try {
        while (i < b.length) {
          if (mode === 'pass') {
            out.push(i === 0 ? b : b.subarray(i));
            i = b.length;
          } else if (mode === 'body') {
            const n = Math.min(remaining, b.length - i);
            out.push(zeroBody ? new Uint8Array(n) : b.subarray(i, i + n));
            i += n;
            remaining -= n;
            if (remaining === 0) mode = 'header';
          } else if (mode === 'moov') {
            const n = Math.min(moovSize - moovFill, b.length - i);
            growMoov(n);
            moov.set(b.subarray(i, i + n), moovFill);
            moovFill += n;
            i += n;
            if (moovFill === moovSize) out.push(finishMoov());
          } else {
            if (headLen === 0) headStart = consumed + i;
            const n = Math.min(headNeed - headLen, b.length - i);
            head.set(b.subarray(i, i + n), headLen);
            headLen += n;
            i += n;
            if (headLen === headNeed) {
              const emit = readHeader();
              if (emit) out.push(emit);
            }
          }
        }
      } catch (err) {
        // Never break an upload: what was held back and the rest of the file go out exactly as they came in.
        out.push(...heldBytes());
        if (i < b.length) out.push(b.subarray(i));
        mode = 'pass';
      }
      consumed += b.length;
      return out;
    },
    get passing() { return mode === 'pass'; },
    // The file ended. A cut-off header goes out as it is; a cut-off moov still has the boxes it does hold scrubbed.
    end() {
      const out = [];
      if (mode === 'header' && headLen) out.push(head.slice(0, headLen));
      if (mode === 'moov' && moov) {
        const part = moov.subarray(0, moovFill);
        scrubMoov(part, moovHeaderSize, moovSize);
        out.push(part);
      }
      headLen = 0;
      moov = null;
      mode = 'pass';
      return out;
    },
  };
}

// The whole file at once (handy for tests and small files).
export function scrubVideoBytes(bytes, options) {
  const scrubber = createVideoScrubber(options);
  const parts = [...scrubber.push(bytes), ...scrubber.end()];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// The Worker side: wraps an upload's body stream for bucket.put. R2 needs to know a stream's length up front, so
// the result is a FixedLengthStream of the same length (the scrub never changes it); without one (local tools) it's
// a plain stream. The file's own bytes decide whether it's an MP4/MOV, not the type the browser claimed, so a WebM
// (or anything else) passes through unchanged.
export function scrubVideoUpload(body, contentLength) {
  if (!body || typeof body.getReader !== 'function') return body;
  const length = Number(contentLength) > 0 ? Number(contentLength) : 0;
  const out = typeof FixedLengthStream === 'function' && length ? new FixedLengthStream(length) : new TransformStream();
  pumpScrubbed(body, out.writable, createVideoScrubber({ totalLength: length }))
    .catch(err => console.log(`[video scrub stream failed] ${err && err.message}`));
  return out.readable;
}

// Reads the upload in big pieces, writes the scrubbed bytes out, and as soon as nothing is left to change, hands the
// rest of the upload straight to the output (a native pipe, no per-chunk work here). Any failure aborts the output,
// so the R2 put fails as it would for a broken upload, rather than storing a cut-off file.
async function pumpScrubbed(body, writable, scrubber) {
  let reader;
  let byob = false;
  try { reader = body.getReader({ mode: 'byob' }); byob = true; } catch { reader = body.getReader(); }
  const writer = writable.getWriter();
  try {
    for (;;) {
      let result;
      if (byob) {
        const view = new Uint8Array(READ_BYTES);
        result = typeof reader.readAtLeast === 'function' ? await reader.readAtLeast(READ_BYTES, view) : await reader.read(view);
      } else {
        result = await reader.read();
      }
      const { value, done } = result;
      if (value && value.byteLength) {
        for (const part of scrubber.push(value)) if (part.length) await writer.write(part);
      }
      if (done) break;
      if (scrubber.passing) {
        reader.releaseLock();
        writer.releaseLock();
        await body.pipeTo(writable);
        return;
      }
    }
    for (const part of scrubber.end()) if (part.length) await writer.write(part);
    await writer.close();
  } catch (err) {
    try { await writer.abort(err); } catch { /* already released or closed */ }
    try { await reader.cancel(err); } catch { /* already released or closed */ }
    throw err;
  }
}

// Reliable UTF-8 <-> base64 conversion.
//
// The old `btoa(unescape(encodeURIComponent(s)))` trick relies on the
// deprecated `unescape`, which mis-encodes multi-byte UTF-8 in some modern
// browser / bundled runtimes, producing mojibake for non-ASCII text (e.g.
// Chinese city names and descriptions stored as garbled strings).
//
// Instead we use TextEncoder (standard, all modern browsers) to get the
// raw UTF-8 bytes, then base64-encode those bytes ourselves. Decoding goes
// the reverse way. No deprecated globals involved.

export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str)
  return bytesToB64(bytes)
}

export function b64ToUtf8(b64) {
  return new TextDecoder().decode(b64ToBytes(b64))
}

function bytesToB64(bytes) {
  // Build from binary string in chunks to avoid call-stack limits on large
  // inputs (TextEncoder output can be big for images, though we only use this
  // for JSON text here).
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function b64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

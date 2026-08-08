// Stable content hash, used to tie a recorded response to the exact template
// text it was recorded against. If a template is edited, its recording no
// longer matches and demo mode says so rather than serving a stale answer.
//
// FNV-1a, 32-bit. Not cryptographic — it only needs to detect edits.

export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

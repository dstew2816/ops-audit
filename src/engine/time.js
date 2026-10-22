// Timestamp helpers for display: parse a number or ISO string, and format it compactly.

export const ms = (value) =>
  typeof value === 'number' ? value : Date.parse(value);

/** "2026-07-29 02:40Z" — compact, unambiguous, sortable. */
export function formatTimestamp(value) {
  const d = new Date(ms(value));
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

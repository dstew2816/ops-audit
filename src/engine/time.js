export const MINUTE_MS = 60_000;

export const ms = (value) =>
  typeof value === 'number' ? value : Date.parse(value);

export const minutesBetween = (a, b) => (ms(b) - ms(a)) / MINUTE_MS;

/** "2h 14m" / "47m" / "3d 4h" */
export function formatDuration(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours ? `${days}d ${leftoverHours}h` : `${days}d`;
}

/** "2026-07-29 02:40Z" — compact, unambiguous, sortable. */
export function formatTimestamp(value) {
  const d = new Date(ms(value));
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/** "2026-07-29 02:40:15Z" for evidence panels where seconds matter. */
export function formatTimestampPrecise(value) {
  const iso = new Date(ms(value)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}Z`;
}

/** Like formatDuration but resolves to seconds below a minute, for ingest lag. */
export function formatLag(totalMinutes) {
  if (totalMinutes < 1) return `${Math.round(totalMinutes * 60)}s`;
  return formatDuration(totalMinutes);
}

/** Signed offset rendered relative to a reference point. */
export function formatOffset(minutes) {
  const rounded = Math.round(minutes);
  if (rounded === 0) return 'on the boundary';
  const magnitude = formatDuration(Math.abs(rounded));
  return rounded > 0 ? `${magnitude} after` : `${magnitude} before`;
}

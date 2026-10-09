/**
 * Safely format timestamps received from AWS / backend into the user's browser local time.
 * Automatically appends 'Z' to ISO strings if missing so they are correctly parsed as UTC.
 */
export function formatScanTime(ts?: string): string {
  if (!ts) return '—';
  const hasTimezone = ts.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(ts);
  const normalized = hasTimezone ? ts : `${ts}Z`;
  const date = new Date(normalized);
  if (isNaN(date.getTime())) {
    const fallback = new Date(ts);
    return isNaN(fallback.getTime()) ? ts : fallback.toLocaleString();
  }
  return date.toLocaleString();
}

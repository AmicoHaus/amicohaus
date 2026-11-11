// Open-house and preview times are stored as ISO (UTC). Workers run in UTC, so every label names the zone.
export const PACIFIC = 'America/Los_Angeles';
// Node's and V8's ICU put a narrow no-break space before AM/PM; labels use a plain space.
const clean = s => s.replace(/ /g, ' ');
// "Sat, Nov 14, 1:00 PM – 4:00 PM Pacific time" (en dash with spaces).
export function pacificWhenLabel(startIso, endIso) {
  const s = new Date(startIso), e = new Date(endIso);
  const start = clean(s.toLocaleString('en-US', { timeZone: PACIFIC, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  const end = clean(e.toLocaleTimeString('en-US', { timeZone: PACIFIC, hour: 'numeric', minute: '2-digit' }));
  return `${start} – ${end} Pacific time`;
}
// "2026-11-14" (the Pacific calendar day of an ISO time), and "Sat, Nov 14" for chips.
export function pacificDayKey(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: PACIFIC }); }
export function pacificDayLabel(iso) { return clean(new Date(iso).toLocaleDateString('en-US', { timeZone: PACIFIC, weekday: 'short', month: 'short', day: 'numeric' })); }

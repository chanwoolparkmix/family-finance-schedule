// Date helpers shared by the notifier. All dates are {y,m,d} in the device's time zone.
export function localNow(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: g("year"), m: g("month"), d: g("day"), hour: g("hour") };
}
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// Next payment date on or after `today` for a monthly payment day (31 = month end when shorter).
export function nextDue(today, day) {
  let y = today.y, m = today.m;
  let d = Math.min(day, lastDay(y, m));
  if (d < today.d) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    d = Math.min(day, lastDay(y, m));
  }
  return { y, m, d };
}
export const daysBetween = (a, b) => Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
export const iso = (x) => x.y + "-" + String(x.m).padStart(2, "0") + "-" + String(x.d).padStart(2, "0");

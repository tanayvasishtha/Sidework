const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 174000 -> "$1,740.00". */
export function money(cents: number): string {
  return dollars.format(cents / 100);
}

/** 280 -> "4.7 hrs", 240 -> "4 hrs". */
export function hours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} ${h === 1 ? "hr" : "hrs"}`;
}

/** "17:00" -> "5:00", "00:40" -> "12:40". Shift bars read like a paper schedule. */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
}

/** "2026-11-07" -> "Saturday, Nov 7". */
export function night(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

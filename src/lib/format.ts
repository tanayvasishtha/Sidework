const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 174000 -> "$1,740.00". */
export function money(cents: number): string {
  return dollars.format(cents / 100);
}

/** 280 -> "4.7 hrs", 240 -> "4 hrs". */
export function hours(minutes: number): string {
  const h = tenths(minutes / 60);
  return `${h} ${h === 1 ? "hr" : "hrs"}`;
}

/** 84.93 -> 84.9. */
export function tenths(n: number): number {
  return Math.round(n * 10) / 10;
}

export const WALLET = { VENMO: "Venmo", PAYPAL: "PayPal" } as const;

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

const ZONES: Record<string, string> = { TX: "America/Chicago", NY: "America/New_York", CA: "America/Los_Angeles" };

/** A timestamp as the restaurant's own wall clock shows it: "12:58 AM". */
export function localTime(iso: string, state: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ZONES[state] ?? "America/Chicago",
  });
}

export type Money = { currency_code: string; value: string };

/** 1234 -> "12.34". PayPal wants decimal strings, and we keep integer cents everywhere else. */
export function centsToValue(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Amount must be a whole number of cents, got ${cents}.`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "12.34" -> 1234. Parsed as text so 0.1 + 0.2 style float errors can't creep in. */
export function valueToCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Not a USD amount: "${value}".`);
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

export function usd(cents: number): Money {
  return { currency_code: "USD", value: centsToValue(cents) };
}

import type { Answer, Scenario } from "./types";

// The answer key. Exact integer arithmetic throughout, and no imports from the
// engine, so the engine is graded against something other than itself.

const ELECTRONIC = new Set(["card", "paypal", "venmo"]);

function minutesBetween(start: string, end: string): number {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMinutes(end) - toMinutes(start);
  return diff > 0 ? diff : diff + 1440;
}

/** a x b / c, rounded half up, in exact integers. */
function roundedMulDiv(a: number, b: number, c: number): number {
  const [x, y, z] = [BigInt(a), BigInt(b), BigInt(c)];
  return Number((x * y * 2n + z) / (z * 2n));
}

export function answerFor(s: Scenario): Answer {
  let tipCents = 0;
  let electronicCents = 0;
  let serviceChargeCents = 0;

  for (const line of s.lines) {
    const qualified = line.tipCents + (line.guestCouldChangeAutoGratuity ? line.autoGratuityCents : 0);
    tipCents += qualified;
    if (ELECTRONIC.has(line.source)) electronicCents += qualified;
    if (!line.guestCouldChangeAutoGratuity) serviceChargeCents += line.autoGratuityCents;
  }

  // Fee rates are held to a hundredth of a percent, so the rate is a whole number out of 10,000.
  const feeCents = roundedMulDiv(electronicCents, Math.round(s.policy.cardFeeRate * 10_000), 10_000);
  const poolCents = tipCents - feeCents;

  const out = new Set(s.truth.violations.map((v) => v.staffId));
  // Rates are whole quarters of a point, so minutes x rate x 4 is a whole number.
  const units = new Map<string, bigint>();
  const worked = new Map<string, number>();
  for (const shift of s.shifts) {
    const rate = s.policy.pointsPerHour[shift.station] ?? 0;
    if (rate <= 0 || out.has(shift.staffId)) continue;
    const minutes = minutesBetween(shift.start, shift.end);
    units.set(shift.staffId, (units.get(shift.staffId) ?? 0n) + BigInt(minutes) * BigInt(Math.round(rate * 4)));
    worked.set(shift.staffId, (worked.get(shift.staffId) ?? 0) + minutes);
  }

  const total = [...units.values()].reduce((sum, u) => sum + u, 0n);
  const shares: Record<string, number> = {};
  if (total > 0n) {
    let paid = 0;
    for (const [id, u] of units) {
      shares[id] = Number((BigInt(poolCents) * u) / total);
      paid += shares[id];
    }
    // Leftover cents go to whoever worked longest, ties by id.
    const longest = [...worked.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    shares[longest] += poolCents - paid;
  }
  return { poolCents, serviceChargeCents, shares };
}

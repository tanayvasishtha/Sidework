import { allocatePool, cardFeeCents, checkPool, classifyNight, pointUnits, shiftMinutes, splitPool } from "@/lib/rules";
import type { Answer, Scenario } from "./types";

/** What a night came out as under some method, to grade against the answer key. */
export type Outcome = {
  caught: string[];
  poolCents: number;
  serviceChargeCents: number;
  shares: Record<string, number>;
};

/** Sidework: the engine flags people, the manager takes them out, and the rest is split. */
export function engineOutcome(s: Scenario): Outcome {
  const flags = checkPool(s.staff, s.shifts, s.policy).filter((f) => f.severity === "block" && f.staffId);
  const caught = [...new Set(flags.map((f) => f.staffId!))];
  const money = classifyNight(s.lines, s.policy);
  const shares = Object.fromEntries(splitPool(money.tipPoolCents, s.shifts, s.policy, new Set(caught)).map((a) => [a.staffId, a.cents]));
  return { caught, poolCents: money.tipPoolCents, serviceChargeCents: money.serviceChargeCents, shares };
}

/**
 * A careful spreadsheet with no knowledge of the law: the same points and card fee,
 * but everyone on the schedule shares and added gratuities go in with the tips.
 */
export function spreadsheetOutcome(s: Scenario): Outcome {
  const electronic = s.lines.filter((l) => l.source !== "cash").reduce((t, l) => t + l.tipCents + l.autoGratuityCents, 0);
  const all = s.lines.reduce((t, l) => t + l.tipCents + l.autoGratuityCents, 0);
  const poolCents = all - cardFeeCents(electronic, s.policy.cardFeeRate);
  const entries = new Map<string, { staffId: string; minutes: number; units: number }>();
  for (const shift of s.shifts) {
    const rate = s.policy.pointsPerHour[shift.station] ?? 0;
    if (rate <= 0) continue;
    const entry = entries.get(shift.staffId) ?? { staffId: shift.staffId, minutes: 0, units: 0 };
    entry.minutes += shiftMinutes(shift);
    entry.units += pointUnits(shiftMinutes(shift), rate);
    entries.set(shift.staffId, entry);
  }
  const shares = Object.fromEntries(allocatePool(poolCents, [...entries.values()]).map((a) => [a.staffId, a.cents]));
  return { caught: [], poolCents, serviceChargeCents: 0, shares };
}

export function sameShares(a: Record<string, number>, b: Record<string, number>): boolean {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ids].every((id) => (a[id] ?? 0) === (b[id] ?? 0));
}

/** Money that reached the wrong person: everything paid above what each person was owed. */
export function misdirectedCents(truth: Record<string, number>, got: Record<string, number>): number {
  const ids = new Set([...Object.keys(truth), ...Object.keys(got)]);
  return [...ids].reduce((sum, id) => sum + Math.max(0, (got[id] ?? 0) - (truth[id] ?? 0)), 0);
}

export function isCorrect(answer: Answer, outcome: Outcome): boolean {
  return (
    answer.poolCents === outcome.poolCents &&
    answer.serviceChargeCents === outcome.serviceChargeCents &&
    sameShares(answer.shares, outcome.shares)
  );
}

/** Whether every planted violation was caught, and nobody else was accused. */
export function caughtAll(s: Scenario, outcome: Outcome): boolean {
  const planted = s.truth.violations.map((v) => v.staffId).sort();
  return JSON.stringify(planted) === JSON.stringify([...outcome.caught].sort());
}

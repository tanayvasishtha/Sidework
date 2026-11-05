import { shiftMinutes } from "./pool";
import type { Allocation, Policy, Shift } from "./types";

/** Card fee on card tips, rounded to the nearest cent. */
export function cardFeeCents(cardTipCents: number, rate: number): number {
  return Math.round(cardTipCents * rate);
}

/**
 * Splits a pool by points (hours times the station's points per hour).
 * Shares are floored to the cent, and the leftover cents go to whoever
 * worked longest, so the pool always pays out exactly.
 */
export function splitPool(
  poolCents: number,
  shifts: Shift[],
  policy: Policy,
  excludedStaffIds: ReadonlySet<string> = new Set(),
): Allocation[] {
  if (!Number.isInteger(poolCents) || poolCents < 0) {
    throw new Error(`Pool must be a whole number of cents, got ${poolCents}.`);
  }

  const byStaff = new Map<string, { minutes: number; points: number }>();
  for (const shift of shifts) {
    if (excludedStaffIds.has(shift.staffId)) continue;
    const rate = policy.pointsPerHour[shift.station] ?? 0;
    if (rate <= 0) continue;
    const minutes = shiftMinutes(shift);
    const entry = byStaff.get(shift.staffId) ?? { minutes: 0, points: 0 };
    entry.minutes += minutes;
    entry.points += (minutes / 60) * rate;
    byStaff.set(shift.staffId, entry);
  }

  const totalPoints = [...byStaff.values()].reduce((sum, e) => sum + e.points, 0);
  if (totalPoints === 0) return [];

  const allocations: Allocation[] = [...byStaff.entries()].map(([staffId, e]) => ({
    staffId,
    minutes: e.minutes,
    points: round2(e.points),
    cents: Math.floor((poolCents * e.points) / totalPoints),
    remainderCents: 0,
  }));

  const leftover = poolCents - allocations.reduce((sum, a) => sum + a.cents, 0);
  // Usually a few cents up. Float rounding can also land it a cent over, so this settles either way.
  if (leftover !== 0) {
    const longest = [...allocations].sort(
      (a, b) => b.minutes - a.minutes || a.staffId.localeCompare(b.staffId),
    )[0];
    longest.cents += leftover;
    longest.remainderCents = leftover;
  }

  return allocations.sort((a, b) => b.cents - a.cents || a.staffId.localeCompare(b.staffId));
}

export type SplitDifference = { staffId: string; proposedCents: number; checkedCents: number };

/** Compares a proposed split with the engine's. Any difference holds the payout. */
export function compareSplits(proposed: Allocation[], checked: Allocation[]): SplitDifference[] {
  const ids = new Set([...proposed, ...checked].map((a) => a.staffId));
  const centsOf = (list: Allocation[], id: string) => list.find((a) => a.staffId === id)?.cents ?? 0;
  return [...ids]
    .map((staffId) => ({
      staffId,
      proposedCents: centsOf(proposed, staffId),
      checkedCents: centsOf(checked, staffId),
    }))
    .filter((d) => d.proposedCents !== d.checkedCents)
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

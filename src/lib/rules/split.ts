import { shiftMinutes } from "./pool";
import type { Allocation, Policy, Shift } from "./types";

/** Card fee on card tips, rounded to the nearest cent. Worked in whole numbers, as all money is here. */
export function cardFeeCents(cardTipCents: number, rate: number): number {
  const millionths = BigInt(Math.round(rate * 1_000_000));
  return Number((BigInt(cardTipCents) * millionths * 2n + 1_000_000n) / 2_000_000n);
}

/** Minutes times points per hour, in thousandths of a point, so shares never depend on float rounding. */
export function pointUnits(minutes: number, pointsPerHour: number): number {
  return Math.round(minutes * pointsPerHour * 1000);
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
  const byStaff = new Map<string, { minutes: number; units: number }>();
  for (const shift of shifts) {
    if (excludedStaffIds.has(shift.staffId)) continue;
    const rate = policy.pointsPerHour[shift.station] ?? 0;
    if (rate <= 0) continue;
    const minutes = shiftMinutes(shift);
    const entry = byStaff.get(shift.staffId) ?? { minutes: 0, units: 0 };
    entry.minutes += minutes;
    entry.units += pointUnits(minutes, rate);
    byStaff.set(shift.staffId, entry);
  }
  return allocatePool(poolCents, [...byStaff.entries()].map(([staffId, e]) => ({ staffId, ...e })));
}

/** Turns each person's points into cents. Shared by the engine and the agent's check, so they can only differ on the inputs. */
export function allocatePool(poolCents: number, entries: { staffId: string; minutes: number; units: number }[]): Allocation[] {
  if (!Number.isInteger(poolCents) || poolCents < 0) {
    throw new Error(`Pool must be a whole number of cents, got ${poolCents}.`);
  }
  const earning = entries.filter((e) => e.units > 0);
  const totalUnits = BigInt(earning.reduce((sum, e) => sum + e.units, 0));
  if (totalUnits === 0n) return [];

  const allocations: Allocation[] = earning.map((e) => ({
    staffId: e.staffId,
    minutes: e.minutes,
    points: round2(e.units / 60_000),
    cents: Number((BigInt(poolCents) * BigInt(e.units)) / totalUnits),
    remainderCents: 0,
  }));

  const leftover = poolCents - allocations.reduce((sum, a) => sum + a.cents, 0);
  if (leftover > 0) {
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

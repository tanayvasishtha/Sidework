import { describe, expect, it } from "vitest";
import { checkPool, classifyNight, splitPool } from "@/lib/rules";
import { getRestaurant, getShifts, getStaff, getTipLines, LUCIAS, openDb, SATURDAY } from "./index";
import { seedLucias } from "./seed";

describe("Lucia's seed", () => {
  const d = openDb(":memory:");
  const restaurant = getRestaurant(d, LUCIAS);
  const staff = getStaff(d, LUCIAS);
  const shifts = getShifts(d, SATURDAY);

  it("has fourteen staff on Saturday's schedule", () => {
    expect(staff).toHaveLength(14);
    expect(new Set(shifts.map((s) => s.staffId)).size).toBe(14);
  });

  it("seeds only once", () => {
    seedLucias(d);
    expect(getStaff(d, LUCIAS)).toHaveLength(14);
    expect(getShifts(d, SATURDAY)).toHaveLength(14);
  });

  it("catches the floor manager in the pool", () => {
    const flags = checkPool(staff, shifts, restaurant.policy);
    expect(flags.map((f) => [f.ruleId, f.staffId])).toEqual([["FLSA-MGR", "dave"]]);
  });

  it("keeps table 12's added gratuity out of the tip pool", () => {
    const night = classifyNight(getTipLines(d, SATURDAY), restaurant.policy);
    expect(night.serviceChargeCents).toBe(18000);
    expect(night.flags.map((f) => f.ruleId)).toContain("IRS-OVER");
  });

  it("splits the whole pool across everyone but Dave", () => {
    const night = classifyNight(getTipLines(d, SATURDAY), restaurant.policy);
    const split = splitPool(night.tipPoolCents, shifts, restaurant.policy, new Set(["dave"]));
    expect(split).toHaveLength(13);
    expect(split.reduce((s, a) => s + a.cents, 0)).toBe(night.tipPoolCents);
  });
});

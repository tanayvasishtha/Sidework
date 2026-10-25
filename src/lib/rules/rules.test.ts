import { describe, expect, it } from "vitest";
import { cardFeeCents, checkPool, compareSplits, shiftMinutes, splitPool } from "./index";
import type { Policy, Shift, StaffMember } from "./types";

const policy: Policy = {
  pointsPerHour: { server: 1, bartender: 1.5, busser: 0.5, host: 0.5, cook: 0.5, dishwasher: 0.5 },
  takesTipCredit: false,
  cardFeeRate: 0.029,
};

const staff: StaffMember[] = [
  { id: "maria", name: "Maria", role: "server", managerDuties: false },
  { id: "jake", name: "Jake", role: "server", managerDuties: false },
  { id: "tasha", name: "Tasha", role: "bartender", managerDuties: false },
  { id: "luis", name: "Luis", role: "cook", managerDuties: false },
  { id: "dave", name: "Dave", role: "server", managerDuties: true },
];

const shifts: Shift[] = [
  { staffId: "maria", station: "server", start: "17:00", end: "21:00" },
  { staffId: "jake", station: "server", start: "16:00", end: "20:00" },
  { staffId: "jake", station: "bartender", start: "20:00", end: "00:40" },
  { staffId: "tasha", station: "bartender", start: "18:00", end: "00:40" },
  { staffId: "luis", station: "cook", start: "16:00", end: "23:40" },
  { staffId: "dave", station: "server", start: "16:00", end: "01:00" },
];

describe("shiftMinutes", () => {
  it("counts a same-day shift", () => {
    expect(shiftMinutes({ start: "17:00", end: "21:00" })).toBe(240);
  });

  it("rolls a shift past midnight", () => {
    expect(shiftMinutes({ start: "20:00", end: "00:40" })).toBe(280);
  });

  it("rejects a badly written time", () => {
    expect(() => shiftMinutes({ start: "5pm", end: "21:00" })).toThrow("HH:MM");
  });
});

describe("checkPool", () => {
  it("blocks anyone with manager duties, whatever their title", () => {
    const flags = checkPool(staff, shifts, policy);
    expect(flags).toEqual([
      expect.objectContaining({ ruleId: "FLSA-MGR", staffId: "dave", severity: "block" }),
    ]);
  });

  it("allows the kitchen when no tip credit is taken", () => {
    const flags = checkPool(staff, shifts, policy);
    expect(flags.some((f) => f.ruleId === "FLSA-BOH")).toBe(false);
  });

  it("blocks the kitchen when a tip credit is taken", () => {
    const flags = checkPool(staff, shifts, { ...policy, takesTipCredit: true });
    expect(flags).toContainEqual(expect.objectContaining({ ruleId: "FLSA-BOH", staffId: "luis" }));
  });

  it("ignores people whose station earns no points", () => {
    const flags = checkPool(staff, shifts, {
      ...policy,
      pointsPerHour: { ...policy.pointsPerHour, server: 0 },
    });
    expect(flags.some((f) => f.staffId === "dave")).toBe(false);
  });

  it("warns about a card fee above what processors charge", () => {
    const flags = checkPool(staff, shifts, { ...policy, cardFeeRate: 0.08 });
    expect(flags).toContainEqual(expect.objectContaining({ ruleId: "FLSA-FEE", severity: "warn" }));
  });
});

describe("splitPool", () => {
  const withoutDave = new Set(["dave"]);

  it("pays out the whole pool to the cent", () => {
    for (const pool of [0, 1, 99, 174000, 174001, 123457]) {
      const total = splitPool(pool, shifts, policy, withoutDave).reduce((s, a) => s + a.cents, 0);
      expect(total).toBe(pool);
    }
  });

  it("counts each station at its own rate", () => {
    const jake = splitPool(100000, shifts, policy, withoutDave).find((a) => a.staffId === "jake");
    // 4 hours on the floor at 1 point, 4h40m on bar at 1.5 points
    expect(jake?.points).toBe(11);
    expect(jake?.minutes).toBe(520);
  });

  it("gives leftover cents to whoever worked longest", () => {
    const allocations = splitPool(100, shifts, policy, withoutDave);
    const withRemainder = allocations.filter((a) => a.remainderCents > 0);
    expect(withRemainder.map((a) => a.staffId)).toEqual(["jake"]);
  });

  it("leaves out excluded staff", () => {
    const ids = splitPool(174000, shifts, policy, withoutDave).map((a) => a.staffId);
    expect(ids).not.toContain("dave");
  });

  it("returns nothing when nobody earns points", () => {
    expect(splitPool(5000, shifts, { ...policy, pointsPerHour: {} })).toEqual([]);
  });

  it("refuses fractions of a cent", () => {
    expect(() => splitPool(10.5, shifts, policy)).toThrow("whole number");
  });
});

describe("cardFeeCents", () => {
  it("rounds the fee to the nearest cent", () => {
    expect(cardFeeCents(141200, 0.029)).toBe(4095);
  });
});

describe("compareSplits", () => {
  it("lists only the people whose amounts differ", () => {
    const checked = splitPool(174000, shifts, policy, new Set(["dave"]));
    const proposed = checked.map((a) =>
      a.staffId === "jake" ? { ...a, cents: a.cents - 1370 } : a,
    );
    expect(compareSplits(proposed, checked)).toEqual([
      expect.objectContaining({ staffId: "jake", proposedCents: expect.any(Number) }),
    ]);
  });

  it("returns nothing for identical splits", () => {
    const checked = splitPool(174000, shifts, policy);
    expect(compareSplits(checked, checked)).toEqual([]);
  });
});

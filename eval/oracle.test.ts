import { describe, expect, it } from "vitest";
import { answerFor } from "./oracle";
import { caughtAll, engineOutcome, misdirectedCents, sameShares, spreadsheetOutcome } from "./score";
import type { Scenario } from "./types";

const night: Scenario = {
  id: "worked-example",
  category: "manager",
  planted: "Dave is a manager in the pool.",
  policy: { pointsPerHour: { server: 1, bartender: 1.5 }, takesTipCredit: false, cardFeeRate: 0.03 },
  policyText: "",
  staff: [
    { id: "ann", name: "Ann", title: "Server", role: "server", managerDuties: false },
    { id: "bo", name: "Bo", title: "Bartender", role: "bartender", managerDuties: false },
    { id: "dave", name: "Dave", title: "Lead", role: "server", managerDuties: true },
  ],
  shifts: [
    { staffId: "ann", station: "server", start: "17:00", end: "23:00" },
    { staffId: "bo", station: "bartender", start: "18:00", end: "00:00" },
    { staffId: "dave", station: "server", start: "17:00", end: "23:00" },
  ],
  lines: [
    { id: "a", source: "card", tipCents: 10_000, autoGratuityCents: 0, guestCouldChangeAutoGratuity: false },
    { id: "b", source: "cash", tipCents: 1_000, autoGratuityCents: 0, guestCouldChangeAutoGratuity: false },
    { id: "c", source: "paypal", tipCents: 2_000, autoGratuityCents: 5_000, guestCouldChangeAutoGratuity: false },
  ],
  truth: { violations: [{ ruleId: "FLSA-MGR", staffId: "dave" }] },
};

describe("answer key", () => {
  it("works a night out by hand", () => {
    // Fee: 3% of $120 electronic tips is $3.60. Pool: $130 - $3.60 = $126.40.
    // Points: Ann 6, Bo 9. $126.40 x 6/15 = $50.56, x 9/15 = $75.84.
    expect(answerFor(night)).toEqual({ poolCents: 12_640, serviceChargeCents: 5_000, shares: { ann: 5_056, bo: 7_584 } });
  });

  it("gives leftover cents to whoever worked longest", () => {
    const odd = { ...night, lines: [{ id: "a", source: "cash" as const, tipCents: 100, autoGratuityCents: 0, guestCouldChangeAutoGratuity: false }] };
    const shares = answerFor({ ...odd, shifts: [...odd.shifts, { staffId: "ann", station: "server", start: "12:00", end: "12:10" }] }).shares;
    expect(shares.ann + shares.bo).toBe(100);
  });
});

describe("engine against the answer key", () => {
  // Thousands of odd nights, to surface rounding that a handful of scenarios would miss.
  it("agrees to the cent on every random night", () => {
    let seed = 20261105;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const int = (max: number) => Math.floor(rand() * max);
    const mismatches: string[] = [];

    for (let night = 0; night < 5000; night++) {
      const people = 2 + int(14);
      const stations = ["server", "bartender", "busser"] as const;
      const shifts = Array.from({ length: people }, (_, i) => {
        const start = `${String(10 + int(10))}:${String(int(12) * 5).padStart(2, "0")}`;
        const end = `${String(int(24)).padStart(2, "0")}:${String(int(12) * 5).padStart(2, "0")}`;
        return { staffId: `p${i}`, station: stations[int(3)], start, end };
      });
      const s: Scenario = {
        id: `random-${night}`,
        category: "clean",
        planted: "",
        policy: {
          pointsPerHour: { server: 1 + int(4) * 0.25, bartender: 1 + int(4) * 0.25, busser: 0.25 + int(4) * 0.25 },
          takesTipCredit: false,
          cardFeeRate: int(40) / 1000,
        },
        policyText: "",
        staff: shifts.map((x) => ({ id: x.staffId, name: x.staffId, title: "", role: x.station, managerDuties: false })),
        shifts,
        lines: Array.from({ length: 1 + int(30) }, (_, i) => ({
          id: `l${i}`,
          source: (["card", "paypal", "venmo", "cash"] as const)[int(4)],
          tipCents: int(20_000),
          autoGratuityCents: 0,
          guestCouldChangeAutoGratuity: false,
        })),
        truth: { violations: [] },
      };
      const key = answerFor(s);
      const got = engineOutcome(s);
      if (got.poolCents !== key.poolCents || !sameShares(key.shares, got.shares)) {
        mismatches.push(`${s.id}: pool ${got.poolCents} vs ${key.poolCents}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe("scoring", () => {
  it("catches the planted manager and matches the key", () => {
    const outcome = engineOutcome(night);
    expect(caughtAll(night, outcome)).toBe(true);
    expect(sameShares(answerFor(night).shares, outcome.shares)).toBe(true);
  });

  it("shows what the spreadsheet gets wrong", () => {
    const sheet = spreadsheetOutcome(night);
    expect(sheet.caught).toEqual([]);
    expect(sheet.shares.dave).toBeGreaterThan(0);
    expect(misdirectedCents(answerFor(night).shares, sheet.shares)).toBeGreaterThan(0);
  });
});

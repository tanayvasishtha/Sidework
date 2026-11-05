import { describe, expect, it } from "vitest";
import { HARTLEYS_FRIDAY, openDb, SATURDAY } from "@/lib/db";
import { getCloseout, saveShiftEdits, takeOut } from "./closeout";
import { applyShiftEdits } from "./schedule/edits";

describe("close-out", () => {
  it("holds payment at Lucia's until Dave is out of the pool", () => {
    const d = openDb(":memory:");
    const before = getCloseout(d, SATURDAY);
    expect(before.blocking).toBe(1);
    expect(before.flags.find((f) => f.severity === "block")).toMatchObject({ ruleId: "FLSA-MGR", staffName: "Dave Marsh" });
    expect(before.split.map((s) => s.staffId)).toContain("dave");

    takeOut(d, SATURDAY, "dave", "FLSA-MGR");
    const after = getCloseout(d, SATURDAY);
    expect(after.blocking).toBe(0);
    expect(after.split).toHaveLength(13);
    expect(after.split.map((s) => s.staffId)).not.toContain("dave");
    expect(after.split.reduce((t, s) => t + s.cents, 0)).toBe(after.money.poolCents);
  });

  it("shows table 12's added gratuity apart from the tips", () => {
    const c = getCloseout(openDb(":memory:"), SATURDAY);
    expect(c.money.autoGratuities).toEqual([{ label: "Table 12", cents: 18000, tipOnTopCents: 2000 }]);
    expect(c.money.serviceChargeCents).toBe(18000);
    const lineTotal = c.money.lines.reduce((t, l) => t + l.cents, 0);
    expect(lineTotal - c.money.feeCents).toBe(c.money.poolCents);
  });

  it("needs both morning crew out at Hartley's before anyone is paid", () => {
    const d = openDb(":memory:");
    expect(getCloseout(d, HARTLEYS_FRIDAY).blocking).toBe(2);
    takeOut(d, HARTLEYS_FRIDAY, "hartleys-ruth", "FLSA-CRT");
    takeOut(d, HARTLEYS_FRIDAY, "hartleys-cole", "FLSA-CRT");
    expect(getCloseout(d, HARTLEYS_FRIDAY).blocking).toBe(0);
  });

  it("clears every block on a person when they're taken out", () => {
    const d = openDb(":memory:");
    d.prepare("update staff set role = 'cook' where id = 'hartleys-ruth'").run();
    d.prepare("update shifts set station = 'cook' where staff_id = 'hartleys-ruth'").run();
    d.prepare("update restaurants set points_per_hour = json_set(points_per_hour, '$.cook', 0.5) where id = 'hartleys'").run();
    const before = getCloseout(d, HARTLEYS_FRIDAY);
    expect(before.flags.filter((f) => f.staffId === "hartleys-ruth" && f.severity === "block")).toHaveLength(2);

    takeOut(d, HARTLEYS_FRIDAY, "hartleys-ruth", "FLSA-CRT");
    const after = getCloseout(d, HARTLEYS_FRIDAY);
    expect(after.flags.filter((f) => f.staffId === "hartleys-ruth").every((f) => f.resolved)).toBe(true);
    expect(after.blocking).toBe(1);
  });

  it("refuses to take out someone with no block flag", () => {
    expect(() => takeOut(openDb(":memory:"), SATURDAY, "maria", "FLSA-MGR")).toThrow("no FLSA-MGR block");
  });

  it("marks the shifts a note changed and keeps the note", () => {
    const d = openDb(":memory:");
    const c = getCloseout(d, SATURDAY);
    const note = "Maria cut at 9.";
    const shifts = c.people.flatMap((p) => p.shifts);
    const result = applyShiftEdits(
      shifts,
      [{ kind: "end", staffId: "maria", at: "21:00", station: null, start: null, end: null, quote: "Maria cut at 9" }],
      c.people,
      note,
    );
    saveShiftEdits(d, SATURDAY, note, result);

    const after = getCloseout(d, SATURDAY);
    const edited = after.people.flatMap((p) => p.shifts).filter((s) => s.edited);
    expect(edited).toEqual([{ staffId: "maria", station: "server", start: "17:00", end: "21:00", edited: true }]);
    expect(after.note).toEqual({ text: note, applied: ["Maria Lopez left at 21:00"], rejected: [] });
  });
});

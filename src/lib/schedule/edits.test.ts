import { describe, expect, it } from "vitest";
import type { Shift } from "@/lib/rules";
import { applyShiftEdits, type ShiftEdit } from "./edits";

const staff = [
  { id: "maria", name: "Maria" },
  { id: "jake", name: "Jake" },
  { id: "sam", name: "Sam" },
  { id: "ana", name: "Ana" },
];

const shifts: Shift[] = [
  { staffId: "maria", station: "server", start: "17:00", end: "23:00" },
  { staffId: "jake", station: "server", start: "16:00", end: "00:40" },
  { staffId: "sam", station: "bartender", start: "16:00", end: "00:40" },
];

const NOTE = "Sam called out sick. Maria cut at 9. Jake covered bar after 8 and closed. Ana came in to host 5 to 10.";

const edit = (e: Partial<ShiftEdit> & Pick<ShiftEdit, "kind" | "staffId" | "quote">): ShiftEdit => ({
  at: null,
  station: null,
  start: null,
  end: null,
  ...e,
});

const sam = edit({ kind: "absent", staffId: "sam", quote: "Sam called out sick" });
const maria = edit({ kind: "end", staffId: "maria", at: "21:00", quote: "Maria cut at 9" });
const jake = edit({ kind: "move", staffId: "jake", at: "20:00", station: "bartender", quote: "Jake covered bar after 8" });
const ana = edit({ kind: "add", staffId: "ana", station: "host", start: "17:00", end: "22:00", quote: "Ana came in to host 5 to 10" });

describe("applyShiftEdits", () => {
  it("applies Saturday's note at Lucia's", () => {
    const result = applyShiftEdits(shifts, [sam, maria, jake, ana], staff, NOTE);
    expect(result.rejected).toEqual([]);
    expect(result.shifts).toEqual([
      { staffId: "ana", station: "host", start: "17:00", end: "22:00" },
      { staffId: "jake", station: "server", start: "16:00", end: "20:00" },
      { staffId: "jake", station: "bartender", start: "20:00", end: "00:40" },
      { staffId: "maria", station: "server", start: "17:00", end: "21:00" },
    ]);
    expect(result.applied.map((a) => a.said)).toEqual([
      "Sam is off tonight's schedule",
      "Maria left at 21:00",
      "Jake moved to bartender at 20:00",
      "Ana worked host 17:00 to 22:00",
    ]);
  });

  it("keeps earlier shifts when someone leaves after midnight", () => {
    const split = applyShiftEdits(shifts, [jake], staff, NOTE).shifts;
    const left = applyShiftEdits(
      split,
      [edit({ kind: "end", staffId: "jake", at: "00:10", quote: "Jake covered bar after 8 and closed" })],
      staff,
      NOTE,
    );
    expect(left.shifts.filter((s) => s.staffId === "jake")).toEqual([
      { staffId: "jake", station: "server", start: "16:00", end: "20:00" },
      { staffId: "jake", station: "bartender", start: "20:00", end: "00:10" },
    ]);
  });

  it("lets someone stay past the posted end", () => {
    const result = applyShiftEdits(shifts, [{ ...maria, at: "23:45" }], staff, NOTE);
    expect(result.shifts.find((s) => s.staffId === "maria")?.end).toBe("23:45");
  });

  it("stores times in full HH:MM form", () => {
    const result = applyShiftEdits(shifts, [{ ...ana, start: "9:00", end: "14:00" }], staff, NOTE);
    expect(result.shifts.find((s) => s.staffId === "ana")?.start).toBe("09:00");
  });

  it("rejects a quote that isn't in the note, and keeps going", () => {
    const made_up = { ...maria, quote: "Maria left early with a headache" };
    const result = applyShiftEdits(shifts, [made_up, sam], staff, NOTE);
    expect(result.rejected).toEqual([{ edit: made_up, reason: expect.stringContaining("isn't in the note") }]);
    expect(result.applied).toHaveLength(1);
  });

  it("rejects unknown people, bad times and impossible edits", () => {
    const cases: [ShiftEdit, string][] = [
      [{ ...sam, staffId: "zoe" }, 'id "zoe"'],
      [{ ...maria, at: "9pm" }, "HH:MM"],
      [{ ...maria, at: "15:00" }, "before their shift started"],
      [{ ...jake, at: "02:00" }, "wasn't working at 02:00"],
      [{ ...ana, start: "16:00", end: "18:00", staffId: "maria" }, "two shifts at once"],
      [edit({ kind: "start", staffId: "maria", at: "23:30", quote: "Maria cut at 9" }), "after the shift ends"],
      [{ ...ana, start: "17:00", end: "17:00" }, "no length"],
    ];
    for (const [bad, reason] of cases) {
      const result = applyShiftEdits(shifts, [bad], staff, NOTE);
      expect(result.rejected[0]?.reason, reason).toContain(reason);
      expect(result.shifts).toEqual(
        [...shifts].sort((a, b) => a.staffId.localeCompare(b.staffId)),
      );
    }
  });
});

import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { getShifts, getStaff, LUCIAS, openDb, SATURDAY } from "@/lib/db";
import { applyShiftNote } from "./shifts";

const NOTE = "Sam called out sick. Maria cut at 9. Jake covered bar after 8.";

describe("applyShiftNote", () => {
  it("turns Saturday's note at Lucia's into checked schedule edits", async () => {
    const d = openDb(":memory:");
    const staff = getStaff(d, LUCIAS);
    const shifts = getShifts(d, SATURDAY);
    const edits = [
      { kind: "absent", staffId: "sam", at: null, station: null, start: null, end: null, quote: "Sam called out sick" },
      { kind: "end", staffId: "maria", at: "21:00", station: null, start: null, end: null, quote: "Maria cut at 9" },
      { kind: "move", staffId: "jake", at: "20:00", station: "bartender", start: null, end: null, quote: "Jake covered bar after 8" },
      // A made-up edit the checks must catch.
      { kind: "end", staffId: "omar", at: "22:00", station: null, start: null, end: null, quote: "Omar left at 10" },
    ];
    const m = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify({ edits }) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      },
    });

    const result = await applyShiftNote(NOTE, staff, shifts, m);

    const prompt = JSON.stringify(m.doGenerateCalls[0].prompt);
    expect(prompt).toContain("Maria Lopez, id maria, server");
    expect(prompt).toContain("Jake Park (jake): server 16:00 to 00:40");
    expect(result.applied.map((a) => a.said)).toEqual([
      "Sam Okafor is off tonight's schedule",
      "Maria Lopez left at 9:00",
      "Jake Park moved to bartender at 8:00",
    ]);
    expect(result.rejected.map((r) => r.reason)).toEqual(['"Omar left at 10" isn\'t in the note.']);
    expect(result.shifts.some((s) => s.staffId === "sam")).toBe(false);
  });
});

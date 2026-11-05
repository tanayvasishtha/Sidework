import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { getCloseout, saveShiftEdits, takeOut } from "@/lib/closeout";
import { openDb, SATURDAY } from "@/lib/db";
import { applyShiftEdits } from "@/lib/schedule/edits";
import { shiftMinutes } from "@/lib/rules";
import { runSplitCheck } from "./splitcheck";

function reading(d: ReturnType<typeof openDb>, change: (rate: number, station: string) => number = (r) => r) {
  const c = getCloseout(d, SATURDAY);
  const rates = c.restaurant.policy.pointsPerHour;
  return {
    people: c.split.map((s) => ({
      staffId: s.staffId,
      stations: c.people
        .find((p) => p.id === s.staffId)!
        .shifts.map((sh) => ({
          station: sh.station,
          minutes: shiftMinutes(sh),
          pointsPerHour: change(rates[sh.station] ?? 0, sh.station),
        })),
    })),
  };
}

function answering(body: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(body) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

function readyNight() {
  const d = openDb(":memory:");
  takeOut(d, SATURDAY, "dave", "FLSA-MGR");
  return d;
}

describe("runSplitCheck", () => {
  it("passes when the agent's reading lands on the engine's cents", async () => {
    const d = readyNight();
    const m = answering(reading(d));
    const check = await runSplitCheck(d, SATURDAY, m);

    expect(check).toEqual({ status: "match", differences: [], accepted: false });
    expect(getCloseout(d, SATURDAY).check?.status).toBe("match");

    const prompt = JSON.stringify(m.doGenerateCalls[0].prompt);
    expect(prompt).toContain("Servers get 1 point an hour");
    expect(prompt).toContain("Dave Marsh: Managers and supervisors");
    expect(prompt).toContain("Maria Lopez (maria): server 17:00 to 23:00");
  });

  it("shows both numbers when the agent reads a rate differently", async () => {
    const d = readyNight();
    const check = await runSplitCheck(d, SATURDAY, answering(reading(d, (r, station) => (station === "bartender" ? 1 : r))));

    expect(check.status).toBe("mismatch");
    const tasha = check.differences.find((x) => x.staffId === "tasha")!;
    expect(tasha.name).toBe("Tasha Reed");
    expect(tasha.proposedCents).toBeLessThan(tasha.checkedCents);
  });

  it("notes when the agent can't be reached, so the engine stands alone", async () => {
    const d = readyNight();
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("down");
      },
    });
    expect((await runSplitCheck(d, SATURDAY, broken)).status).toBe("unavailable");
  });

  it("stops vouching for a split once the split changes", async () => {
    const d = readyNight();
    await runSplitCheck(d, SATURDAY, answering(reading(d)));

    const c = getCloseout(d, SATURDAY);
    const note = "Maria cut at 9.";
    const result = applyShiftEdits(
      c.people.flatMap((p) => p.shifts),
      [{ kind: "end", staffId: "maria", at: "21:00", station: null, start: null, end: null, quote: "Maria cut at 9" }],
      c.people,
      note,
    );
    saveShiftEdits(d, SATURDAY, note, result);
    expect(getCloseout(d, SATURDAY).check).toBeNull();
  });

  it("won't run while the pool still has a problem", async () => {
    await expect(runSplitCheck(openDb(":memory:"), SATURDAY, answering({ people: [] }))).rejects.toThrow("Fix the problems");
  });
});

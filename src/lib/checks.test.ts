import { describe, expect, it } from "vitest";
import { takeOut } from "@/lib/closeout";
import { openDb, SATURDAY } from "@/lib/db";
import { checkToken, getWorkerCheck, readCheckToken } from "./checks";

const SECRET = "a-test-secret-long-enough";

describe("check links", () => {
  it("round-trips a night and a person", () => {
    const token = checkToken(SATURDAY, "maria", SECRET);
    expect(readCheckToken(token, SECRET)).toEqual({ nightId: SATURDAY, staffId: "maria" });
  });

  it("refuses a link that was changed or signed with another secret", () => {
    const token = checkToken(SATURDAY, "maria", SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(`${SATURDAY}|jake`).toString("base64url")}.${sig}`;
    expect(readCheckToken(forged, SECRET)).toBeNull();
    expect(readCheckToken(token, "another-secret-entirely")).toBeNull();
    expect(readCheckToken("nonsense", SECRET)).toBeNull();
  });
});

describe("getWorkerCheck", () => {
  it("shows Maria how tonight was figured and her year so far", () => {
    const d = openDb(":memory:");
    takeOut(d, SATURDAY, "dave", "FLSA-MGR");
    const check = getWorkerCheck(d, SATURDAY, "maria")!;

    expect(check.person.name).toBe("Maria Lopez");
    expect(check.stations).toEqual([{ station: "server", minutes: 360, pointsPerHour: 1 }]);
    expect(check.share?.cents).toBeGreaterThan(0);
    expect(check.pool.people).toBe(13);
    expect(check.occupation).toEqual({ code: 102, title: "Wait staff" });
    expect(check.serial).toMatch(/^\d{4}$/);

    // Tonight isn't paid yet, so the year total is only past nights.
    expect(check.year.includesTonight).toBe(false);
    expect(check.year.qualifiedCents).toBeGreaterThan(500000);
    expect(check.previous).toMatchObject({ date: "2026-11-06", minutes: 390 });
  });

  it("tells Dave why he wasn't in the pool", () => {
    const d = openDb(":memory:");
    takeOut(d, SATURDAY, "dave", "FLSA-MGR");
    const check = getWorkerCheck(d, SATURDAY, "dave")!;
    expect(check.share).toBeNull();
    expect(check.outReason).toBe("Managers and supervisors can't receive money from a tip pool.");
  });

  it("doesn't show Dave a share while the manager flag is open", () => {
    const check = getWorkerCheck(openDb(":memory:"), SATURDAY, "dave")!;
    expect(check.share).toBeNull();
    expect(check.outReason).toContain("hasn't settled this yet");
  });

  it("marks a share provisional while someone else's flag is open", () => {
    const d = openDb(":memory:");
    expect(getWorkerCheck(d, SATURDAY, "maria")?.provisional).toBe(true);
    takeOut(d, SATURDAY, "dave", "FLSA-MGR");
    expect(getWorkerCheck(d, SATURDAY, "maria")?.provisional).toBe(false);
  });

  it("returns nothing for a night that no longer exists", () => {
    expect(getWorkerCheck(openDb(":memory:"), "lucias-1999-01-01", "maria")).toBeNull();
  });

  it("returns nothing for someone who doesn't work there", () => {
    expect(getWorkerCheck(openDb(":memory:"), SATURDAY, "nobody")).toBeNull();
  });
});

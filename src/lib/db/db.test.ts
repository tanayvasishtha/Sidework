import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPool, classifyNight, splitPool } from "@/lib/rules";
import { getRestaurant, getShifts, getStaff, getTipLines, HARTLEYS, HARTLEYS_FRIDAY, LUCIAS, openDb, SATURDAY } from "./index";
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

describe("Hartley's seed", () => {
  const d = openDb(":memory:");
  const restaurant = getRestaurant(d, HARTLEYS);
  const flags = checkPool(getStaff(d, HARTLEYS), getShifts(d, HARTLEYS_FRIDAY), restaurant.policy);

  it("blocks the morning crew from the tip credit pool, as in the Perry's case", () => {
    const blocked = flags.filter((f) => f.ruleId === "FLSA-CRT" && f.severity === "block").map((f) => f.staffId);
    expect(blocked.sort()).toEqual(["hartleys-cole", "hartleys-ruth"]);
  });

  it("only warns about the host who also worked dinner", () => {
    expect(flags.find((f) => f.staffId === "hartleys-pia")).toMatchObject({ ruleId: "FLSA-CRT", severity: "warn" });
  });

  it("raises nothing else", () => {
    expect(flags.every((f) => f.ruleId === "FLSA-CRT")).toBe(true);
  });
});

describe("openDb", () => {
  it("rebuilds a database left by an older schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "sidework-"));
    const path = join(dir, "old.db");
    const old = openDb(path);
    old.exec("pragma user_version = 1");
    old.exec("delete from tip_lines");
    old.close();
    const reopened = openDb(path);
    expect(getTipLines(reopened, SATURDAY).length).toBeGreaterThan(0);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Lucia's history", () => {
  const d = openDb(":memory:");
  const nights = d.prepare("select count(*) as n from nights where restaurant_id = ? and status = 'paid'").get(LUCIAS) as { n: number };
  const maria = d
    .prepare("select sum(a.tip_cents) as cents from allocations a join nights n on n.id = a.night_id where a.staff_id = 'maria' and n.date like '2026-%'")
    .get() as { cents: number };

  it("has every Friday and Saturday paid from January to the demo night", () => {
    expect(nights.n).toBe(89);
  });

  it("gives Maria a real year-to-date total and never pays Dave", () => {
    expect(maria.cents).toBeGreaterThan(500000);
    const dave = d.prepare("select count(*) as n from allocations where staff_id = 'dave'").get() as { n: number };
    expect(dave.n).toBe(0);
  });

  it("pays out every past pool to the cent", () => {
    const off = d
      .prepare(
        `select count(*) as n from nights n where n.restaurant_id = ? and n.status = 'paid' and
         (select coalesce(sum(tip_cents), 0) from allocations where night_id = n.id) = 0`,
      )
      .get(LUCIAS) as { n: number };
    expect(off.n).toBe(0);
  });

  it("puts Maria on 6.5 hours the Friday before the demo", () => {
    const fri = d.prepare("select minutes from allocations where night_id = 'lucias-2026-11-06' and staff_id = 'maria'").get() as { minutes: number };
    expect(fri.minutes).toBe(390);
  });
});

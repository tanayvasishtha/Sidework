import type { DatabaseSync } from "node:sqlite";
import { getRestaurant, getStaff, getTipLines, type Restaurant, type Staff } from "@/lib/db";
import {
  checkOccupationCodes,
  checkPool,
  classifyNight,
  type Flag,
  RULES,
  type RuleInfo,
  type Shift,
  shiftMinutes,
  splitPool,
} from "@/lib/rules";
import type { EditResult } from "@/lib/schedule/edits";
import { hours } from "@/lib/format";

export type NightShift = Shift & { edited: boolean };

export type CloseoutFlag = Flag & { rule: RuleInfo; staffName?: string; resolved: boolean };

export type Share = {
  staffId: string;
  name: string;
  title: string;
  cents: number;
  minutes: number;
  /** "4 hrs floor, 4.7 hrs bar" */
  detail: string;
  wallet: Staff["payoutWallet"];
};

export type Closeout = {
  restaurant: Restaurant;
  night: { id: string; date: string; status: string };
  people: (Staff & { shifts: NightShift[] })[];
  money: {
    lines: { label: string; cents: number }[];
    autoGratuities: { table: string; cents: number; tipOnTopCents: number }[];
    poolCents: number;
    serviceChargeCents: number;
    feeCents: number;
  };
  flags: CloseoutFlag[];
  split: Share[];
  /** Block flags nobody has dealt with. Payment waits until this is zero. */
  blocking: number;
  note: { text: string; applied: string[]; rejected: string[] } | null;
};

const STATION_WORD: Record<string, string> = {
  server: "floor",
  bartender: "bar",
  busser: "bussing",
  runner: "running",
  barback: "barback",
  host: "host stand",
  cook: "kitchen",
  dishwasher: "dish",
  manager: "managing",
};

export function getNightShifts(d: DatabaseSync, nightId: string): NightShift[] {
  const rows = d
    .prepare("select staff_id, station, start, end, edited from shifts where night_id = ? order by start, staff_id")
    .all(nightId) as { staff_id: string; station: Shift["station"]; start: string; end: string; edited: number }[];
  return rows.map((r) => ({ staffId: r.staff_id, station: r.station, start: r.start, end: r.end, edited: r.edited === 1 }));
}

function getNight(d: DatabaseSync, nightId: string) {
  const row = d.prepare("select id, restaurant_id, date, status from nights where id = ?").get(nightId) as
    | { id: string; restaurant_id: string; date: string; status: string }
    | undefined;
  if (!row) throw new Error(`No night with id ${nightId}.`);
  return row;
}

/** Everyone the manager has taken out of the pool tonight, by the rule that required it. */
function resolutions(d: DatabaseSync, nightId: string): Set<string> {
  const rows = d
    .prepare("select rule_id, staff_id from flags where night_id = ? and resolved_at is not null")
    .all(nightId) as { rule_id: string; staff_id: string | null }[];
  return new Set(rows.map((r) => `${r.rule_id}:${r.staff_id ?? ""}`));
}

export function getCloseout(d: DatabaseSync, nightId: string): Closeout {
  const n = getNight(d, nightId);
  const restaurant = getRestaurant(d, n.restaurant_id);
  const staff = getStaff(d, n.restaurant_id);
  const shifts = getNightShifts(d, nightId);
  const lines = getTipLines(d, nightId);
  const byId = new Map(staff.map((s) => [s.id, s]));

  const money = classifyNight(lines, restaurant.policy);
  const resolved = resolutions(d, nightId);

  const poolFlags = checkPool(staff, shifts, restaurant.policy);
  const excluded = new Set(
    poolFlags.filter((f) => f.severity === "block" && f.staffId && resolved.has(`${f.ruleId}:${f.staffId}`)).map((f) => f.staffId!),
  );
  const split = splitPool(money.tipPoolCents, shifts, restaurant.policy, excluded);
  const codeFlags = checkOccupationCodes(staff, split.map((a) => a.staffId));

  const flags: CloseoutFlag[] = [...poolFlags, ...codeFlags, ...money.flags].map((f) => ({
    ...f,
    rule: RULES[f.ruleId],
    staffName: f.staffId ? byId.get(f.staffId)?.name : undefined,
    resolved: resolved.has(`${f.ruleId}:${f.staffId ?? ""}`),
  }));

  const sum = (pick: (l: (typeof lines)[number]) => boolean) =>
    lines.filter(pick).reduce((total, l) => total + l.tipCents + (l.guestCouldChangeAutoGratuity ? l.autoGratuityCents : 0), 0);

  const people = staff
    .map((s) => ({ ...s, shifts: shifts.filter((sh) => sh.staffId === s.id) }))
    .filter((p) => p.shifts.length > 0)
    .sort((a, b) => a.shifts[0].start.localeCompare(b.shifts[0].start) || a.name.localeCompare(b.name));

  const shares: Share[] = split
    .map((a) => {
      const person = byId.get(a.staffId)!;
      const byStation = new Map<string, number>();
      for (const sh of shifts.filter((x) => x.staffId === a.staffId && (restaurant.policy.pointsPerHour[x.station] ?? 0) > 0)) {
        byStation.set(sh.station, (byStation.get(sh.station) ?? 0) + shiftMinutes(sh));
      }
      const detail = [...byStation].map(([station, mins]) => `${hours(mins)} ${STATION_WORD[station] ?? station}`).join(", ");
      return {
        staffId: a.staffId,
        name: person.name,
        title: person.title,
        cents: a.cents,
        minutes: a.minutes,
        detail,
        wallet: person.payoutWallet,
      };
    })
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const latest = d
    .prepare("select note, applied, rejected from shift_notes where night_id = ? order by id desc limit 1")
    .get(nightId) as { note: string; applied: string; rejected: string } | undefined;

  return {
    restaurant,
    night: { id: n.id, date: n.date, status: n.status },
    people,
    money: {
      lines: [
        { label: "Card and PayPal tips", cents: sum((l) => l.source === "card" || l.source === "paypal") },
        { label: "Venmo tips", cents: sum((l) => l.source === "venmo") },
        { label: "Cash tips", cents: sum((l) => l.source === "cash") },
      ].filter((l) => l.cents > 0),
      autoGratuities: lines
        .filter((l) => l.autoGratuityCents > 0 && !l.guestCouldChangeAutoGratuity)
        .map((l) => ({ table: l.table, cents: l.autoGratuityCents, tipOnTopCents: l.tipCents })),
      poolCents: money.tipPoolCents,
      serviceChargeCents: money.serviceChargeCents,
      feeCents: money.feeCents,
    },
    flags,
    split: shares,
    blocking: flags.filter((f) => f.severity === "block" && !f.resolved).length,
    note: latest
      ? { text: latest.note, applied: JSON.parse(latest.applied) as string[], rejected: JSON.parse(latest.rejected) as string[] }
      : null,
  };
}

/** The manager's fix for a block flag: this person comes out of tonight's pool. */
export function takeOut(d: DatabaseSync, nightId: string, staffId: string, ruleId: Flag["ruleId"]): void {
  const flag = getCloseout(d, nightId).flags.find((f) => f.staffId === staffId && f.ruleId === ruleId && f.severity === "block");
  if (!flag) throw new Error(`There's no ${ruleId} block on ${staffId} tonight.`);
  if (flag.resolved) return;
  d.prepare(
    "insert into flags (night_id, rule_id, staff_id, severity, message, resolved_at) values (?, ?, ?, 'block', ?, ?)",
  ).run(nightId, ruleId, staffId, flag.message, new Date().toISOString());
}

/** Replaces tonight's shifts with the edited schedule, marking what changed, and keeps the note. */
export function saveShiftEdits(d: DatabaseSync, nightId: string, note: string, result: EditResult): void {
  const key = (s: Shift) => `${s.staffId}|${s.station}|${s.start}|${s.end}`;
  const before = new Map(getNightShifts(d, nightId).map((s) => [key(s), s.edited]));
  d.exec("begin");
  try {
    d.prepare("delete from shifts where night_id = ?").run(nightId);
    const add = d.prepare("insert into shifts (night_id, staff_id, station, start, end, edited) values (?, ?, ?, ?, ?, ?)");
    for (const s of result.shifts) {
      const edited = before.has(key(s)) ? before.get(key(s)) : true;
      add.run(nightId, s.staffId, s.station, s.start, s.end, edited ? 1 : 0);
    }
    d.prepare("insert into shift_notes (night_id, note, applied, rejected, created_at) values (?, ?, ?, ?, ?)").run(
      nightId,
      note,
      JSON.stringify(result.applied.map((a) => a.said)),
      JSON.stringify(result.rejected.map((r) => r.reason)),
      new Date().toISOString(),
    );
    d.exec("commit");
  } catch (err) {
    d.exec("rollback");
    throw err;
  }
}

export function listNights(d: DatabaseSync): { id: string; restaurant: string; date: string }[] {
  return d
    .prepare(
      "select n.id, r.name as restaurant, n.date from nights n join restaurants r on r.id = n.restaurant_id order by n.date desc, r.name",
    )
    .all() as { id: string; restaurant: string; date: string }[];
}

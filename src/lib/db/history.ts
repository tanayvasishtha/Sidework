import type { DatabaseSync } from "node:sqlite";
import { classifyNight, type Shift, splitPool, type TipLine } from "@/lib/rules";
import { LUCIAS } from "./seed";

// Every Friday and Saturday at Lucia's from the first weekend of 2026 up to
// the demo night, already paid. Generated from a fixed seed, so every run of
// the demo shows the same year-to-date numbers.

export const FIRST_NIGHT = "2026-01-02";
export const LAST_HISTORY_NIGHT = "2026-11-06";

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weekendNights(): string[] {
  const out: string[] = [];
  for (let d = new Date(`${FIRST_NIGHT}T12:00:00Z`); d <= new Date(`${LAST_HISTORY_NIGHT}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day === 5 || day === 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const START: Record<string, string[]> = {
  server: ["16:00", "17:00", "17:00", "18:00"],
  bartender: ["16:00", "18:00"],
  barback: ["18:00"],
  busser: ["17:00", "18:00"],
  runner: ["17:00"],
  host: ["17:00"],
  cook: ["16:00"],
  dishwasher: ["17:00"],
};

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function seedLuciasHistory(db: DatabaseSync): void {
  const existing = db.prepare("select count(*) as n from nights where restaurant_id = ? and date < ?").get(LUCIAS, LAST_HISTORY_NIGHT) as { n: number };
  if (existing.n > 0) return;

  const r = db.prepare("select points_per_hour, takes_tip_credit, card_fee_rate from restaurants where id = ?").get(LUCIAS) as {
    points_per_hour: string;
    takes_tip_credit: number;
    card_fee_rate: number;
  };
  const policy = { pointsPerHour: JSON.parse(r.points_per_hour), takesTipCredit: r.takes_tip_credit === 1, cardFeeRate: r.card_fee_rate };
  // Managers never share, so they're left out of every past night too.
  const staff = db.prepare("select id, role from staff where restaurant_id = ? and manager_duties = 0").all(LUCIAS) as {
    id: string;
    role: string;
  }[];

  const addNight = db.prepare("insert into nights (id, restaurant_id, date, status) values (?, ?, ?, 'paid')");
  const addShift = db.prepare("insert into shifts (night_id, staff_id, station, start, end) values (?, ?, ?, ?, ?)");
  const addTip = db.prepare(
    `insert into tip_lines (id, night_id, source, table_label, tip_cents, auto_gratuity_cents, guest_could_change_auto)
     values (?, ?, ?, ?, ?, ?, 0)`,
  );
  const addAllocation = db.prepare(
    `insert into allocations (night_id, staff_id, minutes, points, tip_cents, service_charge_cents, remainder_cents)
     values (?, ?, ?, ?, ?, 0, ?)`,
  );

  const rand = random(20260102);
  db.exec("begin");
  try {
    for (const date of weekendNights()) {
      const nightId = `${LUCIAS}-${date}`;
      const saturday = new Date(`${date}T12:00:00Z`).getUTCDay() === 6;
      addNight.run(nightId, LUCIAS, date);

      const shifts: Shift[] = [];
      for (const p of staff) {
        const special = date === LAST_HISTORY_NIGHT && p.id === "maria";
        if (!special && rand() > 0.82) continue;
        const starts = START[p.role] ?? ["17:00"];
        const start = special ? "17:00" : starts[Math.floor(rand() * starts.length)];
        const length = special ? 390 : 300 + Math.floor(rand() * 7) * 30;
        const shift = { staffId: p.id, station: p.role as Shift["station"], start, end: addMinutes(start, length) };
        shifts.push(shift);
        addShift.run(nightId, shift.staffId, shift.station, shift.start, shift.end);
      }

      // Busier on Saturdays and toward the holidays.
      const month = Number(date.slice(5, 7));
      const season = 1 + (month >= 11 ? 0.12 : month <= 2 ? -0.1 : 0);
      const tips = Math.round((saturday ? 2050 : 1750) * season * (0.85 + rand() * 0.3) * 100);
      const lines: (TipLine & { table: string })[] = [
        { id: `${nightId}-card`, source: "card", table: "cards", tipCents: Math.round(tips * 0.52), autoGratuityCents: 0, guestCouldChangeAutoGratuity: false },
        { id: `${nightId}-paypal`, source: "paypal", table: "paypal", tipCents: Math.round(tips * 0.17), autoGratuityCents: 0, guestCouldChangeAutoGratuity: false },
        { id: `${nightId}-venmo`, source: "venmo", table: "venmo", tipCents: Math.round(tips * 0.19), autoGratuityCents: 0, guestCouldChangeAutoGratuity: false },
      ];
      lines.push({
        id: `${nightId}-cash`,
        source: "cash",
        table: "cash",
        tipCents: tips - lines.reduce((t, l) => t + l.tipCents, 0),
        autoGratuityCents: 0,
        guestCouldChangeAutoGratuity: false,
      });
      if (rand() < 0.3) {
        const bill = 60000 + Math.floor(rand() * 9) * 10000;
        lines.push({
          id: `${nightId}-party`,
          source: "paypal",
          table: "party",
          tipCents: rand() < 0.4 ? 2000 : 0,
          autoGratuityCents: Math.round(bill * 0.18),
          guestCouldChangeAutoGratuity: false,
        });
      }
      for (const l of lines) addTip.run(l.id, nightId, l.source, l.table, l.tipCents, l.autoGratuityCents);

      const money = classifyNight(lines, policy);
      for (const a of splitPool(money.tipPoolCents, shifts, policy)) {
        addAllocation.run(nightId, a.staffId, a.minutes, a.points, a.cents, a.remainderCents);
      }
    }
    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

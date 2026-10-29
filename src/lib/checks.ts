import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getCloseout, type Share } from "@/lib/closeout";
import { getNightPayout, type PayoutRow } from "@/lib/pay";
import { occupationCode, type Role, shiftMinutes } from "@/lib/rules";

/** The federal cap on the qualified tips deduction, per return, 2025 to 2028. */
export const DEDUCTION_CAP_CENTS = 2_500_000;

/** A private link per person per night. The signature stops anyone guessing someone else's. */
export function checkToken(nightId: string, staffId: string, secret: string): string {
  const body = Buffer.from(`${nightId}|${staffId}`).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readCheckToken(token: string, secret: string): { nightId: string; staffId: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [nightId, staffId] = Buffer.from(body, "base64url").toString().split("|");
  return nightId && staffId ? { nightId, staffId } : null;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url").slice(0, 22);
}

export type WorkerCheck = {
  restaurant: { name: string; state: string };
  night: { id: string; date: string; paid: boolean };
  person: { id: string; name: string; title: string; role: Role; wallet: "VENMO" | "PAYPAL" };
  /** Four digits printed in red, like the serial on a paper guest check. */
  serial: string;
  stations: { station: Role; minutes: number; pointsPerHour: number }[];
  share: Share | null;
  /** Why they weren't in tonight's pool, when they weren't. */
  outReason: string | null;
  pool: { cents: number; points: number; feeCents: number; people: number };
  payout: (PayoutRow & { sentAt: string }) | null;
  year: { qualifiedCents: number; includesTonight: boolean; nights: number };
  occupation: { code: number; title: string } | null;
  previous: { date: string; cents: number; minutes: number; poolCents: number } | null;
};

export function getWorkerCheck(d: DatabaseSync, nightId: string, staffId: string): WorkerCheck | null {
  const c = getCloseout(d, nightId);
  const person = c.people.find((p) => p.id === staffId) ?? null;
  const staffRow = d.prepare("select id, name, title, role, payout_wallet from staff where id = ?").get(staffId) as
    | { id: string; name: string; title: string; role: Role; payout_wallet: "VENMO" | "PAYPAL" }
    | undefined;
  if (!staffRow) return null;

  const out = c.flags.find((f) => f.staffId === staffId && f.severity === "block");
  // A blocked person's line in the split isn't theirs to count on, settled or not.
  const share = out ? null : (c.split.find((s) => s.staffId === staffId) ?? null);
  const policy = c.restaurant.policy;

  const byStation = new Map<Role, number>();
  for (const s of person?.shifts ?? []) {
    if ((policy.pointsPerHour[s.station] ?? 0) <= 0) continue;
    byStation.set(s.station, (byStation.get(s.station) ?? 0) + shiftMinutes(s));
  }

  const payout = getNightPayout(d, nightId);
  const item = payout && payout.status !== "FAILED" ? payout.items.find((i) => i.staffId === staffId) : undefined;

  const year = c.night.date.slice(0, 4);
  const ytd = d
    .prepare(
      `select coalesce(sum(a.tip_cents), 0) as cents, count(*) as nights from allocations a join nights n on n.id = a.night_id
       where a.staff_id = ? and n.status = 'paid' and n.date like ? and n.date <= ?`,
    )
    .get(staffId, `${year}-%`, c.night.date) as { cents: number; nights: number };
  const tonightPaid = c.night.status === "paid";

  const prev = d
    .prepare(
      `select n.date, a.tip_cents as cents, a.minutes,
              (select sum(tip_cents) from allocations where night_id = n.id) as pool
       from allocations a join nights n on n.id = a.night_id
       where a.staff_id = ? and n.restaurant_id = ? and n.date < ? order by n.date desc limit 1`,
    )
    .get(staffId, c.restaurant.id, c.night.date) as { date: string; cents: number; minutes: number; pool: number } | undefined;

  const serialNumber = parseInt(createHash("sha256").update(`${nightId}|${staffId}`).digest("hex").slice(0, 6), 16) % 10000;

  return {
    restaurant: { name: c.restaurant.name, state: c.restaurant.state },
    night: { id: c.night.id, date: c.night.date, paid: tonightPaid },
    person: { id: staffRow.id, name: staffRow.name, title: staffRow.title, role: staffRow.role, wallet: staffRow.payout_wallet },
    serial: String(serialNumber).padStart(4, "0"),
    stations: [...byStation].map(([station, minutes]) => ({ station, minutes, pointsPerHour: policy.pointsPerHour[station] ?? 0 })),
    share,
    outReason: out ? (out.resolved ? `${out.rule.title}.` : `${out.rule.title}. The manager hasn't settled this yet.`) : null,
    pool: {
      cents: c.money.poolCents,
      points: Math.round(c.split.reduce((t, s) => t + s.points, 0) * 10) / 10,
      feeCents: c.money.feeCents,
      people: c.split.length,
    },
    payout: item && payout ? { ...item, sentAt: payout.createdAt } : null,
    // Tonight counts once it's paid. Until then it's shown on its own.
    year: { qualifiedCents: ytd.cents, includesTonight: tonightPaid, nights: ytd.nights },
    occupation: occupationCode(staffRow.role) ?? null,
    previous: prev ? { date: prev.date, cents: prev.cents, minutes: prev.minutes, poolCents: prev.pool } : null,
  };
}

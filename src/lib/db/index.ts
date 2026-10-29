import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Policy, Role, Shift, StaffMember, TipLine } from "@/lib/rules";
import { settings } from "@/lib/settings";
import { seedHartleys } from "./hartleys";
import { SCHEMA, SCHEMA_VERSION, TABLES } from "./schema";
import { seedLucias } from "./seed";

export { HARTLEYS, HARTLEYS_FRIDAY } from "./hartleys";
export { LUCIAS, SATURDAY } from "./seed";

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const { user_version: version } = db.prepare("pragma user_version").get() as { user_version: number };
  if (version !== SCHEMA_VERSION) {
    for (const table of TABLES) db.exec(`drop table if exists ${table}`);
    db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
  }
  db.exec("pragma foreign_keys = on");
  db.exec(SCHEMA);
  seedLucias(db);
  seedHartleys(db);
  return db;
}

let shared: DatabaseSync | undefined;

export function db(): DatabaseSync {
  shared ??= openDb(settings().DATABASE_PATH);
  return shared;
}

/** Puts the demo back to the seeded nights, before any notes, fixes or payouts. */
export function resetDemo(): void {
  const d = db();
  for (const table of TABLES) d.exec(`drop table if exists ${table}`);
  d.exec(SCHEMA);
  seedLucias(d);
  seedHartleys(d);
}

export type Restaurant = { id: string; name: string; state: string; policy: Policy; policyText: string };

export type Staff = StaffMember & {
  title: string;
  payoutWallet: "VENMO" | "PAYPAL";
  payoutReceiver: string;
};

export function getRestaurant(d: DatabaseSync, id: string): Restaurant {
  const row = d.prepare("select * from restaurants where id = ?").get(id) as
    | {
        id: string; name: string; state: string; takes_tip_credit: number; card_fee_rate: number; points_per_hour: string;
        service_open: string | null; service_close: string | null; policy_text: string;
      }
    | undefined;
  if (!row) throw new Error(`No restaurant with id ${id}.`);
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    policyText: row.policy_text,
    policy: {
      pointsPerHour: JSON.parse(row.points_per_hour) as Policy["pointsPerHour"],
      takesTipCredit: row.takes_tip_credit === 1,
      cardFeeRate: row.card_fee_rate,
      serviceHours: row.service_open && row.service_close ? { open: row.service_open, close: row.service_close } : undefined,
    },
  };
}

export function getStaff(d: DatabaseSync, restaurantId: string): Staff[] {
  const rows = d.prepare("select * from staff where restaurant_id = ? order by name").all(restaurantId) as {
    id: string; name: string; title: string; role: Role; manager_duties: number; payout_wallet: "VENMO" | "PAYPAL"; payout_receiver: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    role: r.role,
    managerDuties: r.manager_duties === 1,
    payoutWallet: r.payout_wallet,
    payoutReceiver: r.payout_receiver,
  }));
}

export function getShifts(d: DatabaseSync, nightId: string): Shift[] {
  return d
    .prepare("select staff_id as staffId, station, start, end from shifts where night_id = ? order by start, staff_id")
    .all(nightId) as Shift[];
}

export function getTipLines(d: DatabaseSync, nightId: string): (TipLine & { table: string })[] {
  const rows = d.prepare("select * from tip_lines where night_id = ? order by rowid").all(nightId) as {
    id: string; source: TipLine["source"]; table_label: string; tip_cents: number; auto_gratuity_cents: number; guest_could_change_auto: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    table: r.table_label,
    label: r.table_label.startsWith("bar") ? `Bar tab ${r.table_label.slice(4)}` : `Table ${r.table_label}`,
    tipCents: r.tip_cents,
    autoGratuityCents: r.auto_gratuity_cents,
    guestCouldChangeAutoGratuity: r.guest_could_change_auto === 1,
  }));
}

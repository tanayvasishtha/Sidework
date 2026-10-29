import type { DatabaseSync } from "node:sqlite";
import type { Role } from "@/lib/rules";

export const LUCIAS = "lucias";
export const SATURDAY = "lucias-2026-11-08";

type SeedStaff = {
  id: string;
  name: string;
  title: string;
  role: Role;
  managerDuties: boolean;
  wallet: "VENMO" | "PAYPAL";
};

// Dave picks up tables, but he writes the schedule and can hire,
// which makes him a manager under federal law whatever his title says.
const STAFF: SeedStaff[] = [
  { id: "maria", name: "Maria Lopez", title: "Server", role: "server", managerDuties: false, wallet: "VENMO" },
  { id: "jake", name: "Jake Park", title: "Server", role: "server", managerDuties: false, wallet: "VENMO" },
  { id: "tasha", name: "Tasha Reed", title: "Bartender", role: "bartender", managerDuties: false, wallet: "VENMO" },
  { id: "omar", name: "Omar Haddad", title: "Server", role: "server", managerDuties: false, wallet: "PAYPAL" },
  { id: "priya", name: "Priya Nair", title: "Server", role: "server", managerDuties: false, wallet: "VENMO" },
  { id: "elena", name: "Elena Rossi", title: "Server", role: "server", managerDuties: false, wallet: "PAYPAL" },
  { id: "sam", name: "Sam Okafor", title: "Bartender", role: "bartender", managerDuties: false, wallet: "VENMO" },
  { id: "kofi", name: "Kofi Mensah", title: "Barback", role: "barback", managerDuties: false, wallet: "VENMO" },
  { id: "lin", name: "Lin Chen", title: "Busser", role: "busser", managerDuties: false, wallet: "VENMO" },
  { id: "ben", name: "Ben Carter", title: "Food runner", role: "runner", managerDuties: false, wallet: "PAYPAL" },
  { id: "ana", name: "Ana Ruiz", title: "Host", role: "host", managerDuties: false, wallet: "VENMO" },
  { id: "luis", name: "Luis Ortega", title: "Line cook", role: "cook", managerDuties: false, wallet: "PAYPAL" },
  { id: "rosa", name: "Rosa Diaz", title: "Dishwasher", role: "dishwasher", managerDuties: false, wallet: "VENMO" },
  { id: "dave", name: "Dave Marsh", title: "Floor manager", role: "server", managerDuties: true, wallet: "PAYPAL" },
];

// The schedule as posted. The manager's notes at close change some of it.
const SCHEDULE: [string, Role, string, string][] = [
  ["maria", "server", "17:00", "23:00"],
  ["jake", "server", "16:00", "00:40"],
  ["tasha", "bartender", "18:00", "00:40"],
  ["omar", "server", "18:00", "00:00"],
  ["priya", "server", "17:00", "23:30"],
  ["elena", "server", "16:00", "22:00"],
  ["sam", "bartender", "16:00", "00:40"],
  ["kofi", "barback", "18:00", "00:40"],
  ["lin", "busser", "18:00", "00:40"],
  ["ben", "runner", "17:00", "23:00"],
  ["ana", "host", "17:00", "22:00"],
  ["luis", "cook", "16:00", "23:40"],
  ["rosa", "dishwasher", "17:00", "00:30"],
  ["dave", "server", "16:00", "01:00"],
];

// [table, source, tip in cents]
const TIPS: [string, "paypal" | "venmo" | "card" | "cash", number][] = [
  ["1", "card", 1840], ["2", "paypal", 2600], ["3", "card", 3150], ["4", "venmo", 2200],
  ["5", "card", 4420], ["6", "paypal", 1975], ["7", "paypal", 1633], ["8", "card", 5600],
  ["9", "venmo", 3800], ["10", "card", 2890], ["11", "paypal", 6240], ["14", "card", 3365],
  ["15", "venmo", 4100], ["16", "card", 2210], ["17", "paypal", 3900], ["18", "card", 7150],
  ["19", "venmo", 2650], ["20", "card", 4980], ["21", "paypal", 3325], ["22", "cash", 4000],
  ["23", "card", 6100], ["24", "venmo", 5150], ["25", "paypal", 2745], ["26", "card", 3880],
  ["bar 1", "card", 9600], ["bar 2", "venmo", 4800], ["bar 3", "cash", 6200], ["bar 4", "paypal", 7400],
  ["bar 5", "card", 8150], ["bar 6", "venmo", 3200], ["bar 7", "card", 5375], ["bar 8", "paypal", 4900],
];

export function seedLucias(db: DatabaseSync): void {
  const existing = db.prepare("select count(*) as n from restaurants where id = ?").get(LUCIAS) as { n: number };
  if (existing.n > 0) return;

  db.exec("begin");
  try {
    db.prepare(
      `insert into restaurants (id, name, state, takes_tip_credit, card_fee_rate, points_per_hour, service_open, service_close, policy_text)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      LUCIAS,
      "Lucia's",
      // Texas follows the federal pool rules. New York, for one, bars the kitchen from pools outright.
      "TX",
      0,
      0.029,
      JSON.stringify({ server: 1, bartender: 1.5, barback: 0.5, busser: 0.5, runner: 0.5, host: 0.5, cook: 0.5, dishwasher: 0.5 }),
      "17:00",
      "23:00",
      "All tips go in one pool at close. Servers get 1 point an hour, bartenders 1.5, barbacks, bussers, runners and hosts 0.5. " +
        "The kitchen shares too, 0.5 an hour, since we pay everyone at least $16.50. Managers don't share. " +
        "Card, PayPal and Venmo fees come off the top. Parties of 8 or more get 18% added automatically.",
    );

    const addStaff = db.prepare(
      `insert into staff (id, restaurant_id, name, title, role, manager_duties, payout_wallet, payout_receiver)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of STAFF) {
      addStaff.run(s.id, LUCIAS, s.name, s.title, s.role, s.managerDuties ? 1 : 0, s.wallet, `${s.id}@sidework.test`);
    }

    db.prepare("insert into nights (id, restaurant_id, date, status) values (?, ?, ?, 'open')").run(
      SATURDAY,
      LUCIAS,
      "2026-11-08",
    );

    const addShift = db.prepare("insert into shifts (night_id, staff_id, station, start, end) values (?, ?, ?, ?, ?)");
    for (const [staffId, station, start, end] of SCHEDULE) addShift.run(SATURDAY, staffId, station, start, end);

    const addTip = db.prepare(
      `insert into tip_lines (id, night_id, source, table_label, tip_cents, auto_gratuity_cents, guest_could_change_auto)
       values (?, ?, ?, ?, ?, ?, ?)`,
    );
    TIPS.forEach(([table, source, cents], i) => addTip.run(`${SATURDAY}-${i + 1}`, SATURDAY, source, table, cents, 0, 0));
    // Table 12, a party of nine: 18% added to a $1,000 check, and the guest left $20 more on top.
    addTip.run(`${SATURDAY}-t12`, SATURDAY, "paypal", "12", 2000, 18000, 0);

    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

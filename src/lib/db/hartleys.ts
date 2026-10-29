import type { DatabaseSync } from "node:sqlite";
import type { Role } from "@/lib/rules";

export const HARTLEYS = "hartleys";
export const HARTLEYS_FRIDAY = "hartleys-2026-11-07";

// Built on the facts in Paschal v. Perry's Restaurants (W.D. Tex.): servers at $2.13
// an hour with a tip credit, and a pool that also pays a morning crew who set up and
// clean before any guest arrives. Sidework should refuse to pay this pool as it stands.
const STAFF: [string, string, string, Role, "VENMO" | "PAYPAL"][] = [
  ["grace", "Grace Kim", "Server", "server", "VENMO"],
  ["marcus", "Marcus Bell", "Server", "server", "PAYPAL"],
  ["holly", "Holly Vance", "Server", "server", "VENMO"],
  ["devon", "Devon Price", "Bartender", "bartender", "VENMO"],
  ["tess", "Tess Moreno", "Busser", "busser", "VENMO"],
  ["jules", "Jules Avery", "Host", "host", "PAYPAL"],
  ["ruth", "Ruth Ellis", "Busser, morning crew", "busser", "VENMO"],
  ["cole", "Cole Barrett", "Food runner, morning crew", "runner", "PAYPAL"],
  ["pia", "Pia Laurent", "Host", "host", "VENMO"],
];

const SCHEDULE: [string, Role, string, string][] = [
  ["grace", "server", "16:00", "23:00"],
  ["marcus", "server", "16:00", "23:30"],
  ["holly", "server", "17:00", "23:00"],
  ["devon", "bartender", "16:00", "00:00"],
  ["tess", "busser", "17:00", "23:00"],
  ["jules", "host", "16:00", "22:00"],
  ["ruth", "busser", "09:00", "14:00"],
  ["cole", "runner", "10:00", "15:00"],
  // Sets up in the morning, then hosts the early dinner rush.
  ["pia", "host", "11:00", "15:00"],
  ["pia", "host", "16:00", "19:00"],
];

const TIPS: [string, "paypal" | "venmo" | "card" | "cash", number][] = [
  ["4", "card", 2400], ["5", "paypal", 3150], ["7", "card", 4800], ["8", "venmo", 2750],
  ["11", "card", 6200], ["12", "paypal", 3900], ["14", "card", 5100], ["15", "cash", 4000],
  ["16", "venmo", 3300], ["20", "card", 7450], ["bar 1", "card", 3600], ["bar 2", "venmo", 2900],
];

export function seedHartleys(db: DatabaseSync): void {
  const existing = db.prepare("select count(*) as n from restaurants where id = ?").get(HARTLEYS) as { n: number };
  if (existing.n > 0) return;

  db.exec("begin");
  try {
    db.prepare(
      `insert into restaurants (id, name, state, takes_tip_credit, card_fee_rate, points_per_hour, service_open, service_close, policy_text)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      HARTLEYS,
      "Hartley's Chophouse",
      "TX",
      1,
      0.03,
      JSON.stringify({ server: 1, bartender: 1, busser: 0.5, runner: 0.5, host: 0.5 }),
      "16:00",
      "23:00",
      "All tips go in one pool at close. Servers and bartenders earn 1 point an hour. Bussers, hosts and food runners earn 0.5, " +
        "including the morning crew who set up and clean the dining room before we open at 4pm. " +
        "Servers and bartenders are paid $2.13 an hour plus tips. Card fees come off the top.",
    );

    const addStaff = db.prepare(
      `insert into staff (id, restaurant_id, name, title, role, manager_duties, payout_wallet, payout_receiver)
       values (?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    for (const [id, name, title, role, wallet] of STAFF) {
      addStaff.run(`hartleys-${id}`, HARTLEYS, name, title, role, wallet, `${id}@hartleys.sidework.test`);
    }

    db.prepare("insert into nights (id, restaurant_id, date, status) values (?, ?, ?, 'open')").run(
      HARTLEYS_FRIDAY,
      HARTLEYS,
      "2026-11-07",
    );

    const addShift = db.prepare("insert into shifts (night_id, staff_id, station, start, end) values (?, ?, ?, ?, ?)");
    for (const [id, station, start, end] of SCHEDULE) addShift.run(HARTLEYS_FRIDAY, `hartleys-${id}`, station, start, end);

    const addTip = db.prepare(
      `insert into tip_lines (id, night_id, source, table_label, tip_cents, auto_gratuity_cents, guest_could_change_auto)
       values (?, ?, ?, ?, ?, 0, 0)`,
    );
    TIPS.forEach(([table, source, cents], i) => addTip.run(`${HARTLEYS_FRIDAY}-${i + 1}`, HARTLEYS_FRIDAY, source, table, cents));

    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

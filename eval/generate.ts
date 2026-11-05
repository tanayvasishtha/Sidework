// Writes the labelled scenarios to eval/scenarios/. Run with: npm run eval:generate
// A fixed seed means the same files every time. They are committed so anyone can read them.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Policy, Role, RuleId, Shift, TipLine } from "@/lib/rules";
import type { Category, Scenario } from "./types";

const NAMES = [
  "Ada Morris", "Ben Ortiz", "Cara Lund", "Dev Rao", "Eli Stone", "Fay Wong", "Gus Hale", "Hana Sato", "Ivan Cole", "June Park",
  "Kai Nolan", "Lena Voss", "Milo Reyes", "Nia Grant", "Owen Fitch", "Pia Marsh", "Quinn Adler", "Rae Dunn", "Sol Vega", "Tess Boyd",
];

const TITLES: Record<Role, string> = {
  server: "Server",
  bartender: "Bartender",
  busser: "Busser",
  runner: "Food runner",
  barback: "Barback",
  host: "Host",
  cook: "Line cook",
  dishwasher: "Dishwasher",
  manager: "Manager",
};

const PLURAL: Record<Role, string> = {
  server: "Servers",
  bartender: "Bartenders",
  busser: "Bussers",
  runner: "Food runners",
  barback: "Barbacks",
  host: "Hosts",
  cook: "Cooks",
  dishwasher: "Dishwashers",
  manager: "Managers",
};

function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clockAfter = (start: string, minutes: number) => {
  const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

function base(rand: () => number, tipCredit: boolean, kitchenShares: boolean) {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const pool = [...NAMES].sort(() => rand() - 0.5);
  const roles: Role[] = [
    ...Array<Role>(3 + Math.floor(rand() * 3)).fill("server"),
    ...Array<Role>(1 + Math.floor(rand() * 2)).fill("bartender"),
    "busser",
    "runner",
    "host",
    "cook",
    "dishwasher",
  ];
  if (rand() < 0.5) roles.push("barback");

  const staff = roles.map((role, i) => ({
    id: pool[i].split(" ")[0].toLowerCase(),
    name: pool[i],
    title: TITLES[role],
    role,
    managerDuties: false,
  }));

  const pointsPerHour: Policy["pointsPerHour"] = {
    server: 1,
    bartender: pick([1, 1.25, 1.5]),
    busser: pick([0.5, 0.75]),
    runner: pick([0.5, 0.75]),
    host: 0.5,
    barback: 0.5,
    cook: kitchenShares ? 0.5 : 0,
    dishwasher: kitchenShares ? 0.25 : 0,
  };

  const shifts: Shift[] = staff.map((p) => {
    const start = pick(["16:00", "16:30", "17:00", "17:30", "18:00"]);
    return { staffId: p.id, station: p.role, start, end: clockAfter(start, 240 + Math.floor(rand() * 28) * 10) };
  });

  // Now and then a server jumps on the bar halfway through.
  const mover = shifts.find((s) => s.station === "server");
  if (mover && rand() < 0.4) {
    const handover = clockAfter(mover.start, 120);
    shifts.push({ staffId: mover.staffId, station: "bartender", start: handover, end: mover.end });
    mover.end = handover;
  }

  const lines: TipLine[] = Array.from({ length: 8 + Math.floor(rand() * 17) }, (_, i) => ({
    id: `t${i + 1}`,
    source: pick(["card", "card", "card", "paypal", "venmo", "cash"] as const),
    tipCents: 300 + Math.floor(rand() * 9200),
    autoGratuityCents: 0,
    guestCouldChangeAutoGratuity: false,
  }));

  const policy: Policy = {
    pointsPerHour,
    takesTipCredit: tipCredit,
    cardFeeRate: pick([0, 0.025, 0.029, 0.03]),
    serviceHours: { open: "16:00", close: "23:30" },
  };
  return { staff, shifts, lines, policy, pick };
}

function policyText(policy: Policy, extra = ""): string {
  const earners = (Object.entries(policy.pointsPerHour) as [Role, number][]).filter(([, points]) => points > 0);
  const rates = earners.map(([role, points]) => `${PLURAL[role]} earn ${points} ${points === 1 ? "point" : "points"} an hour.`);
  return [
    "All tips go in one pool at close.",
    ...rates,
    extra,
    policy.takesTipCredit ? "Tipped staff are paid $2.13 an hour plus tips." : "Everyone is paid at least $15 an hour.",
    policy.cardFeeRate > 0 ? `Card, PayPal and Venmo fees of ${(policy.cardFeeRate * 100).toFixed(1)}% come off the top.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const scenarios: Scenario[] = [];

function add(
  category: Category,
  n: number,
  build: (i: number, rand: () => number) => Omit<Scenario, "id" | "category"> & { planted: string },
) {
  for (let i = 0; i < n; i++) {
    const rand = random(hash(`${category}-${i}`));
    scenarios.push({ id: `${category}-${String(i + 1).padStart(2, "0")}`, category, ...build(i, rand) });
  }
}

function hash(text: string): number {
  return [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
}

// Clean nights include traps where a careless check would raise a false alarm.
add("clean", 20, (i, rand) => {
  const trap = i % 5;
  const tipCredit = trap === 0 ? rand() < 0.5 : trap === 1 || trap === 4;
  const s = base(rand, tipCredit, trap === 2);
  let planted = "An ordinary night with no problems.";
  let extra = "";
  if (trap === 1) {
    const lead = s.staff.find((p) => p.role === "server")!;
    lead.title = "Assistant manager";
    planted = "Someone titled assistant manager has no manager duties, so they can share.";
  }
  if (trap === 2) planted = "The kitchen shares and no tip credit is taken, which is legal.";
  if (trap === 3) {
    const crew = s.staff.find((p) => p.role === "busser")!;
    const shift = s.shifts.find((x) => x.staffId === crew.id)!;
    shift.start = "09:00";
    shift.end = "14:00";
    crew.title = "Busser, morning crew";
    extra = "The morning crew shares too.";
    planted = "A morning crew shares, which is legal because no tip credit is taken.";
  }
  if (trap === 4) {
    const dual = s.staff.find((p) => p.role === "server")!;
    s.shifts.push({ staffId: dual.id, station: "cook", start: "10:00", end: "14:00" });
    planted = "A server also works a kitchen shift that earns no points, so the kitchen rule must not fire.";
  }
  return { planted, policy: s.policy, policyText: policyText(s.policy, extra), staff: s.staff, shifts: s.shifts, lines: s.lines, truth: { violations: [] } };
});

function violating(ruleId: RuleId, staffId: string) {
  return { violations: [{ ruleId, staffId }] };
}

add("manager", 10, (i, rand) => {
  const s = base(rand, rand() < 0.5, false);
  const person = s.staff.find((p) => p.role === (i % 2 === 0 ? "server" : "bartender"))!;
  const title = s.pick(["Shift lead", "Floor manager", "Lead server", "Bar manager", "Head server"]);
  person.title = `${title}, hires and schedules staff`;
  person.managerDuties = true;
  return {
    planted: `${person.name} (${title}) has manager duties and is in the pool.`,
    policy: s.policy,
    policyText: policyText(s.policy),
    staff: s.staff,
    shifts: s.shifts,
    lines: s.lines,
    truth: violating("FLSA-MGR", person.id),
  };
});

add("kitchen", 8, (_i, rand) => {
  const s = base(rand, true, false);
  const station: Role = rand() < 0.5 ? "cook" : "dishwasher";
  s.policy.pointsPerHour[station] = 0.5;
  const person = s.staff.find((p) => p.role === station)!;
  return {
    planted: `${person.name} works in the kitchen and shares while a tip credit is taken.`,
    policy: s.policy,
    policyText: policyText(s.policy),
    staff: s.staff,
    shifts: s.shifts,
    lines: s.lines,
    truth: violating("FLSA-BOH", person.id),
  };
});

add("perrys", 6, (i, rand) => {
  const s = base(rand, true, false);
  const role: Role = (["busser", "runner", "host"] as const)[i % 3];
  const person = s.staff.find((p) => p.role === role)!;
  const shift = s.shifts.find((x) => x.staffId === person.id)!;
  shift.start = "09:00";
  shift.end = "14:00";
  person.title = `${TITLES[role]}, morning crew`;
  return {
    planted: `${person.name} only works before opening and shares in a tip credit pool, the Perry's setup.`,
    policy: s.policy,
    policyText: policyText(s.policy, "The morning crew who set up before we open shares too."),
    staff: s.staff,
    shifts: s.shifts,
    lines: s.lines,
    truth: violating("FLSA-CRT", person.id),
  };
});

add("auto-gratuity", 7, (i, rand) => {
  const s = base(rand, rand() < 0.5, false);
  const line = s.lines[0];
  line.tipCents = 0;
  line.source = s.pick(["card", "paypal"] as const);
  line.autoGratuityCents = 8000 + Math.floor(rand() * 22000);
  // One in four bills lets the guest change it, which turns it into a real tip.
  line.guestCouldChangeAutoGratuity = i % 4 === 3;
  return {
    planted: line.guestCouldChangeAutoGratuity
      ? "An 18% suggestion the guest could change, so it counts as a tip."
      : "An automatic gratuity, which is a service charge and must stay out of the pool.",
    policy: s.policy,
    policyText: policyText(s.policy, "Parties of 8 or more get 18% added."),
    staff: s.staff,
    shifts: s.shifts,
    lines: s.lines,
    truth: { violations: [] },
  };
});

add("tip-over-gratuity", 5, (_i, rand) => {
  const s = base(rand, rand() < 0.5, false);
  const line = s.lines[0];
  line.source = s.pick(["card", "paypal", "venmo"] as const);
  line.autoGratuityCents = 8000 + Math.floor(rand() * 22000);
  line.tipCents = 500 + Math.floor(rand() * 3500);
  return {
    planted: "A guest added a tip on top of an automatic gratuity: the tip qualifies, the gratuity doesn't.",
    policy: s.policy,
    policyText: policyText(s.policy, "Parties of 8 or more get 18% added."),
    staff: s.staff,
    shifts: s.shifts,
    lines: s.lines,
    truth: { violations: [] },
  };
});

const dir = join("eval", "scenarios");
mkdirSync(dir, { recursive: true });
const categories: Category[] = ["clean", "manager", "kitchen", "perrys", "auto-gratuity", "tip-over-gratuity"];
for (const category of categories) {
  const items = scenarios.filter((s) => s.category === category);
  writeFileSync(join(dir, `${category}.json`), `${JSON.stringify(items, null, 2)}\n`);
  console.log(`${category}: ${items.length}`);
}

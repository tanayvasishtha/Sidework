import type { Flag, Policy, Role, Shift, StaffMember } from "./types";

const BACK_OF_HOUSE: ReadonlySet<Role> = new Set(["cook", "dishwasher"]);

export function isBackOfHouse(role: Role): boolean {
  return BACK_OF_HOUSE.has(role);
}

/** Minutes in a shift. An end at or before the start is read as after midnight. */
export function shiftMinutes(shift: Pick<Shift, "start" | "end">): number {
  const start = toMinutes(shift.start);
  let end = toMinutes(shift.end);
  if (end <= start) end += 24 * 60;
  return end - start;
}

function toMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) throw new Error(`Time "${hhmm}" isn't in HH:MM form.`);
  const [h, m] = [Number(match[1]), Number(match[2])];
  if (h > 23 || m > 59) throw new Error(`Time "${hhmm}" is out of range.`);
  return h * 60 + m;
}

/**
 * Checks who is in tonight's pool against the federal rules.
 * Anyone with a "block" flag must come out before anyone is paid.
 */
export function checkPool(staff: StaffMember[], shifts: Shift[], policy: Policy): Flag[] {
  const flags: Flag[] = [];
  const inPool = new Set(
    shifts.filter((s) => (policy.pointsPerHour[s.station] ?? 0) > 0).map((s) => s.staffId),
  );

  for (const person of staff) {
    if (!inPool.has(person.id)) continue;

    if (person.managerDuties || person.role === "manager") {
      flags.push({
        ruleId: "FLSA-MGR",
        staffId: person.id,
        severity: "block",
        message: `${person.name} has manager duties, so ${person.name} can't share in the pool.`,
      });
      continue;
    }

    const worksBackOfHouse = shifts.some((s) => s.staffId === person.id && isBackOfHouse(s.station));
    if (policy.takesTipCredit && worksBackOfHouse) {
      flags.push({
        ruleId: "FLSA-BOH",
        staffId: person.id,
        severity: "block",
        message: `${person.name} works in the kitchen. Kitchen staff can only share when the restaurant takes no tip credit.`,
      });
    }
  }

  if (policy.cardFeeRate > 0.05) {
    flags.push({
      ruleId: "FLSA-FEE",
      severity: "warn",
      message: `A ${(policy.cardFeeRate * 100).toFixed(1)}% card fee is higher than processors usually charge. Only the actual fee may come off tips.`,
    });
  }

  return flags;
}

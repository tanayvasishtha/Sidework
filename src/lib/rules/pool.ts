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

/** A shift or opening hours as minutes from the start of the day, with ends past midnight above 1440. */
function span(start: string, end: string): [number, number] {
  const s = toMinutes(start);
  return [s, s + shiftMinutes({ start, end })];
}

/** True when a shift overlaps the hours guests are served, on the same night or the one before. */
export function overlapsService(shift: Pick<Shift, "start" | "end">, hours: { open: string; close: string }): boolean {
  const [s, e] = span(shift.start, shift.end);
  const [o, c] = span(hours.open, hours.close);
  return [-1440, 0, 1440].some((shiftBy) => s < c + shiftBy && o + shiftBy < e);
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
        message: `${person.name} can hire, fire or set schedules. Federal law counts that as a manager, whatever the job title says.`,
      });
      continue;
    }

    const poolShifts = shifts.filter((s) => s.staffId === person.id && (policy.pointsPerHour[s.station] ?? 0) > 0);
    const hours = policy.serviceHours;
    if (policy.takesTipCredit && hours) {
      const offHours = poolShifts.filter((s) => !overlapsService(s, hours));
      const times = offHours.map((s) => `${s.start} to ${s.end}`).join(" and ");
      if (offHours.length > 0 && offHours.length === poolShifts.length) {
        flags.push({
          ruleId: "FLSA-CRT",
          staffId: person.id,
          severity: "block",
          message: `${person.name} worked ${times}, when no guests were in. With a tip credit, only staff who customarily get tips can share. In 2026 a federal court ordered Perry's Steakhouse to pay $21 million over this setup.`,
        });
      } else if (offHours.length > 0) {
        flags.push({
          ruleId: "FLSA-CRT",
          staffId: person.id,
          severity: "warn",
          message: `${person.name}'s ${times} shift was before or after service. Only the hours with guests should earn pool points.`,
        });
      }
    }

    // Only hours that earn points count: a separate kitchen shift outside the pool is a different job.
    if (policy.takesTipCredit && poolShifts.some((s) => isBackOfHouse(s.station))) {
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

import { quoteFound, type Role, type Shift } from "@/lib/rules";

/** One change to tonight's schedule, as read from the manager's note. */
export type ShiftEdit = {
  kind: "end" | "start" | "move" | "absent" | "add";
  staffId: string;
  /** "end": left at. "start": came in at. "move": switched station at. */
  at: string | null;
  /** "move" and "add": the station worked. */
  station: Role | null;
  /** "add": a whole extra shift. */
  start: string | null;
  end: string | null;
  /** The manager's own words this edit came from. */
  quote: string;
};

export type EditResult = {
  shifts: Shift[];
  applied: { edit: ShiftEdit; said: string }[];
  rejected: { edit: ShiftEdit; reason: string }[];
};

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes on the service night, which runs 06:00 to 05:59, so 00:40 sorts after 23:00. */
function night(hhmm: string): number {
  return (minutes(hhmm) - 360 + 1440) % 1440;
}

function span(shift: Shift): [number, number] {
  const start = night(shift.start);
  const length = (minutes(shift.end) - minutes(shift.start) + 1440) % 1440 || 1440;
  return [start, start + length];
}

function overlaps(shifts: Shift[]): boolean {
  const byStaff = new Map<string, [number, number][]>();
  for (const s of shifts) byStaff.set(s.staffId, [...(byStaff.get(s.staffId) ?? []), span(s)]);
  for (const list of byStaff.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) if (list[i][0] < list[i - 1][1]) return true;
  }
  return false;
}

/**
 * Applies the agent's reading of a shift note. Each edit is checked on its own:
 * a bad one is rejected with a reason and the rest still go through.
 */
export function applyShiftEdits(
  shifts: Shift[],
  edits: ShiftEdit[],
  staff: { id: string; name: string }[],
  note: string,
): EditResult {
  let current = shifts.map((s) => ({ ...s }));
  const applied: EditResult["applied"] = [];
  const rejected: EditResult["rejected"] = [];
  const names = new Map(staff.map((p) => [p.id, p.name]));

  for (const edit of edits) {
    const reject = (reason: string) => rejected.push({ edit, reason });
    const name = names.get(edit.staffId);
    if (!name) {
      reject(`Nobody on staff has the id "${edit.staffId}".`);
      continue;
    }
    if (!quoteFound(note, edit.quote)) {
      reject(`"${edit.quote}" isn't in the note.`);
      continue;
    }
    for (const t of [edit.at, edit.start, edit.end]) {
      if (t !== null && !TIME.test(t)) {
        reject(`"${t}" isn't a time in HH:MM form.`);
        break;
      }
    }
    if (rejected.at(-1)?.edit === edit) continue;

    const theirs = current.filter((s) => s.staffId === edit.staffId).sort((a, b) => night(a.start) - night(b.start));
    const others = current.filter((s) => s.staffId !== edit.staffId);
    let next: Shift[] | null = null;
    let said = "";

    switch (edit.kind) {
      case "absent":
        if (theirs.length === 0) {
          reject(`${name} wasn't on tonight's schedule.`);
          break;
        }
        next = others;
        said = `${name} is off tonight's schedule`;
        break;

      case "end": {
        const at = edit.at;
        if (!at || theirs.length === 0) {
          reject(at ? `${name} wasn't on tonight's schedule.` : "No time given for when they left.");
          break;
        }
        const t = night(at);
        const started = theirs.filter((s) => span(s)[0] < t);
        if (started.length === 0) {
          reject(`${name} can't leave at ${at}, before their shift started.`);
          break;
        }
        // The shift they were on when they left, or their last one if they stayed late.
        const target = started.find((s) => t <= span(s)[1]) ?? started.at(-1)!;
        next = [...others, ...started.map((s) => (s === target ? { ...s, end: at } : s))];
        said = `${name} left at ${at}`;
        break;
      }

      case "start": {
        const at = edit.at;
        const first = theirs[0];
        if (!at || !first) {
          reject(at ? `${name} wasn't on tonight's schedule.` : "No time given for when they came in.");
          break;
        }
        if (night(at) >= span(first)[1]) {
          reject(`${name} can't start at ${at}, after the shift ends.`);
          break;
        }
        next = [...others, { ...first, start: at }, ...theirs.slice(1)];
        said = `${name} came in at ${at}`;
        break;
      }

      case "move": {
        const at = edit.at;
        const station = edit.station;
        if (!at || !station) {
          reject("A station change needs both a time and a station.");
          break;
        }
        const t = night(at);
        const target = theirs.find((s) => span(s)[0] < t && t < span(s)[1]);
        if (!target) {
          reject(`${name} wasn't working at ${at}.`);
          break;
        }
        next = [
          ...others,
          ...theirs.filter((s) => s !== target),
          { ...target, end: at },
          { staffId: target.staffId, station, start: at, end: target.end },
        ];
        said = `${name} moved to ${station} at ${at}`;
        break;
      }

      case "add": {
        if (!edit.start || !edit.end || !edit.station) {
          reject("An extra shift needs a start, an end and a station.");
          break;
        }
        next = [...current, { staffId: edit.staffId, station: edit.station, start: edit.start, end: edit.end }];
        said = `${name} worked ${edit.station} ${edit.start} to ${edit.end}`;
        break;
      }
    }

    if (!next) continue;
    if (overlaps(next)) {
      reject(`That would give ${name} two shifts at once.`);
      continue;
    }
    current = next;
    applied.push({ edit, said });
  }

  current.sort((a, b) => a.staffId.localeCompare(b.staffId) || night(a.start) - night(b.start));
  return { shifts: current, applied, rejected };
}

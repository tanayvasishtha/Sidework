import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { ROLES, type Shift } from "@/lib/rules";
import { applyShiftEdits, type EditResult, type ShiftEdit } from "@/lib/schedule/edits";
import { model as defaultModel } from "./model";

const time = z.string().nullable().describe('24-hour "HH:MM". Null when this kind of edit has no such time.');

export const shiftNoteSchema = z.object({
  edits: z.array(
    z.object({
      kind: z.enum(["end", "start", "move", "absent", "add"]),
      staffId: z.string().describe("The id from the roster."),
      at: time,
      station: z.enum(ROLES).nullable(),
      start: time,
      end: time,
      quote: z.string().describe("The words of the note this edit comes from, copied exactly."),
    }),
  ),
}) satisfies z.ZodType<{ edits: ShiftEdit[] }>;

const SYSTEM = `You turn a restaurant manager's end-of-night note into schedule edits.
Only report what the note says happened. Don't guess or add anything.

Edit kinds:
- end: someone left at a time ("cut at 9", "went home at 10:30"). Set at.
- start: someone came in at a different time ("came in late at 6"). Set at.
- move: someone switched station at a time ("covered bar after 8"). Set at and station.
- absent: someone on the schedule didn't work ("called out", "no-show"). No times.
- add: someone not on the schedule worked a shift ("picked up a host shift 5 to 10"). Set station, start, end.

Times are 24-hour HH:MM. This is a dinner service, so a bare "9" or "at 8" means 21:00 or 20:00, and "1" after midnight means 01:00.
Match people by the names in the roster and use their id.`;

export async function readShiftNote(
  note: string,
  roster: { id: string; name: string; role: string }[],
  shifts: Shift[],
  m: LanguageModel = defaultModel(),
): Promise<ShiftEdit[]> {
  const names = new Map(roster.map((p) => [p.id, p.name]));
  const posted = shifts.map((s) => `${names.get(s.staffId) ?? s.staffId} (${s.staffId}): ${s.station} ${s.start} to ${s.end}`);
  const { output } = await generateText({
    model: m,
    system: SYSTEM,
    prompt: [
      "Roster:",
      ...roster.map((p) => `- ${p.name}, id ${p.id}, ${p.role}`),
      "",
      "Posted schedule:",
      ...posted.map((line) => `- ${line}`),
      "",
      `Manager's note:\n${note}`,
    ].join("\n"),
    output: Output.object({ schema: shiftNoteSchema, name: "shift_edits" }),
  });
  if (!output) throw new Error("The agent didn't return any schedule edits.");
  return output.edits;
}

/** The agent reads the note; the schedule code checks and applies each edit. */
export async function applyShiftNote(
  note: string,
  roster: { id: string; name: string; role: string }[],
  shifts: Shift[],
  m?: LanguageModel,
): Promise<EditResult> {
  const edits = await readShiftNote(note, roster, shifts, m);
  return applyShiftEdits(shifts, edits, roster, note);
}

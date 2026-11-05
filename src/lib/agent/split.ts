import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { allocatePool, type Allocation, pointUnits, ROLES, type Shift } from "@/lib/rules";
import { model as defaultModel } from "./model";

export const splitReadingSchema = z.object({
  people: z.array(
    z.object({
      staffId: z.string().describe("The id from the roster."),
      stations: z.array(
        z.object({
          station: z.enum(ROLES),
          minutes: z.number().describe("Minutes worked at this station, counted from the shift times."),
          pointsPerHour: z.number().describe("Points per hour for this station, from the written policy."),
        }),
      ),
    }),
  ),
});

export type SplitInput = {
  policyText: string;
  poolCents: number;
  roster: { id: string; name: string; title: string }[];
  shifts: Shift[];
  /** People who can't share tonight, and why. */
  out: { name: string; reason: string }[];
};

const SYSTEM = `You work out who shares in a restaurant's tip pool tonight and how many points each person earns.
Use only the written tip policy and the shifts you are given.

For each person who shares, list every station they worked, the minutes at that station, and the points per hour the policy gives that station.
A shift ending at or before its start runs past midnight. "16:00 to 00:40" is 520 minutes.
Leave out anyone listed as out of the pool, and any station the policy gives no share.
Don't calculate dollars. A separate program does that.`;

/** The agent's own reading of the night, turned into cents by the same arithmetic the engine uses. */
export async function proposeSplit(input: SplitInput, m: LanguageModel = defaultModel()): Promise<Allocation[]> {
  const names = new Map(input.roster.map((p) => [p.id, p.name]));
  const { output } = await generateText({
    model: m,
    system: SYSTEM,
    prompt: [
      `Tip policy:\n${input.policyText}`,
      "",
      "Roster:",
      ...input.roster.map((p) => `- ${p.name}, id ${p.id}, ${p.title}`),
      "",
      "Tonight's shifts:",
      ...input.shifts.map((s) => `- ${names.get(s.staffId) ?? s.staffId} (${s.staffId}): ${s.station} ${s.start} to ${s.end}`),
      "",
      "Out of the pool tonight:",
      ...(input.out.length > 0 ? input.out.map((p) => `- ${p.name}: ${p.reason}`) : ["- Nobody"]),
    ].join("\n"),
    output: Output.object({ schema: splitReadingSchema, name: "split_reading" }),
  });
  if (!output) throw new Error("The agent didn't return a split.");

  return allocatePool(
    input.poolCents,
    output.people.map((p) => ({
      staffId: p.staffId,
      minutes: p.stations.reduce((t, s) => t + s.minutes, 0),
      units: p.stations.reduce((t, s) => t + pointUnits(s.minutes, s.pointsPerHour), 0),
    })),
  );
}

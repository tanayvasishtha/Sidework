import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { auditPolicy, type PolicyAudit, type PolicyReading, ROLES } from "@/lib/rules";
import type { Policy } from "@/lib/rules";
import { model as defaultModel } from "./model";

const quote = z.string().describe("The policy's exact words, copied character for character. Never reworded.");

export const policyReadingSchema = z.object({
  stations: z
    .array(
      z.object({
        station: z.enum(ROLES),
        pointsPerHour: z.number().describe("Pool points per hour worked at this station. 0 if the policy says they don't share."),
        quote,
      }),
    )
    .describe("One entry per job the policy gives a share rate to."),
  takesTipCredit: z
    .boolean()
    .nullable()
    .describe("True if tipped staff are paid below the full minimum wage (for example $2.13 an hour). Null if the policy doesn't say."),
  tipCreditQuote: quote.nullable(),
  cardFeePercent: z.number().nullable().describe("Percent taken off card tips for processing. Null if not mentioned."),
  cardFeeQuote: quote.nullable(),
  clauses: z
    .array(
      z.object({
        kind: z.enum(["manager_share", "house_share", "off_hours_share", "auto_gratuity_as_tips", "late_payout", "other"]),
        quote,
        summary: z.string().describe("Six words or fewer on what the clause does."),
      }),
    )
    .describe("Every sentence about who shares, what's kept back, added gratuities, or when tips are paid."),
}) satisfies z.ZodType<PolicyReading>;

const SYSTEM = `You read a US restaurant's written tip pool policy and report what it says.
You do not judge whether anything is legal. A separate rules engine does that.

Rules for your answer:
- Every quote must be copied from the policy exactly. If you can't quote it, leave it out.
- stations: each job given a share rate. Map job names to: server, bartender, busser, runner (food runner), barback, host, cook (any line or prep cook, chef), dishwasher, manager (managers, supervisors, shift leads).
- clauses, by kind:
  manager_share: managers, supervisors or shift leads receive any part of the pool.
  house_share: the restaurant keeps, borrows or spends any part of the pool (breakage, walkouts, uniforms, "house" share).
  off_hours_share: staff share who work when no guests are present, such as a morning setup or cleaning crew.
  auto_gratuity_as_tips: added or automatic gratuities or service charges are put in the pool or reported as tips.
  late_payout: tips are held past the next regular payday (monthly, quarterly, at year end).
  other: anything else about who shares or how the pool works.`;

export async function readPolicy(policyText: string, m: LanguageModel = defaultModel()): Promise<PolicyReading> {
  const { output } = await generateText({
    model: m,
    system: SYSTEM,
    prompt: `Tip policy:\n\n${policyText}`,
    output: Output.object({ schema: policyReadingSchema, name: "policy_reading" }),
  });
  if (!output) throw new Error("The agent didn't return a reading of the policy.");
  return output;
}

/** The handbook audit: the agent reads, the rules engine judges. */
export async function auditHandbook(
  policyText: string,
  known: { takesTipCredit: boolean; serviceHours?: Policy["serviceHours"] },
  m?: LanguageModel,
): Promise<PolicyAudit & { reading: PolicyReading }> {
  const reading = await readPolicy(policyText, m);
  return { ...auditPolicy(reading, policyText, known), reading };
}

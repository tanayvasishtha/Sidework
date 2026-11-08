import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { auditPolicy, type Policy, type PolicyAudit, type PolicyReading, ROLES } from "@/lib/rules";
import { model as defaultModel } from "./model";

const quote = z.string().describe("The policy's exact words, copied character for character. Never reworded.");

function answered(question: string) {
  return z
    .object({
      answer: z.enum(["yes", "no", "not stated"]),
      quote: quote.nullable().describe("The sentence that answers it, copied exactly. Null when not stated."),
    })
    .describe(question);
}

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
  questions: z.object({
    manager_share: answered(
      "Does the policy give managers, supervisors or shift leads any part of the pool? A sentence that keeps them out means no.",
    ),
    house_share: answered(
      "Does the restaurant keep, borrow or spend any part of the pool, for breakage, walkouts or a house share? Card processing fees taken off tips are not this: report those in cardFeePercent.",
    ),
    off_hours_share: answered(
      "Do staff share who only work when no guests are present, such as a morning setup or cleaning crew?",
    ),
    auto_gratuity_as_tips: answered(
      "Does the policy put added or automatic gratuities into the tip pool, or call them tips? Only mentioning that a gratuity is added means not stated.",
    ),
    late_payout: answered("Are tips held past the next regular payday, for example paid monthly or at year end?"),
  }),
}) satisfies z.ZodType<PolicyReading>;

const SYSTEM = `You read a US restaurant's written tip pool policy and report what it says.
You do not judge whether anything is legal. A separate rules engine does that.

Rules for your answer:
- Every quote must be copied from the policy exactly. If you can't quote it, leave it out.
- stations: each job given a share rate. Map job names to: server, bartender, busser, runner (food runner), barback, host, cook (any line or prep cook, chef), dishwasher, manager (managers, supervisors, shift leads).
- questions: answer each one yes, no or not stated, from what the policy actually says.
  A sentence that rules something out is a no. "Managers don't share" answers the manager question no.
  Answer yes only when the policy says the practice happens.`;

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

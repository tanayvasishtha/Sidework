import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import type { WorkerCheck } from "@/lib/checks";
import { money, night as nightName, tenths } from "@/lib/format";
import { model as defaultModel } from "./model";

export type Explanation = {
  answer: string;
  /** "agent" when the model's answer passed the ledger check, "ledger" when we fell back to plain math. */
  source: "agent" | "ledger";
};

function hrs(minutes: number): string {
  return tenths(minutes / 60).toString();
}

/** Every figure the answer may use, as lines of text. Nothing else about the restaurant is shared. */
export function shareFacts(c: WorkerCheck): { lines: string[]; amounts: Set<number> } {
  const amounts = new Set<number>();
  const $ = (cents: number) => {
    amounts.add(cents);
    return money(cents);
  };
  const lines = [`Worker: ${c.person.name}, ${c.person.title}, at ${c.restaurant.name}.`];

  if (c.share) {
    lines.push(
      `Tonight (${nightName(c.night.date)}): worked ${c.stations.map((s) => `${hrs(s.minutes)} hours at ${s.station}, ${s.pointsPerHour} points per hour`).join("; ")}.`,
      `Tonight: their points ${tenths(c.share.points)}, everyone's points ${c.pool.points}, ${c.pool.people} people shared.`,
      `Tonight: pool after card fees ${$(c.pool.cents)}. Card fees taken from the whole pool ${$(c.pool.feeCents)}.`,
      `Tonight: their tips ${$(c.share.cents)}, figured as pool times their points divided by everyone's points.`,
    );
  } else {
    lines.push(`Tonight: not in the tip pool. Reason: ${c.outReason ?? "no hours at a station that shares"}`);
  }

  if (c.previous) {
    lines.push(
      `Previous shift (${nightName(c.previous.date)}): worked ${hrs(c.previous.minutes)} hours, pool ${$(c.previous.poolCents)}, their tips ${$(c.previous.cents)}.`,
    );
    if (c.share) {
      const diff = c.share.cents - c.previous.cents;
      lines.push(`Tonight compared with the previous shift: ${$(Math.abs(diff))} ${diff < 0 ? "less" : "more"}.`);
    }
  }
  lines.push(`Qualified tips so far this year, not counting tonight unless paid: ${$(c.year.qualifiedCents)}. Deduction limit ${$(2_500_000)}.`);
  return { lines, amounts };
}

const toCents = (whole: string, part = "0") => Number(whole.replace(/,/g, "")) * 100 + Number(part.padEnd(2, "0"));

/** Money in a piece of text, in cents, however it's written: "$84.26", "$2000", "12 dollars", "50 cents". */
export function dollarFigures(text: string): number[] {
  const number = String.raw`(\d[\d,]*)(?:\.(\d{1,2}))?`;
  const signed = [...text.matchAll(new RegExp(String.raw`\$\s?${number}`, "g"))].map((m) => toCents(m[1], m[2]));
  const worded = [...text.matchAll(new RegExp(String.raw`(?<![$\d.,])${number}\s*(?:dollars?|bucks?|usd)\b`, "gi"))].map((m) =>
    toCents(m[1], m[2]),
  );
  const cents = [...text.matchAll(/(?<![$\d.,])(\d+)\s*(?:cents?\b|\u00a2)/gi)].map((m) => Number(m[1]));
  return [...signed, ...worded, ...cents];
}

/** The plain-math answer, built only from the ledger. Used when the model's answer can't be trusted. */
export function ledgerAnswer(c: WorkerCheck): string {
  if (!c.share) return `You weren't in tonight's tip pool. ${c.outReason ?? ""}`.trim();
  const parts = [
    `Tonight you had ${tenths(c.share.points)} of the ${c.pool.points} points in a ${money(c.pool.cents)} pool, so your share was ${money(c.share.cents)}.`,
  ];
  if (c.previous) {
    parts.push(
      `On ${nightName(c.previous.date)} you worked ${hrs(c.previous.minutes)} hours of a ${money(c.previous.poolCents)} pool and got ${money(c.previous.cents)}.`,
    );
  }
  return parts.join(" ");
}

const SYSTEM = `You answer a restaurant worker's question about their tip share.
Use only the facts given. Speak to the worker as "you", in two or three short sentences, plainly.
Every dollar amount you write must appear in the facts exactly as written. Don't add, subtract or round to make new amounts.
Hours and points may be restated from the facts.
If the facts can't answer the question, say so and suggest asking the manager.
Never give tax or legal advice beyond what the facts state.`;

export async function explainShare(
  check: WorkerCheck,
  question: string,
  m: LanguageModel = defaultModel(),
): Promise<Explanation> {
  const { lines, amounts } = shareFacts(check);
  const { output } = await generateText({
    model: m,
    system: SYSTEM,
    prompt: `Facts:\n${lines.map((l) => `- ${l}`).join("\n")}\n\nQuestion: ${question}`,
    output: Output.object({ schema: z.object({ answer: z.string() }), name: "share_answer" }),
  });
  const answer = output?.answer?.trim() ?? "";
  const figures = dollarFigures(answer);
  // The check that makes the answer safe to show: no dollar figure the ledger doesn't have.
  if (answer && figures.every((cents) => amounts.has(cents))) return { answer, source: "agent" };
  return { answer: ledgerAnswer(check), source: "ledger" };
}

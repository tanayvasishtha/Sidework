// Grades Sidework against labelled nights and handbooks, and writes eval/RESULTS.md.
// Run with: npm run eval. The engine and baseline need no keys. The agent columns need
// an OpenAI key, or the recordings that a keyed run with REPLAY=record leaves in fixtures/.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditHandbook } from "@/lib/agent/policy";
import { proposeSplit } from "@/lib/agent/split";
import { ReplayMissError } from "@/lib/replay";
import { money } from "@/lib/format";
import { settings } from "@/lib/settings";
import { answerFor } from "./oracle";
import { caughtAll, engineOutcome, isCorrect, misdirectedCents, type Outcome, sameShares, spreadsheetOutcome } from "./score";
import type { Answer, Category, Handbook, Scenario } from "./types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Keys can also come from the shell.
}

const CATEGORIES: Category[] = ["clean", "manager", "kitchen", "perrys", "auto-gratuity", "tip-over-gratuity"];
const CONCURRENCY = 8;

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join("eval", "scenarios", `${name}.json`), "utf8")) as T;
}

async function inPool<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]);
      }
    }),
  );
  return results;
}

type Night = { s: Scenario; answer: Answer; engine: Outcome; sheet: Outcome; agent: Record<string, number> | "failed" | null };

/** The agent on its own: the policy and shifts, no rules engine and no list of who to leave out. */
async function agentShares(s: Scenario, answer: Answer): Promise<Night["agent"]> {
  try {
    const proposed = await proposeSplit({
      policyText: s.policyText,
      poolCents: answer.poolCents,
      roster: s.staff.map((p) => ({ id: p.id, name: p.name, title: p.title })),
      shifts: s.shifts,
      out: [],
    });
    return Object.fromEntries(proposed.map((a) => [a.staffId, a.cents]));
  } catch (err) {
    return err instanceof ReplayMissError ? null : "failed";
  }
}

type BookResult = { book: Handbook; rules: string[]; dropped: number } | { book: Handbook; missing: true } | { book: Handbook; failed: true };

async function auditBook(book: Handbook): Promise<BookResult> {
  try {
    const audit = await auditHandbook(book.text, { takesTipCredit: book.takesTipCredit, serviceHours: book.serviceHours });
    return { book, rules: audit.findings.filter((f) => f.severity === "block").map((f) => f.ruleId), dropped: audit.unquoted.length };
  } catch (err) {
    return err instanceof ReplayMissError ? { book, missing: true } : { book, failed: true };
  }
}

async function main() {
  const scenarios = CATEGORIES.flatMap((c) => load<Scenario[]>(c));
  const handbooks = load<Handbook[]>("handbooks");

  const nights: Night[] = await inPool(scenarios, async (s) => {
    const answer = answerFor(s);
    return { s, answer, engine: engineOutcome(s), sheet: spreadsheetOutcome(s), agent: await agentShares(s, answer) };
  });
  const books = await inPool(handbooks, auditBook);

  const planted = nights.filter((n) => n.s.truth.violations.length > 0);
  const clean = nights.filter((n) => n.s.truth.violations.length === 0);
  const gratuity = nights.filter((n) => n.s.category === "auto-gratuity" || n.s.category === "tip-over-gratuity");

  const handledGratuity = (n: Night, o: Outcome) => o.serviceChargeCents === n.answer.serviceChargeCents && o.poolCents === n.answer.poolCents;
  const engineRight = nights.filter((n) => isCorrect(n.answer, n.engine));
  const sheetRight = nights.filter((n) => isCorrect(n.answer, n.sheet));
  const engineCaught = planted.filter((n) => caughtAll(n.s, n.engine));
  const falseAlarms = clean.filter((n) => n.engine.caught.length > 0);
  const gratuityRight = gratuity.filter((n) => handledGratuity(n, n.engine));
  const sheetGratuityRight = gratuity.filter((n) => handledGratuity(n, n.sheet));
  const sheetCaught = planted.filter((n) => caughtAll(n.s, n.sheet));

  const hasPlanted = (n: Night, got: Record<string, number>) => n.s.truth.violations.every((v) => !(v.staffId in got));
  const agentNights = nights.filter((n): n is Night & { agent: Record<string, number> } => typeof n.agent === "object" && n.agent !== null);
  const agentFailed = nights.filter((n) => n.agent === "failed");
  const agentRan = agentNights.length > 0;
  const agentRight = agentNights.filter((n) => sameShares(n.answer.shares, n.agent));
  const agentCaught = agentNights.filter((n) => n.s.truth.violations.length > 0 && hasPlanted(n, n.agent));

  const notRun = "not run";
  const sheetWrong = nights.reduce((t, n) => t + misdirectedCents(n.answer.shares, n.sheet.shares), 0);
  const engineWrong = nights.reduce((t, n) => t + misdirectedCents(n.answer.shares, n.engine.shares), 0);
  const agentWrong = agentNights.reduce((t, n) => t + misdirectedCents(n.answer.shares, n.agent), 0);
  const gratuityAsTips = gratuity.reduce((t, n) => t + n.answer.serviceChargeCents, 0);

  const graded = books.filter((b): b is Extract<BookResult, { rules: string[] }> => "rules" in b);
  const illegal = graded.filter((b) => !b.book.legal);
  const legal = graded.filter((b) => b.book.legal);
  const auditRan = graded.length > 0;
  const clausesCaught = illegal.filter((b) => b.book.expected.every((rule) => b.rules.includes(rule)));
  const auditFalseAlarms = legal.filter((b) => b.rules.length > 0);
  const dropped = graded.reduce((t, b) => t + b.dropped, 0);

  const misses = [
    ...nights.filter((n) => !isCorrect(n.answer, n.engine)).map((n) => `- Engine, ${n.s.id}: ${n.s.planted}`),
    ...planted.filter((n) => !caughtAll(n.s, n.engine)).map((n) => `- Engine missed a violation, ${n.s.id}: ${n.s.planted}`),
    ...falseAlarms.map((n) => `- Engine false alarm, ${n.s.id}: accused ${n.engine.caught.join(", ")}. ${n.s.planted}`),
    ...agentFailed.map((n) => `- Agent gave no usable answer, ${n.s.id}`),
    ...illegal.filter((b) => !clausesCaught.includes(b)).map((b) => `- Audit missed, ${b.book.id}: expected ${b.book.expected.join(", ")}, got ${b.rules.join(", ") || "nothing"}`),
    ...auditFalseAlarms.map((b) => `- Audit false alarm, ${b.book.id}: raised ${b.rules.join(", ")}`),
  ];

  const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  const report = [
    "# Sidework eval results",
    "",
    "Generated by `npm run eval`. Do not edit by hand.",
    "",
    `Nights: ${nights.length}. Planted violations: ${planted.length}. Added-gratuity nights: ${gratuity.length}. Handbooks: ${handbooks.length}. Agent model: ${agentRan || auditRan ? settings().OPENAI_MODEL : "not run"}.`,
    "",
    "## Nights",
    "",
    row(["Measure", "Spreadsheet", "Agent alone", "Sidework (agent + engine)"]),
    row(["---", "---", "---", "---"]),
    row([`Nights split right to the cent, of ${nights.length}`, sheetRight.length, agentRan ? `${agentRight.length} of ${agentNights.length}` : notRun, engineRight.length]),
    row([`Illegal pool members caught, of ${planted.length}`, sheetCaught.length, agentRan ? agentCaught.length : notRun, engineCaught.length]),
    row([`False alarms on ${clean.length} clean nights`, 0, "n/a", falseAlarms.length]),
    row(["Money paid to the wrong people", money(sheetWrong), agentRan ? money(agentWrong) : notRun, money(engineWrong)]),
    row([`Added gratuities handled right, of ${gratuity.length} nights`, sheetGratuityRight.length, "n/a", gratuityRight.length]),
    row(["Service charges counted as qualified tips", money(gratuityAsTips), "n/a", money(0)]),
    "",
    "## Handbooks",
    "",
    row(["Measure", "Sidework audit"]),
    row(["---", "---"]),
    row([`Illegal clauses caught, of ${handbooks.filter((b) => !b.legal).length}`, auditRan ? clausesCaught.length : notRun]),
    row([`False alarms on ${handbooks.filter((b) => b.legal).length} legal handbooks`, auditRan ? auditFalseAlarms.length : notRun]),
    row(["Agent quotes dropped because the words weren't in the text", auditRan ? dropped : notRun]),
    "",
    "## Misses",
    "",
    ...(misses.length > 0 ? misses : ["None."]),
    "",
    "## How to read this",
    "",
    "- All nights and handbooks are synthetic. They are written to test known rules, not sampled from real restaurants.",
    "- The money answer key is `eval/oracle.ts`, exact integer arithmetic that shares no code with the engine. Violations are labelled by the generator that planted them.",
    "- The engine's violation score shows the federal rules are implemented as designed. It takes facts such as who has manager duties as given, so it can't catch a wrong staff record.",
    "- The spreadsheet uses the same points and card fees as Sidework, but no legal checks, and it lumps added gratuities in with tips.",
    "- The agent alone gets the written policy and the shifts, and isn't told the law or who to leave out. In Sidework it never sets a payment: the engine does, and a disagreement stops payment until a person looks.",
    "- Federal rules only. State law is not tested.",
    "",
  ].join("\n");

  writeFileSync(join("eval", "RESULTS.md"), report);
  console.log(report);

  const engineFailed = engineRight.length !== nights.length || engineCaught.length !== planted.length || falseAlarms.length > 0;
  process.exitCode = engineFailed ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

"use server";

import { explainShare, ledgerAnswer } from "@/lib/agent/explain";
import { getWorkerCheck, readCheckToken } from "@/lib/checks";
import { db } from "@/lib/db";
import { settings } from "@/lib/settings";

export type AskState = {
  question?: string;
  answer?: string;
  /** Why the plain ledger answer was shown in place of the assistant's. */
  fallback?: "mismatch" | "unavailable";
  error?: string;
};

export async function askAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { error: "Type a question first." };
  if (question.length > 300) return { error: "Keep the question under 300 characters." };

  const ids = readCheckToken(String(formData.get("token") ?? ""), settings().checkSecret);
  const check = ids ? getWorkerCheck(db(), ids.nightId, ids.staffId) : null;
  if (!check) return { error: "This link doesn't match a payout check." };

  try {
    const result = await explainShare(check, question);
    return { question, answer: result.answer, fallback: result.source === "ledger" ? "mismatch" : undefined };
  } catch {
    // No key, no recording or a provider outage: the ledger still has the answer.
    return { question, answer: ledgerAnswer(check), fallback: "unavailable" };
  }
}

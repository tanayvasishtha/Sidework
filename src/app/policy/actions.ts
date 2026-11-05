"use server";

import { auditHandbook } from "@/lib/agent/policy";
import { db, getRestaurant } from "@/lib/db";
import { ReplayMissError } from "@/lib/replay";
import { RULES, type PolicyAudit } from "@/lib/rules";

export type AuditFindingView = PolicyAudit["findings"][number] & { title: string; source: string; url: string };

export type AuditState = {
  text?: string;
  findings?: AuditFindingView[];
  unquoted?: string[];
  notes?: string[];
  rates?: { station: string; points: number }[];
  error?: string;
};

export async function auditAction(_prev: AuditState, formData: FormData): Promise<AuditState> {
  const text = String(formData.get("policy") ?? "").trim();
  if (!text) return { error: "Paste your tip policy first." };
  if (text.length > 10_000) return { error: "That's too long. Keep it under 10,000 characters." };

  try {
    const { policy } = getRestaurant(db(), String(formData.get("restaurant")));
    const audit = await auditHandbook(text, { takesTipCredit: policy.takesTipCredit, serviceHours: policy.serviceHours });
    return {
      text,
      findings: audit.findings.map((f) => ({ ...f, ...RULES[f.ruleId] })),
      unquoted: audit.unquoted,
      notes: audit.notes,
      rates: Object.entries(audit.policy.pointsPerHour).map(([station, points]) => ({ station, points: points ?? 0 })),
    };
  } catch (err) {
    if (err instanceof ReplayMissError) {
      return { error: "This demo runs from recorded answers, and this policy wasn't recorded. Add an OpenAI key to read new ones." };
    }
    return { error: err instanceof Error ? err.message : "The policy couldn't be read. Try again." };
  }
}

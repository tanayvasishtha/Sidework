import { isBackOfHouse } from "./pool";
import type { Flag, Policy, Role } from "./types";

/** What a written tip policy says, as read by the agent. Every item carries the policy's own words. */
export type PolicyReading = {
  stations: { station: Role; pointsPerHour: number; quote: string }[];
  takesTipCredit: boolean | null;
  tipCreditQuote: string | null;
  cardFeePercent: number | null;
  cardFeeQuote: string | null;
  /** A yes or no on each risky practice, with the sentence that answers it. Only a quoted yes is judged. */
  questions: Record<ClauseKind, { answer: "yes" | "no" | "not stated"; quote: string | null }>;
};

export type ClauseKind = "manager_share" | "house_share" | "off_hours_share" | "auto_gratuity_as_tips" | "late_payout";

const LABEL: Record<ClauseKind, string> = {
  manager_share: "Managers share",
  house_share: "The house keeps part of the pool",
  off_hours_share: "Off-hours staff share",
  auto_gratuity_as_tips: "Added gratuities counted as tips",
  late_payout: "Tips held past payday",
};

export type AuditFinding = Flag & { quote: string };

export type PolicyAudit = {
  /** The policy the engine will run, built only from items the policy really says. */
  policy: Policy;
  findings: AuditFinding[];
  /** Things the agent claimed the policy says that aren't in it. Dropped, and shown to the manager. */
  unquoted: string[];
  notes: string[];
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** A quote only counts if it appears in the policy word for word. */
export function quoteFound(policyText: string, quote: string | null): quote is string {
  if (!quote) return false;
  const q = normalize(quote).replace(/^["']|["']$/g, "");
  return q.length >= 8 && normalize(policyText).includes(q);
}

const MANAGER_SHARE: Flag = {
  ruleId: "FLSA-MGR",
  severity: "block",
  message: "This gives managers or supervisors part of the pool. Federal law bars them from any share of staff tips.",
};

const CLAUSE_RULES: Partial<Record<ClauseKind, (tipCredit: boolean) => Flag | null>> = {
  manager_share: () => MANAGER_SHARE,
  house_share: () => ({
    ruleId: "FLSA-FULL",
    severity: "block",
    message: "This keeps part of the pool for the restaurant. Every dollar in a tip pool has to go to the people in it.",
  }),
  off_hours_share: (tipCredit) =>
    tipCredit
      ? {
          ruleId: "FLSA-CRT",
          severity: "block",
          message:
            "This pays staff who work when no guests are in. With a tip credit, only staff who customarily get tips can share. A federal court ordered Perry's Steakhouse to pay $21 million in 2026 over this.",
        }
      : null,
  auto_gratuity_as_tips: () => ({
    ruleId: "IRS-AUTO",
    severity: "warn",
    message:
      "Added gratuities are service charges. They can be shared with staff, but as wages, never as qualified tips on the W-2.",
  }),
  late_payout: () => ({
    ruleId: "FLSA-PAY",
    severity: "warn",
    message: "Tips are due by the regular payday for the week they were earned. Holding them longer breaks that rule.",
  }),
};

/**
 * Judges a policy the agent has read. The agent only reports what the text says;
 * every legal call is made here, and only on words that are really in the policy.
 */
export function auditPolicy(
  reading: PolicyReading,
  policyText: string,
  known: { takesTipCredit: boolean; serviceHours?: Policy["serviceHours"] },
): PolicyAudit {
  const unquoted: string[] = [];
  const notes: string[] = [];
  const findings: AuditFinding[] = [];

  const check = (quote: string | null, what: string): quote is string => {
    if (quoteFound(policyText, quote)) return true;
    unquoted.push(quote ? `${what}: "${quote}"` : `${what}, with no quote`);
    return false;
  };

  const tipCreditRead = reading.takesTipCredit !== null && check(reading.tipCreditQuote, "Tip credit")
    ? reading.takesTipCredit
    : null;
  if (tipCreditRead !== null && tipCreditRead !== known.takesTipCredit) {
    notes.push(
      `The policy reads as ${tipCreditRead ? "taking" : "not taking"} a tip credit, but payroll is set the other way. Payroll's setting is used.`,
    );
  }
  const tipCredit = known.takesTipCredit;

  const pointsPerHour: Policy["pointsPerHour"] = {};
  for (const s of reading.stations) {
    if (!check(s.quote, `${s.station} at ${s.pointsPerHour} points`)) continue;
    if (s.pointsPerHour < 0) continue;
    pointsPerHour[s.station] = s.pointsPerHour;
    if (s.pointsPerHour === 0) continue;
    if (s.station === "manager") {
      findings.push({ ...MANAGER_SHARE, quote: s.quote });
    } else if (tipCredit && isBackOfHouse(s.station)) {
      findings.push({
        ruleId: "FLSA-BOH",
        severity: "block",
        quote: s.quote,
        message: `The kitchen (${s.station}) shares in the pool while the restaurant takes a tip credit. That's only allowed with no tip credit.`,
      });
    }
  }

  let cardFeeRate = 0;
  if (reading.cardFeePercent !== null && check(reading.cardFeeQuote, `Card fee of ${reading.cardFeePercent}%`)) {
    cardFeeRate = reading.cardFeePercent / 100;
    if (reading.cardFeePercent > 5) {
      findings.push({
        ruleId: "FLSA-FEE",
        severity: "warn",
        quote: reading.cardFeeQuote,
        message: `A ${reading.cardFeePercent}% fee is more than card processors charge. Only the actual processing cost may come off tips.`,
      });
    }
  }

  // A sentence that rules a practice out answers "no", so it can never raise a flag.
  for (const kind of Object.keys(LABEL) as ClauseKind[]) {
    const answer = reading.questions[kind];
    if (answer?.answer !== "yes") continue;
    const rule = CLAUSE_RULES[kind]?.(tipCredit);
    if (!rule) continue;
    if (!check(answer.quote, LABEL[kind])) continue;
    findings.push({ ...rule, quote: answer.quote });
  }

  return {
    policy: { pointsPerHour, takesTipCredit: tipCredit, cardFeeRate, serviceHours: known.serviceHours },
    findings,
    unquoted,
    notes,
  };
}

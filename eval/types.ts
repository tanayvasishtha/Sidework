import type { Policy, RuleId, Shift, StaffMember, TipLine } from "@/lib/rules";

export type Category = "clean" | "manager" | "kitchen" | "perrys" | "auto-gratuity" | "tip-over-gratuity";

/** One night with a known answer. Violations are labelled by whoever planted them, never by the engine. */
export type Scenario = {
  id: string;
  category: Category;
  /** What makes this night interesting, in a sentence. */
  planted: string;
  policy: Policy;
  policyText: string;
  staff: (StaffMember & { title: string })[];
  shifts: Shift[];
  lines: TipLine[];
  truth: { violations: { ruleId: RuleId; staffId: string }[] };
};

export type Handbook = {
  id: string;
  legal: boolean;
  takesTipCredit: boolean;
  serviceHours?: { open: string; close: string };
  text: string;
  /** Rules a correct audit must raise. Empty for a legal handbook. */
  expected: RuleId[];
};

/** The correct money for a night, worked out independently of the engine. */
export type Answer = {
  poolCents: number;
  serviceChargeCents: number;
  shares: Record<string, number>;
};

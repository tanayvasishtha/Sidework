import { cardFeeCents } from "./split";
import type { Flag, Policy, Role, StaffMember } from "./types";

/** One guest payment as it reaches the pool. */
export type TipLine = {
  id: string;
  source: "paypal" | "venmo" | "card" | "cash";
  /** What the guest chose to leave. */
  tipCents: number;
  /** A gratuity the restaurant added to the bill, such as 18% on large parties. */
  autoGratuityCents: number;
  /** True only when the bill told the guest they could change or remove the added gratuity. */
  guestCouldChangeAutoGratuity: boolean;
  /** How the manager knows this payment, such as "Table 12". Falls back to the id. */
  label?: string;
};

export type NightMoney = {
  /** Qualified tips after processing fees. This is the tip pool. */
  tipPoolCents: number;
  /** Added gratuities. Paid out as wages, never counted as qualified tips. */
  serviceChargeCents: number;
  feeCents: number;
  flags: Flag[];
};

const ELECTRONIC = new Set<TipLine["source"]>(["paypal", "venmo", "card"]);

/**
 * Sorts a night's money into qualified tips and service charges.
 * A guest's own tip is qualified even when it sits on top of an added gratuity.
 */
export function classifyNight(lines: TipLine[], policy: Policy): NightMoney {
  let tipCents = 0;
  let serviceChargeCents = 0;
  let electronicTipCents = 0;
  const flags: Flag[] = [];

  for (const line of lines) {
    if (line.tipCents < 0 || line.autoGratuityCents < 0) {
      throw new Error(`Payment ${line.id} has a negative amount.`);
    }
    tipCents += line.tipCents;
    if (ELECTRONIC.has(line.source)) electronicTipCents += line.tipCents;

    if (line.autoGratuityCents === 0) continue;

    if (line.guestCouldChangeAutoGratuity) {
      tipCents += line.autoGratuityCents;
      if (ELECTRONIC.has(line.source)) electronicTipCents += line.autoGratuityCents;
      flags.push({
        ruleId: "IRS-AUTO",
        severity: "warn",
        message: `${line.label ?? `Payment ${line.id}`}: the added gratuity counts as a tip because the guest could change it. Keep the receipt that shows that.`,
      });
    } else {
      serviceChargeCents += line.autoGratuityCents;
      if (line.tipCents > 0) {
        flags.push({
          ruleId: "IRS-OVER",
          severity: "warn",
          message: `${line.label ?? `Payment ${line.id}`}: the guest added a tip on top of the added gratuity. That part is a qualified tip, the gratuity isn't.`,
        });
      }
    }
  }

  const feeCents = cardFeeCents(electronicTipCents, policy.cardFeeRate);
  return { tipPoolCents: tipCents - feeCents, serviceChargeCents, feeCents, flags };
}

/** Treasury tipped occupation codes for restaurant roles, from the 100s food and beverage group. */
const TTOC: Partial<Record<Role, { code: number; title: string }>> = {
  bartender: { code: 101, title: "Bartenders" },
  server: { code: 102, title: "Wait staff" },
  busser: { code: 104, title: "Dining room and cafeteria attendants and bartender helpers" },
  runner: { code: 104, title: "Dining room and cafeteria attendants and bartender helpers" },
  barback: { code: 104, title: "Dining room and cafeteria attendants and bartender helpers" },
  cook: { code: 105, title: "Chefs and cooks" },
  dishwasher: { code: 108, title: "Dishwashers" },
  host: { code: 109, title: "Host staff, restaurant, lounge, and coffee shop" },
};

export function occupationCode(role: Role): { code: number; title: string } | undefined {
  return TTOC[role];
}

/** Flags anyone being paid from the pool who has no occupation code for the W-2. */
export function checkOccupationCodes(staff: StaffMember[], paidStaffIds: Iterable<string>): Flag[] {
  const paid = new Set(paidStaffIds);
  return staff
    .filter((p) => paid.has(p.id) && !occupationCode(p.role))
    .map((p) => ({
      ruleId: "IRS-TTOC" as const,
      staffId: p.id,
      severity: "warn" as const,
      message: `${p.name}'s role has no tipped occupation code, so their tips can't be reported as qualified.`,
    }));
}

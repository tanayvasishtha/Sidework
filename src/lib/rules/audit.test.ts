import { describe, expect, it } from "vitest";
import { auditPolicy, quoteFound, type PolicyReading } from "./index";

const HARTLEYS_POLICY =
  "All tips go in one pool at close. Servers and bartenders earn 1 point an hour. Bussers, hosts and food runners earn 0.5, " +
  "including the morning crew who set up and clean the dining room before we open at 4pm. " +
  "Servers and bartenders are paid $2.13 an hour plus tips. Card fees come off the top.";

const NONE: PolicyReading["questions"] = {
  manager_share: { answer: "not stated", quote: null },
  house_share: { answer: "not stated", quote: null },
  off_hours_share: { answer: "not stated", quote: null },
  auto_gratuity_as_tips: { answer: "not stated", quote: null },
  late_payout: { answer: "not stated", quote: null },
};

const hartleysReading: PolicyReading = {
  stations: [
    { station: "server", pointsPerHour: 1, quote: "Servers and bartenders earn 1 point an hour" },
    { station: "bartender", pointsPerHour: 1, quote: "Servers and bartenders earn 1 point an hour" },
    { station: "busser", pointsPerHour: 0.5, quote: "Bussers, hosts and food runners earn 0.5" },
  ],
  takesTipCredit: true,
  tipCreditQuote: "Servers and bartenders are paid $2.13 an hour plus tips",
  cardFeePercent: null,
  cardFeeQuote: null,
  questions: {
    ...NONE,
    off_hours_share: { answer: "yes", quote: "including the morning crew who set up and clean the dining room before we open at 4pm" },
  },
};

const known = { takesTipCredit: true, serviceHours: { open: "16:00", close: "23:00" } };

describe("quoteFound", () => {
  it("matches across case, spacing and curly quotes", () => {
    expect(quoteFound("Managers don’t   share.", "managers don't share")).toBe(true);
  });

  it("rejects words that aren't in the policy, and quotes too short to mean anything", () => {
    expect(quoteFound(HARTLEYS_POLICY, "Managers get 5% of the pool")).toBe(false);
    expect(quoteFound(HARTLEYS_POLICY, "tips")).toBe(false);
    expect(quoteFound(HARTLEYS_POLICY, null)).toBe(false);
  });
});

describe("auditPolicy", () => {
  it("catches the Perry's setup in Hartley's handbook", () => {
    const audit = auditPolicy(hartleysReading, HARTLEYS_POLICY, known);
    expect(audit.findings).toEqual([
      expect.objectContaining({ ruleId: "FLSA-CRT", severity: "block", quote: expect.stringContaining("morning crew") }),
    ]);
    expect(audit.policy.pointsPerHour).toEqual({ server: 1, bartender: 1, busser: 0.5 });
    expect(audit.unquoted).toEqual([]);
  });

  it("doesn't flag a morning crew when no tip credit is taken", () => {
    const audit = auditPolicy({ ...hartleysReading, takesTipCredit: false }, HARTLEYS_POLICY, { ...known, takesTipCredit: false });
    expect(audit.findings).toEqual([]);
  });

  it("drops anything the agent says that isn't in the text", () => {
    const audit = auditPolicy(
      {
        ...hartleysReading,
        questions: { ...NONE, manager_share: { answer: "yes", quote: "Managers get 5% of the pool" } },
      },
      HARTLEYS_POLICY,
      known,
    );
    expect(audit.findings).toEqual([]);
    expect(audit.unquoted).toEqual(['Managers share: "Managers get 5% of the pool"']);
  });

  it("blocks a manager share and a house share, and warns on held tips", () => {
    const text = "Managers get 5% of the pool. The house keeps 10% for breakage. Tips are paid out once a month.";
    const audit = auditPolicy(
      {
        stations: [],
        takesTipCredit: null,
        tipCreditQuote: null,
        cardFeePercent: null,
        cardFeeQuote: null,
        questions: {
          ...NONE,
          manager_share: { answer: "yes", quote: "Managers get 5% of the pool" },
          house_share: { answer: "yes", quote: "The house keeps 10% for breakage" },
          late_payout: { answer: "yes", quote: "Tips are paid out once a month" },
        },
      },
      text,
      { takesTipCredit: false },
    );
    expect(audit.findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ["FLSA-MGR", "block"],
      ["FLSA-FULL", "block"],
      ["FLSA-PAY", "warn"],
    ]);
  });

  it("blocks the kitchen under a tip credit and warns on a fee above cost", () => {
    const text = "Cooks get 0.5 points an hour. We take 8% off card tips for processing.";
    const audit = auditPolicy(
      {
        stations: [{ station: "cook", pointsPerHour: 0.5, quote: "Cooks get 0.5 points an hour" }],
        takesTipCredit: null,
        tipCreditQuote: null,
        cardFeePercent: 8,
        cardFeeQuote: "We take 8% off card tips for processing",
        questions: NONE,
      },
      text,
      { takesTipCredit: true },
    );
    expect(audit.findings.map((f) => f.ruleId)).toEqual(["FLSA-BOH", "FLSA-FEE"]);
    expect(audit.policy.cardFeeRate).toBe(0.08);
  });

  it("never flags a sentence that rules a practice out", () => {
    const text = "Managers don't share. Card, PayPal and Venmo fees come off the top.";
    const audit = auditPolicy(
      {
        stations: [],
        takesTipCredit: null,
        tipCreditQuote: null,
        cardFeePercent: null,
        cardFeeQuote: null,
        questions: { ...NONE, manager_share: { answer: "no", quote: "Managers don't share." } },
      },
      text,
      { takesTipCredit: false },
    );
    expect(audit.findings).toEqual([]);
  });

  it("uses payroll's tip credit setting and says when the policy disagrees", () => {
    const audit = auditPolicy(hartleysReading, HARTLEYS_POLICY, { ...known, takesTipCredit: false });
    expect(audit.policy.takesTipCredit).toBe(false);
    expect(audit.notes[0]).toContain("payroll is set the other way");
  });
});

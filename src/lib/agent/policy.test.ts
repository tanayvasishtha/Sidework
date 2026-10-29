import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { PolicyReading } from "@/lib/rules";
import { auditHandbook } from "./policy";

const POLICY =
  "All tips go in one pool at close. Servers earn 1 point an hour. Managers get 5% of the pool for running the floor.";

function mockReading(reading: PolicyReading) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(reading) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

describe("auditHandbook", () => {
  it("sends the policy to the model and judges its reading", async () => {
    const m = mockReading({
      stations: [{ station: "server", pointsPerHour: 1, quote: "Servers earn 1 point an hour" }],
      takesTipCredit: null,
      tipCreditQuote: null,
      cardFeePercent: null,
      cardFeeQuote: null,
      clauses: [{ kind: "manager_share", quote: "Managers get 5% of the pool", summary: "Managers take 5%" }],
    });
    const audit = await auditHandbook(POLICY, { takesTipCredit: false }, m);

    expect(JSON.stringify(m.doGenerateCalls[0].prompt)).toContain("Managers get 5% of the pool for running the floor");
    expect(audit.findings).toEqual([expect.objectContaining({ ruleId: "FLSA-MGR", severity: "block" })]);
    expect(audit.policy.pointsPerHour).toEqual({ server: 1 });
  });

  it("asks for structured output that matches the reading", async () => {
    const m = mockReading({
      stations: [],
      takesTipCredit: null,
      tipCreditQuote: null,
      cardFeePercent: null,
      cardFeeQuote: null,
      clauses: [],
    });
    await auditHandbook(POLICY, { takesTipCredit: false }, m);
    expect(m.doGenerateCalls[0].responseFormat).toMatchObject({ type: "json", name: "policy_reading" });
  });
});

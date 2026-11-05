import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { getWorkerCheck } from "@/lib/checks";
import { takeOut } from "@/lib/closeout";
import { openDb, SATURDAY } from "@/lib/db";
import { money } from "@/lib/format";
import { dollarFigures, explainShare, shareFacts } from "./explain";

function mariaCheck() {
  const d = openDb(":memory:");
  takeOut(d, SATURDAY, "dave", "FLSA-MGR");
  return getWorkerCheck(d, SATURDAY, "maria")!;
}

function answering(answer: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify({ answer }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

describe("dollarFigures", () => {
  it("reads amounts with and without cents or commas", () => {
    expect(dollarFigures("You got $84.26, Friday was $2,310 and $5.5 more")).toEqual([8426, 231000, 550]);
    expect(dollarFigures("6.5 hours and 82.6 points")).toEqual([]);
  });

  it("catches amounts written any other way", () => {
    expect(dollarFigures("It was $2000 last week")).toEqual([200000]);
    expect(dollarFigures("about 12 dollars less, and 1,200 bucks")).toEqual([1200, 120000]);
    expect(dollarFigures("just 50 cents")).toEqual([50]);
  });
});

describe("explainShare", () => {
  it("shows the model's answer when every dollar figure is in the ledger", async () => {
    const check = mariaCheck();
    const answer = `Friday's pool was ${money(check.previous!.poolCents)} and you worked 6.5 hours. Tonight your share was ${money(check.share!.cents)}.`;
    const m = answering(answer);
    const result = await explainShare(check, "Why less than Friday?", m);

    expect(result).toEqual({ answer, source: "agent" });
    const prompt = JSON.stringify(m.doGenerateCalls[0].prompt);
    expect(prompt).toContain("Question: Why less than Friday?");
    expect(prompt).toContain(money(check.share!.cents));
  });

  it("falls back to the ledger's own math when the model invents a number", async () => {
    const check = mariaCheck();
    const result = await explainShare(check, "Why less than Friday?", answering("You made $12.34 less because the kitchen took a cut."));
    expect(result.source).toBe("ledger");
    expect(result.answer).toContain(money(check.share!.cents));
    expect(result.answer).not.toContain("$12.34");
  });

  it("only offers the model amounts from this worker's own ledger", () => {
    const { lines, amounts } = shareFacts(mariaCheck());
    expect(lines.join(" ")).not.toMatch(/Jake|Tasha|Omar/);
    expect(amounts.size).toBeGreaterThan(4);
  });
});

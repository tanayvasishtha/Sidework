import type { DatabaseSync } from "node:sqlite";
import type { LanguageModel } from "ai";
import { proposeSplit } from "@/lib/agent/split";
import { getCloseout, NIGHT_LOCKED, type SplitCheck, saveSplitCheck, staffRoster } from "@/lib/closeout";
import { compareSplits } from "@/lib/rules";

/**
 * The second key. The agent reads the policy and the shifts on its own, and its
 * answer is compared with the engine's to the cent. The engine's split is always
 * the one that gets paid; a disagreement stops payment until a person looks.
 */
export async function runSplitCheck(d: DatabaseSync, nightId: string, m?: LanguageModel): Promise<SplitCheck> {
  const c = getCloseout(d, nightId);
  if (c.locked) throw new Error(NIGHT_LOCKED);
  if (c.blocking > 0) throw new Error("Fix the problems in the pool first.");

  const roster = staffRoster(d, c.restaurant.id);
  const names = new Map(roster.map((p) => [p.id, p.name]));
  const out = [...new Map(c.flags.filter((f) => f.severity === "block" && f.resolved && f.staffId).map((f) => [f.staffId, f])).values()];

  try {
    const proposed = await proposeSplit(
      {
        policyText: c.restaurant.policyText,
        poolCents: c.money.poolCents,
        roster,
        shifts: c.people.flatMap((p) => p.shifts),
        out: out.map((f) => ({ name: f.staffName ?? String(f.staffId), reason: f.rule.title })),
      },
      m,
    );
    const differences = compareSplits(proposed, c.split).map((diff) => ({ ...diff, name: names.get(diff.staffId) ?? diff.staffId }));
    return saveSplitCheck(d, nightId, c.splitKey, differences.length === 0 ? "match" : "mismatch", differences);
  } catch {
    // No key, no recording or an outage. The engine still stands, and the screen says it stood alone.
    return saveSplitCheck(d, nightId, c.splitKey, "unavailable", []);
  }
}

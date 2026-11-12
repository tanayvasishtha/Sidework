"use client";

import { useActionState, useState } from "react";
import { type AuditState, auditAction } from "./actions";
import styles from "./page.module.css";

type Severity = "block" | "warn";

// A deliberately bad handbook, so the audit can be tried without pasting one in.
const SAMPLE =
  "Tips are pooled nightly. Servers earn 1 point an hour and cooks earn 0.5. Managers get 5% of the pool for running the floor. " +
  "The house keeps 3% for breakage. We take 8% off card tips for processing. Parties of 8 or more get 18% added, and that goes in the pool as tips. " +
  "Tips are paid out once a month. Servers are paid $2.13 an hour plus tips.";

/** Splits the policy around the quotes the audit flagged, so they can be marked in place. */
function marked(text: string, quotes: { quote: string; severity: Severity }[]): { part: string; severity?: Severity }[] {
  const lower = text.toLowerCase();
  const ranges = quotes
    .map((q) => ({ start: lower.indexOf(q.quote.toLowerCase()), length: q.quote.length, severity: q.severity }))
    .filter((r) => r.start >= 0)
    .sort((a, b) => a.start - b.start);

  const out: { part: string; severity?: Severity }[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start < at) continue;
    if (r.start > at) out.push({ part: text.slice(at, r.start) });
    out.push({ part: text.slice(r.start, r.start + r.length), severity: r.severity });
    at = r.start + r.length;
  }
  if (at < text.length) out.push({ part: text.slice(at) });
  return out;
}

export function PolicyAudit({ restaurantId, policyText }: { restaurantId: string; policyText: string }) {
  const [state, action, pending] = useActionState<AuditState, FormData>(auditAction, {});
  const [text, setText] = useState(policyText);
  const where = (quote: string) => {
    const at = (state.text ?? "").toLowerCase().indexOf(quote.toLowerCase());
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  // What's illegal comes first, then the order the policy says things in.
  const findings = state.findings
    ? [...state.findings].sort(
        (a, b) => Number(a.severity === "warn") - Number(b.severity === "warn") || where(a.quote) - where(b.quote),
      )
    : undefined;
  const blocks = findings?.filter((f) => f.severity === "block").length ?? 0;
  // A job the policy gives no points to isn't a rate worth listing.
  const rates = state.rates?.filter((r) => r.points > 0) ?? [];

  return (
    <div className={styles.cols}>
      <form action={action} className={styles.form}>
        <input type="hidden" name="restaurant" value={restaurantId} />
        <label htmlFor="policy">Your written tip policy</label>
        <textarea id="policy" name="policy" rows={7} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className={styles.bar}>
          <button type="submit" disabled={pending}>
            {pending ? "Reading the policy" : "Check this policy"}
          </button>
          <button type="button" className={styles.quiet} onClick={() => setText(SAMPLE)}>
            Try a policy with problems
          </button>
        </div>
        {state.error ? (
          <p className={styles.error} role="alert">
            {state.error}
          </p>
        ) : null}
      </form>

      {findings ? (
        <section className={styles.results} aria-label="What the audit found" aria-live="polite">
          <h2>
            {findings.length === 0
              ? "Nothing here breaks the federal rules Sidework checks"
              : `${findings.length} ${findings.length === 1 ? "line needs" : "lines need"} attention${blocks > 0 ? `, ${blocks} illegal` : ""}`}
          </h2>

          <p className={styles.policy}>
            {marked(state.text ?? "", findings).map(({ part, severity }, i) =>
              severity ? (
                <mark key={i} className={severity === "block" ? styles.markBlock : styles.markWarn}>
                  {part}
                </mark>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </p>

          <ul className={styles.findings}>
            {findings.map((f, i) => (
              <li key={`${f.ruleId}-${i}`} className={f.severity === "block" ? styles.block : styles.warn}>
                <span className={styles.kind}>{f.severity === "block" ? "Illegal" : "Worth fixing"}</span>
                <div>
                  <b>{f.title}</b>
                  <q>{f.quote}</q>
                  {f.message}
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.source}
                  </a>
                </div>
              </li>
            ))}
          </ul>

          {rates.length > 0 ? (
            <>
              <h3>Points the policy gives</h3>
              <dl className={`${styles.rates} num`}>
                {rates.map((r) => (
                  <div key={r.station}>
                    <dt>{r.station}</dt>
                    <dd>{r.points}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}

          {state.notes?.map((n) => (
            <p key={n} className={styles.note}>
              {n}
            </p>
          ))}

          {state.unquoted && state.unquoted.length > 0 ? (
            <>
              <h3>Dropped because the words aren&apos;t in the policy</h3>
              <ul className={styles.dropped}>
                {state.unquoted.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : (
        <p className={styles.waiting} aria-live="polite">
          {pending
            ? "Reading the policy. The agent quotes it, then the rules engine checks each quote."
            : "Nothing checked yet. Press Check this policy, and every line that breaks a federal rule shows up here in the policy's own words."}
        </p>
      )}
    </div>
  );
}

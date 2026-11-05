import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { checkToken } from "@/lib/checks";
import { type Closeout, type CloseoutFlag, getCloseout, listNights, type SplitCheck } from "@/lib/closeout";
import { db, SATURDAY } from "@/lib/db";
import { localTime, money, night as nightName, WALLET } from "@/lib/format";
import { getNightPayout, isSettled, type NightPayout, payoutStands, type PayoutRow } from "@/lib/pay";
import { settings } from "@/lib/settings";
import { acceptEngineAction, resetDemoAction, takeOutAction } from "./actions";
import { CheckSplitButton, PayButton, PayoutWatcher } from "./PayButton";
import { Schedule } from "./Schedule";
import { ShiftNote } from "./ShiftNote";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Tonight's close-out | Sidework" };

// The notes recorded for replay mode. Anything else needs an OpenAI key.
const DEMO_NOTES: Record<string, string> = {
  "lucias-2026-11-07": "Sam called out sick. Maria cut at 9. Jake covered bar after 8.",
  "hartleys-2026-11-06": "Holly stayed until 11:30 to close her section.",
};

export default function Tonight({ searchParams }: PageProps<"/tonight">) {
  return (
    <Shell current="/tonight">
      <Suspense fallback={<p className={styles.loading}>Opening tonight&apos;s close-out</p>}>
        <CloseoutView searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}

async function CloseoutView({ searchParams }: { searchParams: PageProps<"/tonight">["searchParams"] }) {
  await connection();
  const { night } = await searchParams;
  const d = db();
  const nights = listNights(d);
  const nightId = typeof night === "string" && nights.some((n) => n.id === night) ? night : SATURDAY;
  const c = getCloseout(d, nightId);
  const payout = getNightPayout(d, nightId);

  return (
    <>
      <div className={styles.head}>
        <h1>
          {c.restaurant.name}, {nightName(c.night.date)}
        </h1>
        <nav className={styles.nights} aria-label="Nights">
          {nights.map((n) => (
            <Link key={n.id} href={`/tonight?night=${n.id}`} aria-current={n.id === nightId ? "page" : undefined}>
              {n.restaurant}
            </Link>
          ))}
        </nav>
      </div>
      <div className={styles.grid}>
        <section className={styles.left} aria-labelledby="who">
          <h2 id="who">Who worked tonight</h2>
          <ShiftNote key={nightId} nightId={nightId} suggested={DEMO_NOTES[nightId] ?? ""} last={c.note} locked={c.locked} />
          <Schedule closeout={c} />
        </section>
        <Tips closeout={c} payout={payout} />
      </div>
      <form action={resetDemoAction} className={styles.reset}>
        <button type="submit">Reset demo</button>
      </form>
    </>
  );
}

function payoutStatus(item: PayoutRow): { text: string; tone: "sending" | "done" | "waiting" | "failed" } {
  const first = item.name.split(" ")[0];
  switch (item.status) {
    case "SUCCESS":
      return { text: `Paid to ${WALLET[item.wallet]}`, tone: "done" };
    case "UNCLAIMED":
      return { text: `Sent. Waiting for ${first} to claim it`, tone: "waiting" };
    case "FAILED":
    case "BLOCKED":
    case "RETURNED":
    case "REFUNDED":
    case "REVERSED":
    case "CANCELED":
      return { text: `Didn't go through${item.error ? `: ${item.error}` : ""}`, tone: "failed" };
    default:
      return { text: `Sending to ${WALLET[item.wallet]}`, tone: "sending" };
  }
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

function Tips({ closeout: c, payout }: { closeout: Closeout; payout: NightPayout | null }) {
  const blocks = c.flags.filter((f) => f.severity === "block");
  const open = blocks.filter((f) => !f.resolved);
  // One line per person taken out, however many rules they tripped.
  const settled = [...new Map(blocks.filter((f) => f.resolved).map((f) => [f.staffId, f])).values()];
  const warnings = c.flags.filter((f) => f.severity === "warn");
  const blockedIds = new Set(open.map((f) => f.staffId));
  const count = c.split.length;

  const live = payoutStands(payout) ? payout : null;
  const sent = live?.paypalBatchId ? live : null;
  const statusFor = new Map(sent?.items.map((i) => [i.staffId, i]) ?? []);
  const secret = settings().CHECK_SECRET;

  return (
    <section className={styles.right} aria-labelledby="tips">
      <h2 id="tips">Tonight&apos;s tips</h2>
      <div className={`${styles.big} num`}>{money(c.money.poolCents)}</div>
      <p className={styles.sub}>
        {c.blocking > 0
          ? `${people(count)} in the pool, ${c.blocking === 1 ? "1 can't stay" : `${c.blocking} can't stay`}`
          : `goes to ${people(count)}, all qualified tips under federal rules`}
      </p>

      {c.money.lines.map((l) => (
        <div key={l.label} className={styles.money}>
          <span>{l.label}</span>
          <b className="num">{money(l.cents)}</b>
        </div>
      ))}
      {c.money.feeCents > 0 ? (
        <div className={styles.money}>
          <span>Card, PayPal and Venmo fees, at cost</span>
          <b className="num">-{money(c.money.feeCents)}</b>
        </div>
      ) : null}
      {c.money.autoGratuities.map((g) => (
        <div key={g.label} className={`${styles.money} ${styles.apart}`}>
          <span>{g.label} added gratuity, kept out</span>
          <b className="num">{money(g.cents)}</b>
        </div>
      ))}
      {c.money.serviceChargeCents > 0 ? (
        <p className={styles.sub}>
          Added gratuities are service charges. They go out as wages through payroll, so they aren&apos;t qualified tips.
          {c.money.autoGratuities.some((g) => g.tipOnTopCents > 0) ? " What guests left on top of them is, and it's in the pool." : ""}
        </p>
      ) : null}

      {open.map((f) => (
        <BlockFlag key={`${f.ruleId}-${f.staffId}`} flag={f} nightId={c.night.id} />
      ))}
      {settled.map((f) => (
        <p key={f.staffId} className={styles.resolved}>
          {f.staffName?.split(" ")[0]} is out of tonight&apos;s pool. {f.rule.title}.
        </p>
      ))}

      {!live && c.check?.status === "mismatch" && !c.check.accepted ? <Disagreement check={c.check} /> : null}

      {sent ? (
        <SentSummary payout={sent} state={c.restaurant.state} nightId={c.night.id} />
      ) : (
        <div className={styles.payBar}>
          {c.check ? <CheckLine check={c.check} /> : null}
          {live ? (
            <p className={styles.payError} role="alert">
              PayPal didn&apos;t answer, so this may or may not have gone through. Finishing resends the same batch, so
              nobody gets paid twice.
            </p>
          ) : null}
          {!live && c.blocking === 0 && count > 0 && !c.check ? (
            <CheckSplitButton key={c.night.id} nightId={c.night.id} />
          ) : !live && c.check?.status === "mismatch" && !c.check.accepted ? (
            <form action={acceptEngineAction}>
              <input type="hidden" name="night" value={c.night.id} />
              <button className={`${styles.pay} num`} type="submit">
                Use the rules engine&apos;s numbers
              </button>
            </form>
          ) : (
            <PayButton
              key={c.night.id}
              nightId={c.night.id}
              disabled={c.blocking > 0 || count === 0}
              label={
                c.blocking > 0
                  ? `Fix ${c.blocking === 1 ? "1 problem" : `${c.blocking} problems`} before paying`
                  : live
                    ? `Finish sending to ${people(live.items.length)}`
                    : `${payout?.status ? "Try again: pay" : "Pay"} ${people(count)} ${money(c.money.poolCents)}`
              }
            />
          )}
        </div>
      )}

      <h3 className={styles.splitHead}>Tonight&apos;s split</h3>
      <table className={styles.split}>
        <caption className={styles.srOnly}>Each person&apos;s share of tonight&apos;s tips</caption>
        <tbody>
          {c.split.map((s) => (
            <tr key={s.staffId} className={blockedIds.has(s.staffId) ? styles.blockedRow : undefined}>
              <td>
                <Link href={`/check/${checkToken(c.night.id, s.staffId, secret)}`} className={styles.person}>
                  {s.name}
                </Link>
                <div className={styles.muted}>{blockedIds.has(s.staffId) ? "Can't stay in the pool" : s.detail}</div>
              </td>
              <td className="num">
                {money(s.cents)}
                {statusFor.has(s.staffId) ? <PayoutLine item={statusFor.get(s.staffId)!} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {warnings.length > 0 ? (
        <ul className={styles.warnings} aria-label="Worth knowing">
          {warnings.map((f, i) => (
            <li key={`${f.ruleId}-${f.staffId ?? i}`}>
              {f.message} <Citation flag={f} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Says what stands behind the pay button, in the one line above it. */
function CheckLine({ check }: { check: SplitCheck }) {
  if (check.status === "match") {
    return <p className={styles.checked}>Checked twice. The agent and the rules engine got the same split to the cent.</p>;
  }
  if (check.status === "unavailable") {
    return <p className={styles.checked}>The agent couldn&apos;t be reached, so this split is the rules engine&apos;s alone.</p>;
  }
  if (!check.accepted) return null;
  return (
    <p className={styles.checked}>
      You chose the rules engine&apos;s numbers after the agent disagreed on {people(check.differences.length)}.
    </p>
  );
}

function Disagreement({ check }: { check: SplitCheck }) {
  return (
    <div className={styles.flag} role="alert">
      <b>The agent and the rules engine disagree</b>
      Nobody gets paid until you look. The agent may have read a shift or a rate differently from the rules set for this
      restaurant.
      <table className={styles.diff}>
        <thead>
          <tr>
            <th scope="col">Who</th>
            <th scope="col">Agent</th>
            <th scope="col">Rules engine</th>
          </tr>
        </thead>
        <tbody className="num">
          {check.differences.map((d) => (
            <tr key={d.staffId}>
              <td>{d.name}</td>
              <td>{money(d.proposedCents)}</td>
              <td>{money(d.checkedCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SentSummary({ payout, state, nightId }: { payout: NightPayout; state: string; nightId: string }) {
  const paid = payout.items.filter((i) => i.status === "SUCCESS").length;
  const failed = payout.items.filter((i) => payoutStatus(i).tone === "failed").length;
  return (
    <div className={styles.sent} role="status">
      <b className="num">
        Sent {money(payout.items.reduce((t, i) => t + i.cents, 0))} to {people(payout.items.length)} at{" "}
        {localTime(payout.createdAt, state)}
      </b>
      {paid} of {payout.items.length} paid so far, through PayPal Payouts.
      {failed > 0 ? ` ${failed} didn't go through.` : ""}
      <PayoutWatcher nightId={nightId} settled={payout.items.every((i) => isSettled(i.status))} />
    </div>
  );
}

function PayoutLine({ item }: { item: PayoutRow }) {
  const { text, tone } = payoutStatus(item);
  return <div className={`${styles.status} ${styles[tone]}`}>{text}</div>;
}

function Citation({ flag: f, className }: { flag: CloseoutFlag; className?: string }) {
  return (
    <a href={f.rule.url} className={className} target="_blank" rel="noreferrer">
      {f.rule.source}
    </a>
  );
}

function BlockFlag({ flag: f, nightId }: { flag: CloseoutFlag; nightId: string }) {
  const first = f.staffName?.split(" ")[0] ?? "This person";
  return (
    <div className={styles.flag} role="alert">
      <b>{first} can&apos;t share in the pool</b>
      {f.message}
      <Citation flag={f} className={styles.cite} />
      {f.staffId ? (
        <form action={takeOutAction}>
          <input type="hidden" name="night" value={nightId} />
          <input type="hidden" name="staff" value={f.staffId} />
          <input type="hidden" name="rule" value={f.ruleId} />
          <button type="submit">Take {first} out</button>
        </form>
      ) : null}
    </div>
  );
}

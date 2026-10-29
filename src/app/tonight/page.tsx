import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { type Closeout, type CloseoutFlag, getCloseout, listNights } from "@/lib/closeout";
import { db, SATURDAY } from "@/lib/db";
import { localTime, money, night as nightName } from "@/lib/format";
import { getNightPayout, isSettled, type NightPayout, type PayoutRow } from "@/lib/pay";
import { resetDemoAction, takeOutAction } from "./actions";
import { PayButton, PayoutWatcher } from "./PayButton";
import { Schedule } from "./Schedule";
import { ShiftNote } from "./ShiftNote";
import styles from "./page.module.css";

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
          <Schedule closeout={c} />
          <ShiftNote key={nightId} nightId={nightId} suggested={DEMO_NOTES[nightId] ?? ""} last={c.note} />
        </section>
        <Tips closeout={c} payout={payout} />
      </div>
      <form action={resetDemoAction} className={styles.reset}>
        <button type="submit">Reset demo</button>
      </form>
    </>
  );
}

const WALLET = { VENMO: "Venmo", PAYPAL: "PayPal" } as const;

function payoutStatus(item: PayoutRow): { text: string; tone: "sending" | "done" | "waiting" | "failed" } {
  const first = item.name.split(" ")[0];
  switch (item.status) {
    case "PENDING":
    case "ONHOLD":
      return { text: `Sending to ${WALLET[item.wallet]}`, tone: "sending" };
    case "SUCCESS":
      return { text: `Paid to ${WALLET[item.wallet]}`, tone: "done" };
    case "UNCLAIMED":
      return { text: `Sent. Waiting for ${first} to claim it`, tone: "waiting" };
    default:
      return { text: `Didn't go through${item.error ? `: ${item.error}` : ""}`, tone: "failed" };
  }
}

function Tips({ closeout: c, payout }: { closeout: Closeout; payout: NightPayout | null }) {
  const blocks = c.flags.filter((f) => f.severity === "block");
  const warnings = c.flags.filter((f) => f.severity === "warn");
  const paid = c.split.length;
  const sent = payout && payout.status !== "FAILED" ? payout : null;
  const statusFor = new Map(sent?.items.map((i) => [i.staffId, i]) ?? []);
  const settled = sent ? sent.items.every((i) => isSettled(i.status)) : true;

  return (
    <section className={styles.right} aria-labelledby="tips">
      <h2 id="tips">Tonight&apos;s tips</h2>
      <div className={`${styles.big} num`}>{money(c.money.poolCents)}</div>
      <p className={styles.sub}>
        goes to {paid} {paid === 1 ? "person" : "people"}, all qualified tips under federal rules
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
        <div key={g.table} className={`${styles.money} ${styles.apart}`}>
          <span>Table {g.table} added gratuity</span>
          <b className="num">{money(g.cents)}</b>
        </div>
      ))}
      {c.money.serviceChargeCents > 0 ? (
        <p className={styles.sub}>
          Added gratuities are service charges. They go out as wages through payroll, so they stay out of the pool and
          out of the tax-free total.
          {c.money.autoGratuities.some((g) => g.tipOnTopCents > 0)
            ? " Tips guests left on top of them are qualified tips and are in the pool."
            : ""}
        </p>
      ) : null}

      {blocks.map((f) => (
        <BlockFlag key={`${f.ruleId}-${f.staffId}`} flag={f} nightId={c.night.id} />
      ))}

      <table className={styles.split}>
        <caption className={styles.srOnly}>Tonight&apos;s split</caption>
        <tbody>
          {c.split.map((s) => (
            <tr key={s.staffId}>
              <td>
                {s.name}
                <div className={styles.muted}>{s.detail}</div>
              </td>
              <td className="num">
                {money(s.cents)}
                {statusFor.has(s.staffId) ? (
                  <PayoutLine item={statusFor.get(s.staffId)!} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sent ? (
        <div className={styles.sent} role="status">
          <b className="num">
            Sent {money(sent.items.reduce((t, i) => t + i.cents, 0))} to {sent.items.length} people at{" "}
            {localTime(sent.createdAt, c.restaurant.state)}
          </b>
          {sent.items.filter((i) => i.status === "SUCCESS").length} of {sent.items.length} paid so far, through PayPal
          Payouts.
          <PayoutWatcher nightId={c.night.id} settled={settled} />
        </div>
      ) : (
        <PayButton
          nightId={c.night.id}
          disabled={c.blocking > 0 || paid === 0}
          label={
            c.blocking > 0
              ? `Fix ${c.blocking} ${c.blocking === 1 ? "problem" : "problems"} before paying`
              : `${payout?.status === "FAILED" ? "Try again: pay" : "Pay"} ${paid} ${paid === 1 ? "person" : "people"} ${money(c.money.poolCents)}`
          }
        />
      )}

      {warnings.length > 0 ? (
        <ul className={styles.warnings} aria-label="Worth knowing">
          {warnings.map((f, i) => (
            <li key={`${f.ruleId}-${f.staffId ?? i}`}>
              {f.message} <a href={f.rule.url}>{f.rule.source}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PayoutLine({ item }: { item: PayoutRow }) {
  const { text, tone } = payoutStatus(item);
  return <div className={`${styles.status} ${styles[tone]}`}>{text}</div>;
}

function BlockFlag({ flag: f, nightId }: { flag: CloseoutFlag; nightId: string }) {
  const first = f.staffName?.split(" ")[0] ?? "This person";
  if (f.resolved) {
    return (
      <p className={styles.resolved}>
        {first} is out of tonight&apos;s pool. {f.rule.title}.
      </p>
    );
  }
  return (
    <div className={styles.flag} role="alert">
      <b>{first} can&apos;t share in the pool</b>
      {f.message}
      <a href={f.rule.url} className={styles.cite}>
        {f.rule.source}
      </a>
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

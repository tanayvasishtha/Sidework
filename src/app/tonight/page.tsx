import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { type Closeout, type CloseoutFlag, getCloseout, listNights } from "@/lib/closeout";
import { db, SATURDAY } from "@/lib/db";
import { money, night as nightName } from "@/lib/format";
import { resetDemoAction, takeOutAction } from "./actions";
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
        <Tips closeout={c} />
      </div>
      <form action={resetDemoAction} className={styles.reset}>
        <button type="submit">Reset demo</button>
      </form>
    </>
  );
}

function Tips({ closeout: c }: { closeout: Closeout }) {
  const blocks = c.flags.filter((f) => f.severity === "block");
  const warnings = c.flags.filter((f) => f.severity === "warn");
  const paid = c.split.length;

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
              <td className="num">{money(s.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className={`${styles.pay} num`} type="button" disabled>
        {c.blocking > 0
          ? `Fix ${c.blocking} ${c.blocking === 1 ? "problem" : "problems"} before paying`
          : `Pay ${paid} ${paid === 1 ? "person" : "people"} ${money(c.money.poolCents)}`}
      </button>

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

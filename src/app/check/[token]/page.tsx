import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DEDUCTION_CAP_CENTS, getWorkerCheck, readCheckToken, type WorkerCheck } from "@/lib/checks";
import { db } from "@/lib/db";
import { localTime, money, night as nightName } from "@/lib/format";
import type { Role } from "@/lib/rules";
import { settings } from "@/lib/settings";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Your tips", robots: { index: false } };

const WHERE: Record<Role, string> = {
  server: "on the floor",
  bartender: "behind the bar",
  busser: "bussing",
  runner: "running food",
  barback: "barbacking",
  host: "at the host stand",
  cook: "in the kitchen",
  dishwasher: "on dish",
  manager: "managing",
};

const WALLET = { VENMO: "Venmo", PAYPAL: "PayPal" } as const;

// Bracket used for the savings estimate. Most tipped workers who owe income tax are in the 10% or 12% bracket.
const EXAMPLE_BRACKET = 0.12;

export default function CheckPage({ params }: PageProps<"/check/[token]">) {
  return (
    <main className={styles.page}>
      <Suspense fallback={<p className={styles.loading}>Opening your check</p>}>
        <Check params={params} />
      </Suspense>
    </main>
  );
}

async function Check({ params }: { params: PageProps<"/check/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const ids = readCheckToken(token, settings().CHECK_SECRET);
  if (!ids) notFound();
  const check = getWorkerCheck(db(), ids.nightId, ids.staffId);
  if (!check) notFound();

  return (
    <>
      <Slip check={check} />
      <Year check={check} />
      <p className={styles.fine}>
        Sidework follows federal tip rules. It isn&apos;t tax or legal advice. Questions about your pay go to your manager.
      </p>
    </>
  );
}

function Slip({ check: c }: { check: WorkerCheck }) {
  const first = c.person.name.split(" ")[0];
  return (
    <section className={styles.slip} aria-label="Tonight's tips">
      <div className={styles.top}>
        <div className={styles.place}>
          {c.restaurant.name}
          <span>
            {nightName(c.night.date)}, {c.person.name}
          </span>
        </div>
        <div className={`${styles.serial} num`} aria-hidden>
          {c.serial}
        </div>
      </div>

      {c.share ? (
        <>
          {c.stations.map((s) => (
            <div key={s.station} className={styles.line}>
              <span>Hours {WHERE[s.station]}</span>
              <span className="num">{(s.minutes / 60).toFixed(1)}</span>
            </div>
          ))}
          {c.stations.map((s) => (
            <div key={`${s.station}-rate`} className={styles.line}>
              <span>Points per hour {WHERE[s.station]}</span>
              <span className="num">{s.pointsPerHour}</span>
            </div>
          ))}
          <div className={styles.line}>
            <span>Your points</span>
            <span className="num">{Math.round(c.share.points * 10) / 10}</span>
          </div>
          <div className={styles.line}>
            <span>Everyone&apos;s points, {c.pool.people} people</span>
            <span className="num">{c.pool.points}</span>
          </div>
          <div className={styles.line}>
            <span>Pool after card fees</span>
            <span className="num">{money(c.pool.cents)}</span>
          </div>
          <div className={`${styles.line} ${styles.total}`}>
            <span>Your tips</span>
            <span className="num">{money(c.share.cents)}</span>
          </div>
          <p className={styles.how}>
            The pool times your points, divided by everyone&apos;s points
            {c.share.remainderCents > 0 ? `, plus ${c.share.remainderCents}¢ left over from rounding` : ""}.
          </p>
          <div className={styles.line}>
            <span>{c.payout ? `Sent to ${WALLET[c.payout.wallet]}` : `Goes to your ${WALLET[c.person.wallet]}`}</span>
            <span className="num">
              {c.payout
                ? c.payout.status === "SUCCESS"
                  ? localTime(c.payout.sentAt, c.restaurant.state)
                  : c.payout.status === "UNCLAIMED"
                    ? "Claim it in the app"
                    : c.payout.status === "PENDING" || c.payout.status === "ONHOLD"
                      ? "On its way"
                      : "Ask your manager"
                : "Not sent yet"}
            </span>
          </div>
        </>
      ) : (
        <p className={styles.outOfPool}>
          {first}, you weren&apos;t in tonight&apos;s tip pool. {c.outReason ?? "You had no hours at a station that shares."}
        </p>
      )}
    </section>
  );
}

function Year({ check: c }: { check: WorkerCheck }) {
  const tonight = c.share && !c.year.includesTonight ? c.share.cents : 0;
  const total = c.year.qualifiedCents;
  if (!c.occupation || total + tonight === 0) return null;
  const year = c.night.date.slice(0, 4);
  const filled = Math.min(1, total / DEDUCTION_CAP_CENTS);

  return (
    <section className={styles.year} aria-label={`Qualified tips in ${year}`}>
      <p>Qualified tips so far in {year}</p>
      <div className={`${styles.amount} num`}>{money(total)}</div>
      {tonight > 0 ? <p className="num">Plus {money(tonight)} from tonight once it&apos;s sent.</p> : null}
      <div
        className={styles.cap}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={DEDUCTION_CAP_CENTS / 100}
        aria-valuenow={total / 100}
        aria-label="Toward the $25,000 deduction limit"
      >
        <span style={{ width: `${filled * 100}%` }} />
      </div>
      <p className={styles.capLabel}>
        <span className="num">{Math.round(filled * 100)}%</span> of the $25,000 you can deduct this year
      </p>
      <p>
        You can deduct up to $25,000 of qualified tips from your federal income tax for {year}. At a 12% bracket,
        that&apos;s about <b className="num">{money(Math.round(total * EXAMPLE_BRACKET))}</b> less tax so far. Social
        Security and Medicare still apply.
      </p>
      <p>
        Your W-2 shows these as tips in box 12, code TP, with occupation code {c.occupation.code} (
        {c.occupation.title}) in box 14b. This counts {c.year.nights} paid nights. Added gratuities on large parties are
        paid as wages, so they aren&apos;t in it.
      </p>
    </section>
  );
}

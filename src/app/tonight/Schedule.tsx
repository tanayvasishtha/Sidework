import type { Closeout } from "@/lib/closeout";
import { clock } from "@/lib/format";
import { isBackOfHouse } from "@/lib/rules";
import { shiftSpan } from "@/lib/schedule/night";
import styles from "./page.module.css";

function hourLabel(nightMinute: number): string {
  const h = (Math.round(nightMinute / 60) + 6) % 24;
  return `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
}

export function Schedule({ closeout }: { closeout: Closeout }) {
  const spans = closeout.people.flatMap((p) => p.shifts.map(shiftSpan));
  if (spans.length === 0) {
    return <p className={styles.noShifts}>Nobody is on tonight&apos;s schedule. Say who worked in the note above.</p>;
  }
  const from = Math.floor(Math.min(...spans.map((s) => s[0])) / 60) * 60;
  const to = Math.ceil(Math.max(...spans.map((s) => s[1])) / 60) * 60;
  const width = to - from;
  const ticks = Array.from({ length: width / 60 }, (_, i) => from + i * 60);

  const blocked = new Map(
    closeout.flags.filter((f) => f.severity === "block" && f.staffId).map((f) => [f.staffId!, f.resolved]),
  );

  return (
    <div
      className={styles.schedule}
      style={{ "--hours": ticks.length } as React.CSSProperties}
      role="region"
      aria-label="Tonight's shifts"
      tabIndex={0}
    >
      <div className={`${styles.hours} num`} aria-hidden>
        <span />
        {ticks.map((t) => (
          <span key={t}>{hourLabel(t)}</span>
        ))}
      </div>
      <ul className={styles.rows}>
        {closeout.people.map((p) => {
          const state = blocked.get(p.id);
          const edited = p.shifts.some((s) => s.edited);
          const stations = [...new Set(p.shifts.map((s) => s.station))];
          return (
            <li key={p.id} className={styles.row}>
              <div className={styles.who}>
                {p.name}
                <em>
                  {p.title}
                  {stations.length > 1 ? `, also ${stations.filter((s) => s !== p.role).join(", ")}` : ""}
                </em>
              </div>
              <div className={styles.track}>
                {p.shifts.map((s) => {
                  const [a, b] = shiftSpan(s);
                  const cls = [
                    styles.shift,
                    "num",
                    isBackOfHouse(s.station) ? styles.boh : "",
                    s.edited ? styles.edited : "",
                    state === false ? styles.blocked : "",
                    state === true ? styles.out : "",
                  ].join(" ");
                  const label =
                    state === false ? "In the pool. Can't be." : state === true ? "Out of the pool" : `${clock(s.start)} to ${clock(s.end)}`;
                  return (
                    <div
                      key={`${s.station}-${s.start}`}
                      className={cls}
                      style={{ left: `${((a - from) / width) * 100}%`, width: `${((b - a) / width) * 100}%` }}
                      title={`${p.name}: ${s.station}, ${clock(s.start)} to ${clock(s.end)}${s.edited ? ", changed tonight" : ""}`}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
              {edited ? <span className={styles.srOnly}>Changed tonight</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

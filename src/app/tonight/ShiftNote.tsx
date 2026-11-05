"use client";

import { useActionState } from "react";
import { type NoteState, updateScheduleAction } from "./actions";
import styles from "./page.module.css";

export function ShiftNote({
  nightId,
  suggested,
  last,
  locked,
}: {
  nightId: string;
  suggested: string;
  last: { text: string; applied: string[]; rejected: string[] } | null;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<NoteState, FormData>(updateScheduleAction, {});

  if (locked) {
    return (
      <div className={styles.note}>
        <p className={styles.lockedNote}>Tonight&apos;s tips have gone out, so the schedule is final.</p>
        {last ? <Edits last={last} /> : null}
      </div>
    );
  }

  return (
    <form action={action} className={styles.note}>
      <input type="hidden" name="night" value={nightId} />
      <label htmlFor="note">What changed tonight</label>
      <textarea id="note" name="note" rows={2} defaultValue={last?.text ?? suggested} maxLength={2000} />
      <div className={styles.noteBar}>
        <button type="submit" disabled={pending}>
          {pending ? "Reading the note" : "Update the schedule"}
        </button>
        {state.error ? (
          <p className={styles.noteError} role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      {last ? <Edits last={last} /> : null}
    </form>
  );
}

function Edits({ last }: { last: { applied: string[]; rejected: string[] } }) {
  if (last.applied.length + last.rejected.length === 0) return null;
  return (
    <ul className={styles.edits} aria-label="Changes from the note">
      {last.applied.map((a) => (
        <li key={a}>{a}</li>
      ))}
      {last.rejected.map((r) => (
        <li key={r} className={styles.skipped}>
          Skipped: {r}
        </li>
      ))}
    </ul>
  );
}

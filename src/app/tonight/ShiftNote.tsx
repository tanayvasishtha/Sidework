"use client";

import { useActionState } from "react";
import { type NoteState, updateScheduleAction } from "./actions";
import styles from "./page.module.css";

export function ShiftNote({
  nightId,
  suggested,
  last,
}: {
  nightId: string;
  suggested: string;
  last: { text: string; applied: string[]; rejected: string[] } | null;
}) {
  const [state, action, pending] = useActionState<NoteState, FormData>(updateScheduleAction, {});

  return (
    <form action={action} className={styles.note}>
      <input type="hidden" name="night" value={nightId} />
      <label htmlFor="note">What changed tonight</label>
      <textarea id="note" name="note" rows={3} defaultValue={last?.text ?? suggested} maxLength={2000} />
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
      {last && last.applied.length + last.rejected.length > 0 ? (
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
      ) : null}
    </form>
  );
}

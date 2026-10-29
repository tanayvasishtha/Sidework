"use client";

import { useActionState } from "react";
import { type AskState, askAction } from "./actions";
import styles from "./page.module.css";

const FALLBACK_NOTE = {
  mismatch: "The assistant used a number that isn't in the ledger, so this is the math straight from it.",
  unavailable: "The assistant isn't available right now, so this is the math straight from the ledger.",
};

export function AskWhy({ token, suggested }: { token: string; suggested: string }) {
  const [state, action, pending] = useActionState<AskState, FormData>(askAction, {});
  return (
    <section className={styles.askBox} aria-label="Ask about your tips">
      <form action={action} className={styles.ask}>
        <input type="hidden" name="token" value={token} />
        <input name="question" defaultValue={suggested} maxLength={300} aria-label="Your question" />
        <button type="submit" disabled={pending}>
          {pending ? "Asking" : "Ask"}
        </button>
      </form>
      {state.error ? (
        <p className={styles.askError} role="alert">
          {state.error}
        </p>
      ) : null}
      {state.answer ? (
        <div className={styles.answer} aria-live="polite">
          <p>{state.answer}</p>
          <small>{state.fallback ? FALLBACK_NOTE[state.fallback] : "Every dollar figure here was checked against the ledger."}</small>
        </div>
      ) : null}
    </section>
  );
}

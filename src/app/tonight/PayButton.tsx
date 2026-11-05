"use client";

import { useActionState, useEffect, useTransition } from "react";
import { type CheckState, checkSplitAction, type PayState, payAction, refreshPayoutAction } from "./actions";
import styles from "./page.module.css";

export function PayButton({ nightId, label, disabled }: { nightId: string; label: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<PayState, FormData>(payAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="night" value={nightId} />
      <button className={`${styles.pay} num`} type="submit" disabled={disabled || pending}>
        {pending ? "Sending through PayPal" : label}
      </button>
      {state.error ? (
        <p className={styles.payError} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** The second key: the agent reads the night on its own before anyone is paid. */
export function CheckSplitButton({ nightId }: { nightId: string }) {
  const [state, action, pending] = useActionState<CheckState, FormData>(checkSplitAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="night" value={nightId} />
      <button className={`${styles.pay} num`} type="submit" disabled={pending}>
        {pending ? "Checking the split" : "Check the split"}
      </button>
      {state.error ? (
        <p className={styles.payError} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

const POLL_MS = 4000;
const GIVE_UP_MS = 3 * 60 * 1000;

/** While payouts are still moving, asks PayPal for their status every few seconds. */
export function PayoutWatcher({ nightId, settled }: { nightId: string; settled: boolean }) {
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (settled) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) {
        clearInterval(timer);
        return;
      }
      startTransition(() => refreshPayoutAction(nightId));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [nightId, settled]);
  return null;
}

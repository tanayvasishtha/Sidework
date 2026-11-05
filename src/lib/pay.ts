import type { DatabaseSync } from "node:sqlite";
import { DEAD_BATCH_STATUSES, getCloseout, saveAllocations } from "@/lib/closeout";
import { night as nightName } from "@/lib/format";
import {
  type BatchStatus,
  createPayoutBatch,
  getPayoutBatch,
  type ItemStatus,
  type PayoutBatch,
  type PayoutLine,
  PayPalError,
  type PayPalClient,
  type Wallet,
} from "@/lib/paypal";

export type PayoutRow = {
  id: string;
  staffId: string;
  name: string;
  wallet: Wallet;
  receiver: string;
  cents: number;
  status: ItemStatus;
  error: string | null;
};

export type NightPayout = {
  id: string;
  senderBatchId: string;
  paypalBatchId: string | null;
  /** UNCERTAIN: the call failed in a way that says nothing about whether PayPal took the batch. */
  status: BatchStatus | "SENDING" | "UNCERTAIN" | "FAILED";
  createdAt: string;
  items: PayoutRow[];
};

/** Payment was refused before any money moved. The message is for the manager. */
export class PayRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayRefusedError";
  }
}

/** PayPal's answer was lost. Nothing is marked sent, and the retry can't pay anyone twice. */
export class PayUncertainError extends Error {
  constructor() {
    super("PayPal didn't answer, so we can't tell yet if this went through. Press the button again: it resends the same batch, so nobody gets paid twice.");
    this.name = "PayUncertainError";
  }
}

const SETTLED: ReadonlySet<ItemStatus> = new Set(["SUCCESS", "FAILED", "UNCLAIMED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "CANCELED"]);

export function isSettled(status: ItemStatus): boolean {
  return SETTLED.has(status);
}

/** False for no batch, or one that never moved money. The single answer to "did this go out?". */
export function payoutStands(payout: NightPayout | null): payout is NightPayout {
  return payout !== null && !DEAD_BATCH_STATUSES.includes(payout.status);
}

export function getNightPayout(d: DatabaseSync, nightId: string): NightPayout | null {
  const batch = d
    .prepare(
      "select id, sender_batch_id, paypal_batch_id, status, created_at from payout_batches where night_id = ? order by created_at desc, id desc limit 1",
    )
    .get(nightId) as
    | { id: string; sender_batch_id: string; paypal_batch_id: string | null; status: NightPayout["status"]; created_at: string }
    | undefined;
  if (!batch) return null;
  const items = d
    .prepare(
      `select i.id, i.staff_id, s.name, i.wallet, i.receiver, i.amount_cents, i.status, i.error
       from payout_items i join staff s on s.id = i.staff_id where i.batch_id = ? order by i.amount_cents desc, s.name`,
    )
    .all(batch.id) as {
    id: string;
    staff_id: string;
    name: string;
    wallet: Wallet;
    receiver: string;
    amount_cents: number;
    status: ItemStatus;
    error: string | null;
  }[];
  return {
    id: batch.id,
    senderBatchId: batch.sender_batch_id,
    paypalBatchId: batch.paypal_batch_id,
    status: batch.status,
    createdAt: batch.created_at,
    items: items.map((i) => ({
      id: i.id,
      staffId: i.staff_id,
      name: i.name,
      wallet: i.wallet,
      receiver: i.receiver,
      cents: i.amount_cents,
      status: i.status,
      error: i.error,
    })),
  };
}

/** How long a batch can sit in SENDING before it must have died mid-call. Past every client timeout. */
const SENDING_STALE_MS = 2 * 60 * 1000;

/**
 * Whether PayPal may have accepted a batch whose call failed. A lost connection, a timeout
 * or a 5xx says nothing about what happened on PayPal's side. A 4xx is a clear no.
 */
function mayHaveGoneThrough(err: unknown): boolean {
  return err instanceof PayPalError && (err.status === 0 || err.status >= 500);
}

/**
 * Pays tonight's pool through PayPal Payouts, one item per person, Venmo or PayPal.
 * Refuses unless the rules engine is satisfied, and pays a night only once: when PayPal's
 * answer is lost, the retry resends the same batch id, which PayPal treats as the same batch.
 */
export async function payNight(
  d: DatabaseSync,
  nightId: string,
  client: PayPalClient,
  opts: { baseUrl: string; receivers?: { paypal?: string; venmo?: string }; now?: () => Date },
): Promise<NightPayout> {
  if (!opts.baseUrl.includes("sandbox")) {
    throw new PayRefusedError("Sidework only sends money from the PayPal sandbox.");
  }
  const now = (opts.now ?? (() => new Date()))();
  const existing = getNightPayout(d, nightId);
  const open = payoutStands(existing) ? existing : null;
  if (open?.paypalBatchId) throw new PayRefusedError("Tonight's tips have already been sent.");
  const stale = open?.status === "SENDING" && now.getTime() - Date.parse(open.createdAt) > SENDING_STALE_MS;
  if (open && open.status !== "UNCERTAIN" && !stale) throw new PayRefusedError("Tonight's tips are already on their way.");

  const c = getCloseout(d, nightId);
  if (c.blocking > 0) {
    throw new PayRefusedError(`Fix ${c.blocking === 1 ? "the problem" : `the ${c.blocking} problems`} in the pool first.`);
  }
  const shares = c.split.filter((s) => s.cents > 0);
  if (shares.length === 0) throw new PayRefusedError("There's nothing to pay out tonight.");

  const note = `Your tips from ${c.restaurant.name}, ${nightName(c.night.date)}`;
  let batchId: string;
  let senderBatchId: string;
  let lines: PayoutLine[];

  if (open) {
    // Same id and same items, so PayPal can't see this as a new batch.
    batchId = open.id;
    senderBatchId = open.senderBatchId;
    lines = open.items.map((i) => ({ id: i.id, wallet: i.wallet, receiver: i.receiver, cents: i.cents, note }));
  } else {
    const attempt = (d.prepare("select count(*) as n from payout_batches where night_id = ?").get(nightId) as { n: number }).n + 1;
    batchId = `${nightId}-${attempt}`;
    senderBatchId = `sidework-${batchId}-${now.getTime().toString(36)}`;
    const staff = new Map(c.people.map((p) => [p.id, p]));
    lines = shares.map((s) => ({
      id: `${batchId}:${s.staffId}`,
      wallet: s.wallet,
      receiver: (s.wallet === "VENMO" ? opts.receivers?.venmo : opts.receivers?.paypal) ?? staff.get(s.staffId)?.payoutReceiver ?? "",
      cents: s.cents,
      note,
    }));

    // Recorded before the call, so a second click finds a batch already on its way.
    const stamp = now.toISOString();
    d.exec("begin");
    try {
      d.prepare(
        "insert into payout_batches (id, night_id, sender_batch_id, status, created_at, updated_at) values (?, ?, ?, 'SENDING', ?, ?)",
      ).run(batchId, nightId, senderBatchId, stamp, stamp);
      const add = d.prepare(
        "insert into payout_items (id, batch_id, staff_id, wallet, receiver, amount_cents, status, updated_at) values (?, ?, ?, ?, ?, ?, 'PENDING', ?)",
      );
      for (const [i, l] of lines.entries()) add.run(l.id, batchId, shares[i].staffId, l.wallet, l.receiver, l.cents, stamp);
      d.exec("commit");
    } catch (err) {
      d.exec("rollback");
      throw err;
    }
  }

  let created: PayoutBatch;
  try {
    created = await createPayoutBatch(client, senderBatchId, lines, `Your tips from ${c.restaurant.name}`);
  } catch (err) {
    const stamp = new Date().toISOString();
    if (mayHaveGoneThrough(err)) {
      d.prepare("update payout_batches set status = 'UNCERTAIN', updated_at = ? where id = ?").run(stamp, batchId);
      throw new PayUncertainError();
    }
    const message = err instanceof Error ? err.message : String(err);
    d.prepare("update payout_batches set status = 'FAILED', updated_at = ? where id = ?").run(stamp, batchId);
    d.prepare("update payout_items set status = 'FAILED', error = ? where batch_id = ?").run(message, batchId);
    throw err;
  }

  // PayPal has the batch. Past this line a failure must never mark it as unsent.
  d.prepare("update payout_batches set paypal_batch_id = ?, status = ?, updated_at = ? where id = ?").run(
    created.batchId,
    created.status,
    new Date().toISOString(),
    batchId,
  );
  d.prepare("update nights set status = 'paid' where id = ?").run(nightId);
  saveAllocations(d, nightId, shares);

  // Item ids come from a follow-up read. If it fails, webhooks or the next refresh fill them in.
  await refreshPayout(d, nightId, client).catch(() => undefined);
  return getNightPayout(d, nightId)!;
}

/** PayPal refused the whole batch after accepting it, so nothing was paid and the night is open again. */
function reopenIfDead(d: DatabaseSync, nightId: string, status: string): void {
  if (!DEAD_BATCH_STATUSES.includes(status)) return;
  d.prepare("update nights set status = 'open' where id = ?").run(nightId);
  d.prepare("delete from allocations where night_id = ?").run(nightId);
}

/** Reads the batch back from PayPal and updates each person's status. */
export async function refreshPayout(d: DatabaseSync, nightId: string, client: PayPalClient): Promise<NightPayout | null> {
  const payout = getNightPayout(d, nightId);
  if (!payout?.paypalBatchId) return payout;
  const batch = await getPayoutBatch(client, payout.paypalBatchId);
  const stamp = new Date().toISOString();
  const update = d.prepare(
    "update payout_items set status = ?, paypal_item_id = coalesce(?, paypal_item_id), error = ?, updated_at = ? where id = ? and batch_id = ?",
  );
  for (const item of batch.items) update.run(item.status, item.itemId, item.error ?? null, stamp, item.lineId, payout.id);
  d.prepare("update payout_batches set status = ?, updated_at = ? where id = ?").run(batch.status, stamp, payout.id);
  reopenIfDead(d, nightId, batch.status);
  return getNightPayout(d, nightId);
}

type WebhookEvent = {
  event_type?: string;
  resource?: {
    payout_item_id?: string;
    transaction_status?: ItemStatus;
    payout_item?: { sender_item_id?: string };
    errors?: { name?: string; message?: string };
    batch_header?: { payout_batch_id?: string; batch_status?: BatchStatus };
  };
};

/** Applies a verified PayPal webhook. Returns false for events about payouts we don't know. */
export function applyPayoutEvent(d: DatabaseSync, event: WebhookEvent): boolean {
  const type = event.event_type ?? "";
  const r = event.resource ?? {};
  const stamp = new Date().toISOString();

  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.") && r.transaction_status) {
    const res = d
      .prepare(
        `update payout_items set status = ?, paypal_item_id = coalesce(paypal_item_id, ?), error = ?, updated_at = ?
         where (paypal_item_id = ? or id = ?) and not (status = 'SUCCESS' and ? in ('PENDING', 'ONHOLD', 'UNCLAIMED'))`,
      )
      .run(
        r.transaction_status,
        r.payout_item_id ?? null,
        r.errors?.message ?? r.errors?.name ?? null,
        stamp,
        r.payout_item_id ?? "",
        r.payout_item?.sender_item_id ?? "",
        // PayPal resends events, so an old "unclaimed" can arrive after the payout succeeded.
        r.transaction_status,
      );
    return Number(res.changes) > 0;
  }

  if (type.startsWith("PAYMENT.PAYOUTSBATCH.") && r.batch_header?.payout_batch_id && r.batch_header.batch_status) {
    const res = d
      .prepare("update payout_batches set status = ?, updated_at = ? where paypal_batch_id = ?")
      .run(r.batch_header.batch_status, stamp, r.batch_header.payout_batch_id);
    const batch = d.prepare("select night_id from payout_batches where paypal_batch_id = ?").get(r.batch_header.payout_batch_id) as
      | { night_id: string }
      | undefined;
    if (batch) reopenIfDead(d, batch.night_id, r.batch_header.batch_status);
    return Number(res.changes) > 0;
  }

  return false;
}

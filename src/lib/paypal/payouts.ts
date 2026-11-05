import type { PayPalClient } from "./client";
import { centsToValue, valueToCents } from "./money";

export type Wallet = "VENMO" | "PAYPAL";

export type PayoutLine = {
  /** Our id for this line, sent as sender_item_id so webhooks map back to it. */
  id: string;
  wallet: Wallet;
  /** Email, US mobile number, or a Venmo handle starting with @. */
  receiver: string;
  cents: number;
  note: string;
};

export type RecipientType = "EMAIL" | "PHONE" | "USER_HANDLE";

export type BatchStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";

export type ItemStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED"
  | "CANCELED";

export type PayoutItem = {
  itemId: string;
  lineId: string;
  status: ItemStatus;
  wallet: Wallet;
  cents: number;
  error?: string;
};

export type PayoutBatch = { batchId: string; status: BatchStatus; items: PayoutItem[] };

export function recipientType(receiver: string, wallet: Wallet): RecipientType {
  const r = receiver.trim();
  if (r.includes("@") && !r.startsWith("@")) return "EMAIL";
  if (/^\+?1?[\s\-().]*\d{3}[\s\-().]*\d{3}[\s\-().]*\d{4}$/.test(r)) return "PHONE";
  if (r.startsWith("@") && wallet === "VENMO") return "USER_HANDLE";
  throw new Error(`Can't pay "${receiver}" by ${wallet}. Use an email, a US mobile number, or a Venmo @handle.`);
}

function receiverValue(receiver: string, type: RecipientType): string {
  const r = receiver.trim();
  if (type === "PHONE") return r.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (type === "USER_HANDLE") return r.slice(1);
  return r;
}

export function payoutBatchBody(senderBatchId: string, lines: PayoutLine[], emailSubject: string) {
  if (lines.length === 0) throw new Error("A payout batch needs at least one person.");
  if (senderBatchId.length > 127) throw new Error("sender_batch_id is limited to 127 characters.");
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.id)) throw new Error(`Payout line ${l.id} appears twice.`);
    seen.add(l.id);
    if (l.cents <= 0) throw new Error(`Payout to ${l.id} must be more than $0.00.`);
  }

  return {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: emailSubject },
    items: lines.map((l) => {
      const type = recipientType(l.receiver, l.wallet);
      return {
        recipient_type: type,
        recipient_wallet: l.wallet,
        receiver: receiverValue(l.receiver, type),
        amount: { currency: "USD", value: centsToValue(l.cents) },
        // Venmo rejects items without a note.
        note: l.note,
        sender_item_id: l.id,
      };
    }),
  };
}

type BatchResponse = {
  batch_header: { payout_batch_id: string; batch_status: BatchStatus };
  items?: {
    payout_item_id: string;
    transaction_status: ItemStatus;
    payout_item: {
      sender_item_id: string;
      recipient_wallet?: Wallet;
      amount: { currency: string; value: string };
    };
    errors?: { name?: string; message?: string };
  }[];
};

function toBatch(res: BatchResponse): PayoutBatch {
  return {
    batchId: res.batch_header.payout_batch_id,
    status: res.batch_header.batch_status,
    items: (res.items ?? []).map((i) => ({
      itemId: i.payout_item_id,
      lineId: i.payout_item.sender_item_id,
      status: i.transaction_status,
      wallet: i.payout_item.recipient_wallet ?? "PAYPAL",
      cents: valueToCents(i.payout_item.amount.value),
      error: i.errors?.message ?? i.errors?.name,
    })),
  };
}

export async function createPayoutBatch(
  client: PayPalClient,
  senderBatchId: string,
  lines: PayoutLine[],
  emailSubject = "Your tips from tonight",
): Promise<PayoutBatch> {
  const res = await client.request<BatchResponse>("POST", "/v1/payments/payouts", {
    body: payoutBatchBody(senderBatchId, lines, emailSubject),
    requestId: senderBatchId,
  });
  return toBatch(res);
}

export async function getPayoutBatch(client: PayPalClient, batchId: string): Promise<PayoutBatch> {
  const res = await client.request<BatchResponse>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
    query: { page_size: 1000 },
  });
  return toBatch(res);
}

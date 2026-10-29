"use server";

import { revalidatePath } from "next/cache";
import { applyShiftNote } from "@/lib/agent/shifts";
import { getCloseout, saveShiftEdits, takeOut } from "@/lib/closeout";
import { db, getStaff, resetDemo } from "@/lib/db";
import { PayRefusedError, payNight, refreshPayout } from "@/lib/pay";
import { PayPalError, paypal } from "@/lib/paypal";
import { ReplayMissError } from "@/lib/replay";
import { RULES, type RuleId } from "@/lib/rules";
import { settings } from "@/lib/settings";

export type NoteState = { error?: string };
export type PayState = { error?: string };

export async function takeOutAction(formData: FormData): Promise<void> {
  const nightId = String(formData.get("night"));
  const staffId = String(formData.get("staff"));
  const ruleId = String(formData.get("rule"));
  if (!(ruleId in RULES)) throw new Error(`Unknown rule ${ruleId}.`);
  takeOut(db(), nightId, staffId, ruleId as RuleId);
  revalidatePath("/tonight");
}

export async function updateScheduleAction(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const nightId = String(formData.get("night"));
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Write what changed tonight first." };
  if (note.length > 2000) return { error: "That note is too long. Keep it under 2,000 characters." };

  const d = db();
  const closeout = getCloseout(d, nightId);
  // The whole staff, not just tonight's schedule, so someone who picked up a shift can be found.
  const roster = getStaff(d, closeout.restaurant.id).map((p) => ({ id: p.id, name: p.name, role: p.title }));
  const shifts = closeout.people.flatMap((p) =>
    p.shifts.map((s) => ({ staffId: s.staffId, station: s.station, start: s.start, end: s.end })),
  );
  try {
    const result = await applyShiftNote(note, roster, shifts);
    saveShiftEdits(d, nightId, note, result);
  } catch (err) {
    if (err instanceof ReplayMissError) {
      return { error: "This demo runs from recorded answers, and this note wasn't recorded. Use the note as written, or add an OpenAI key to read new ones." };
    }
    return { error: err instanceof Error ? err.message : "The note couldn't be read. Try again." };
  }
  revalidatePath("/tonight");
  return {};
}

export async function payAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const nightId = String(formData.get("night"));
  const s = settings();
  try {
    await payNight(db(), nightId, paypal(), {
      baseUrl: s.PAYPAL_API_BASE,
      receivers: { paypal: s.PAYPAL_SANDBOX_RECEIVER, venmo: s.PAYPAL_SANDBOX_VENMO_RECEIVER },
    });
  } catch (err) {
    revalidatePath("/tonight");
    if (err instanceof PayRefusedError) return { error: err.message };
    if (err instanceof ReplayMissError) {
      return { error: "This demo runs from recorded sandbox payouts, and this one wasn't recorded. Add PayPal sandbox keys to send it for real." };
    }
    if (err instanceof PayPalError) return { error: `PayPal didn't take the batch. ${err.message}` };
    return { error: err instanceof Error ? err.message : "The payout didn't go through. Try again." };
  }
  revalidatePath("/tonight");
  return {};
}

/** Reads payout status back from PayPal, for when webhooks can't reach this server. */
export async function refreshPayoutAction(nightId: string): Promise<void> {
  await refreshPayout(db(), nightId, paypal()).catch(() => undefined);
  revalidatePath("/tonight");
}

export async function resetDemoAction(): Promise<void> {
  resetDemo();
  revalidatePath("/tonight");
}

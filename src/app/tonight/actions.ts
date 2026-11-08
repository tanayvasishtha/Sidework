"use server";

import { revalidatePath } from "next/cache";
import { applyShiftNote } from "@/lib/agent/shifts";
import { acceptEngineSplit, getCloseout, NIGHT_LOCKED, saveShiftEdits, takeOut } from "@/lib/closeout";
import { db, getStaff, resetDemo } from "@/lib/db";
import { PayRefusedError, PayUncertainError, payNight, refreshPayout } from "@/lib/pay";
import { PayPalError, paypal } from "@/lib/paypal";
import { ReplayMissError } from "@/lib/replay";
import { RULES, type RuleId } from "@/lib/rules";
import { settings } from "@/lib/settings";
import { runSplitCheck } from "@/lib/splitcheck";

export type NoteState = { error?: string };
export type PayState = { error?: string };
export type CheckState = { error?: string };

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
  try {
    const closeout = getCloseout(d, nightId);
    if (closeout.locked) return { error: NIGHT_LOCKED };
    // The whole staff, not just tonight's schedule, so someone who picked up a shift can be found.
    const roster = getStaff(d, closeout.restaurant.id).map((p) => ({ id: p.id, name: p.name, role: p.title }));
    const shifts = closeout.people.flatMap((p) =>
      p.shifts.map((s) => ({ staffId: s.staffId, station: s.station, start: s.start, end: s.end })),
    );
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

export async function checkSplitAction(_prev: CheckState, formData: FormData): Promise<CheckState> {
  try {
    await runSplitCheck(db(), String(formData.get("night")));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The split couldn't be checked. Try again." };
  }
  revalidatePath("/tonight");
  return {};
}

export async function acceptEngineAction(formData: FormData): Promise<void> {
  acceptEngineSplit(db(), String(formData.get("night")));
  revalidatePath("/tonight");
}

export async function payAction(_prev: PayState, formData: FormData): Promise<PayState> {
  const nightId = String(formData.get("night"));
  const s = settings();
  try {
    await payNight(db(), nightId, paypal(), {
      baseUrl: s.PAYPAL_API_BASE,
      sandboxReceiver: s.PAYPAL_SANDBOX_RECEIVER,
    });
  } catch (err) {
    revalidatePath("/tonight");
    if (err instanceof PayRefusedError || err instanceof PayUncertainError) return { error: err.message };
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
  try {
    await refreshPayout(db(), nightId, paypal());
  } catch {
    // The next poll or a webhook will catch up.
  }
  revalidatePath("/tonight");
}

export async function resetDemoAction(): Promise<void> {
  resetDemo();
  revalidatePath("/tonight");
}

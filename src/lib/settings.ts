import { z } from "zod";

const schema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_API_BASE: z.string().url().default("https://api-m.sandbox.paypal.com"),
  DATABASE_PATH: z.string().default("data/sidework.db"),
  REPLAY: z.enum(["auto", "record", "off"]).default("auto"),
});

export type Mode = "live" | "replay";

export type Settings = z.infer<typeof schema> & {
  mode: Mode;
  hasOpenAI: boolean;
  hasPayPal: boolean;
};

export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") ?? "unknown";
    throw new Error(`Setting ${field} is invalid. Check your .env.local against .env.example.`);
  }
  const s = parsed.data;
  const hasOpenAI = Boolean(s.OPENAI_API_KEY);
  const hasPayPal = Boolean(s.PAYPAL_CLIENT_ID && s.PAYPAL_CLIENT_SECRET);

  // With REPLAY=auto the app runs live only when every key is present,
  // so a judge with no keys gets the recorded responses.
  const mode: Mode =
    s.REPLAY === "off" || s.REPLAY === "record" || (hasOpenAI && hasPayPal) ? "live" : "replay";

  return { ...s, mode, hasOpenAI, hasPayPal };
}

let cached: Settings | undefined;

export function settings(): Settings {
  cached ??= loadSettings();
  return cached;
}

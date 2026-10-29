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
  FIXTURES_DIR: z.string().default("fixtures"),
});

export type Mode = "live" | "replay";

/** How one outside service is reached: for real, for real while saving responses, or from saved responses. */
export type ServiceMode = "live" | "record" | "replay";

export type Settings = z.infer<typeof schema> & {
  mode: Mode;
  paypalMode: ServiceMode;
  llmMode: ServiceMode;
  hasOpenAI: boolean;
  hasPayPal: boolean;
};

function serviceMode(replay: "auto" | "record" | "off", hasKeys: boolean): ServiceMode {
  if (replay === "record") return "record";
  if (replay === "off" || hasKeys) return "live";
  return "replay";
}

export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") ?? "unknown";
    throw new Error(`Setting ${field} is invalid. Check your .env.local against .env.example.`);
  }
  const s = parsed.data;
  const hasOpenAI = Boolean(s.OPENAI_API_KEY);
  const hasPayPal = Boolean(s.PAYPAL_CLIENT_ID && s.PAYPAL_CLIENT_SECRET);

  // With REPLAY=auto each service runs live once its keys are set, so PayPal can be
  // tested before there's an LLM key. A judge with no keys gets every recorded response.
  const paypalMode = serviceMode(s.REPLAY, hasPayPal);
  const llmMode = serviceMode(s.REPLAY, hasOpenAI);
  const mode: Mode = paypalMode !== "replay" && llmMode !== "replay" ? "live" : "replay";

  return { ...s, mode, paypalMode, llmMode, hasOpenAI, hasPayPal };
}

let cached: Settings | undefined;

export function settings(): Settings {
  cached ??= loadSettings();
  return cached;
}

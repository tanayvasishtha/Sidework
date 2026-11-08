import { randomBytes } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_API_BASE: z.string().url().default("https://api-m.sandbox.paypal.com"),
  // A sandbox personal account that stands in for every staff member, so test payouts
  // land somewhere they can be claimed. Staff emails like maria@sidework.test can't be.
  PAYPAL_SANDBOX_RECEIVER: z.string().email().optional(),
  DATABASE_PATH: z.string().default("data/sidework.db"),
  // Signs each worker's private check link. Set it anywhere links must outlive a restart.
  CHECK_SECRET: z.string().min(16).optional(),
  // Render sets this on every service it runs.
  RENDER: z.string().optional(),
  REPLAY: z.enum(["auto", "record", "off"]).default("auto"),
  FIXTURES_DIR: z.string().default("fixtures"),
});

export type Mode = "live" | "replay";

/** How one outside service is reached: for real, for real while saving responses, or from saved responses. */
export type ServiceMode = "live" | "record" | "replay";

export type Settings = z.infer<typeof schema> & {
  /** Signs worker check links. Never the public fallback on a public host. */
  checkSecret: string;
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
  // A line copied from .env.example and left blank means "not set".
  const given = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(given);
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

  // The local fallback is in the public repo, so it may only sign links on a private machine.
  // A public host with no CHECK_SECRET makes its own key at startup: nobody else knows it,
  // and links stay good until the server restarts.
  const checkSecret = s.CHECK_SECRET ?? (s.RENDER ? randomBytes(32).toString("hex") : "sidework-local-demo-secret");

  return { ...s, checkSecret, mode, paypalMode, llmMode, hasOpenAI, hasPayPal };
}

let cached: Settings | undefined;

export function settings(): Settings {
  cached ??= loadSettings();
  return cached;
}

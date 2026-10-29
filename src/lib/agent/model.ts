import { join } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { replayFetch } from "@/lib/replay";
import { settings } from "@/lib/settings";

let shared: LanguageModel | undefined;

/** The model every agent step uses. With no key it answers from recorded responses. */
export function model(): LanguageModel {
  const s = settings();
  if (s.llmMode !== "replay" && !s.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.local, or remove it everywhere to run from recordings.");
  }
  shared ??= createOpenAI({
    apiKey: s.OPENAI_API_KEY ?? "replay",
    fetch: replayFetch({ mode: s.llmMode, dir: join(s.FIXTURES_DIR, "llm") }),
  })(s.OPENAI_MODEL);
  return shared;
}

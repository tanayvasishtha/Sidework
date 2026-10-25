import { describe, expect, it } from "vitest";
import { loadSettings } from "./settings";

describe("loadSettings", () => {
  it("runs in replay mode with no keys", () => {
    const s = loadSettings({});
    expect(s.mode).toBe("replay");
    expect(s.PAYPAL_API_BASE).toBe("https://api-m.sandbox.paypal.com");
  });

  it("runs live when OpenAI and PayPal keys are both set", () => {
    const s = loadSettings({
      OPENAI_API_KEY: "sk-test",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret",
    });
    expect(s.mode).toBe("live");
  });

  it("stays in replay when only one key is set", () => {
    expect(loadSettings({ OPENAI_API_KEY: "sk-test" }).mode).toBe("replay");
  });

  it("names the bad field in its error", () => {
    expect(() => loadSettings({ REPLAY: "sometimes" })).toThrow("REPLAY");
  });
});

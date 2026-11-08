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

  it("runs PayPal live as soon as its keys are set", () => {
    const s = loadSettings({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    expect([s.paypalMode, s.llmMode]).toEqual(["live", "replay"]);
  });

  it("records both services with REPLAY=record", () => {
    const s = loadSettings({ REPLAY: "record" });
    expect([s.paypalMode, s.llmMode]).toEqual(["record", "record"]);
  });

  it("treats blank lines copied from .env.example as not set", () => {
    const s = loadSettings({ OPENAI_API_KEY: "", PAYPAL_SANDBOX_RECEIVER: "", CHECK_SECRET: " ", REPLAY: "" });
    expect(s.mode).toBe("replay");
    expect(s.PAYPAL_SANDBOX_RECEIVER).toBeUndefined();
    expect(s.checkSecret.length).toBeGreaterThanOrEqual(16);
  });

  it("never signs worker links with the public fallback on Render", () => {
    const made = loadSettings({ RENDER: "true" }).checkSecret;
    expect(made).toMatch(/^[0-9a-f]{64}$/);
    expect(loadSettings({ RENDER: "true" }).checkSecret).not.toBe(made);
    expect(loadSettings({ RENDER: "true", CHECK_SECRET: "a-long-random-secret-value" }).checkSecret).toBe("a-long-random-secret-value");
    expect(loadSettings({}).checkSecret).toBe("sidework-local-demo-secret");
  });

  it("names the bad field in its error", () => {
    expect(() => loadSettings({ REPLAY: "sometimes" })).toThrow("REPLAY");
  });
});

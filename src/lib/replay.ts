import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServiceMode } from "@/lib/settings";

export type Recording = {
  request: { method: string; url: string; body: unknown };
  response: { status: number; contentType: string; body: string };
};

export class ReplayMissError extends Error {
  constructor(method: string, url: string, key: string) {
    super(
      `No recorded response for ${method} ${url} (fixture ${key}). ` +
        "Add your keys to .env.local and run once with REPLAY=record to record it.",
    );
    this.name = "ReplayMissError";
  }
}

// Recorded responses go in a public repo, so anything that grants access is blanked.
const SECRET_KEYS = new Set(["access_token", "refresh_token", "id_token", "client_secret", "nonce"]);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.has(k) ? "redacted" : redact(v)]),
    );
  }
  return value;
}

function bodyText(body: RequestInit["body"]): string {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error("Replay can only record string and form bodies.");
}

/** Parsed JSON with keys in a fixed order, so the same request always hashes the same. */
function canonicalBody(text: string): unknown {
  if (!text) return null;
  try {
    return sortKeys(JSON.parse(text));
  } catch {
    return text;
  }
}

/** Headers are left out on purpose: they carry keys and tokens, and they don't change the answer. */
export function requestKey(method: string, url: string, body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify([method.toUpperCase(), url, body]))
    .digest("hex")
    .slice(0, 16);
}

export function replayFetch(opts: { mode: ServiceMode; dir: string; fetch?: typeof fetch }): typeof fetch {
  const live = opts.fetch ?? fetch;
  if (opts.mode === "live") return live;

  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = canonicalBody(bodyText(init.body));
    const key = requestKey(method, url, body);
    const file = join(opts.dir, `${key}.json`);

    if (opts.mode === "replay") {
      let saved: Recording;
      try {
        saved = JSON.parse(readFileSync(file, "utf8")) as Recording;
      } catch {
        throw new ReplayMissError(method, url, key);
      }
      return new Response(saved.response.status === 204 ? null : saved.response.body, {
        status: saved.response.status,
        headers: { "content-type": saved.response.contentType },
      });
    }

    const res = await live(input, init);
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "application/json";
    let stored = text;
    try {
      stored = JSON.stringify(redact(JSON.parse(text)), null, 2);
    } catch {
      // Not JSON; store as it came.
    }
    const recording: Recording = {
      request: { method, url, body: redact(body) },
      response: { status: res.status, contentType, body: stored },
    };
    mkdirSync(opts.dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
    // The caller still gets the unredacted response.
    return new Response(res.status === 204 ? null : text, { status: res.status, headers: { "content-type": contentType } });
  }) as typeof fetch;
}

export type PayPalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Sent as PayPal-Request-Id, so a retried POST is not run twice. */
  requestId?: string;
};

type Issue = { issue?: string; field?: string; description?: string };

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue: string,
    readonly debugId?: string,
    readonly details: Issue[] = [],
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

// Refresh a minute early so a token never expires mid-request.
const EARLY_REFRESH_MS = 60_000;

export function createPayPalClient(config: PayPalConfig) {
  const rawFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const base = config.baseUrl.replace(/\/+$/, "");

  async function doFetch(url: string | URL, init: RequestInit): Promise<Response> {
    try {
      return await rawFetch(url, init);
    } catch (err) {
      const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new PayPalError(`Couldn't reach PayPal at ${base}: ${cause}`, 0, "NETWORK_ERROR");
    }
  }

  let token: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await doFetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new PayPalError(
        `PayPal sign-in failed: ${data.error_description ?? res.statusText}. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`,
        res.status,
        data.error ?? "AUTH_FAILED",
      );
    }
    token = { value: data.access_token, expiresAt: now() + (data.expires_in ?? 0) * 1000 - EARLY_REFRESH_MS };
    return token.value;
  }

  async function accessToken(): Promise<string> {
    if (token && now() < token.expiresAt) return token.value;
    // Parallel requests share one token fetch.
    pending ??= fetchToken().finally(() => {
      pending = undefined;
    });
    return pending;
  }

  async function send(method: string, path: string, opts: RequestOptions, bearer: string): Promise<Response> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${bearer}`, Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    return doFetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    let res = await send(method, path, opts, await accessToken());
    if (res.status === 401) {
      // PayPal can revoke a token before its stated expiry.
      token = undefined;
      res = await send(method, path, opts, await accessToken());
    }
    if (res.status === 204) return undefined as T;

    const data = (await res.json().catch(() => ({}))) as {
      name?: string;
      message?: string;
      debug_id?: string;
      details?: Issue[];
    };
    if (!res.ok) {
      const first = data.details?.[0];
      const detail = first ? ` (${first.issue}${first.field ? ` at ${first.field}` : ""})` : "";
      throw new PayPalError(
        `PayPal ${method} ${path} failed: ${data.message ?? res.statusText}${detail}`,
        res.status,
        data.name ?? "UNKNOWN_ERROR",
        data.debug_id,
        data.details,
      );
    }
    return data as T;
  }

  return { accessToken, request };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

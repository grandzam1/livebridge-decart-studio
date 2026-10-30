import "server-only";

import { jsonError } from "@/lib/api";

export const UPSTREAM_TIMEOUT_MS = 10_000;

export type UpstreamProvider = { name: "Decart" | "FAL"; keyName: "DECART_API_KEY" | "FAL_KEY" };

/** A non-2xx response from a provider. `detail` is for server logs only. */
export class UpstreamHttpError extends Error {
  constructor(readonly status: number, detail: string) {
    super(detail);
    this.name = "UpstreamHttpError";
  }
}

class UpstreamTimeoutError extends Error {
  constructor() {
    super(`timed out after ${UPSTREAM_TIMEOUT_MS} ms`);
    this.name = "UpstreamTimeoutError";
  }
}

/** Rejects if `promise` does not settle within UPSTREAM_TIMEOUT_MS (for SDK calls that accept no AbortSignal). */
export async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamTimeoutError()), UPSTREAM_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Failure =
  | { kind: "http"; status: number; detail: string }
  | { kind: "timeout"; detail: string }
  | { kind: "network"; detail: string }
  | { kind: "unknown"; detail: string };

function classify(error: unknown): Failure {
  if (error instanceof UpstreamHttpError) return { kind: "http", status: error.status, detail: error.message };
  if (error instanceof UpstreamTimeoutError) return { kind: "timeout", detail: error.message };
  if (error instanceof DOMException && error.name === "TimeoutError") return { kind: "timeout", detail: error.message };

  // Decart SDK errors are plain objects: { code, message, data: { status } }.
  if (error && typeof error === "object" && !(error instanceof Error)) {
    const sdk = error as { code?: unknown; message?: unknown; data?: { status?: unknown } };
    const detail = `${String(sdk.code ?? "SDK_ERROR")}: ${String(sdk.message ?? "")}`;
    if (typeof sdk.data?.status === "number") return { kind: "http", status: sdk.data.status, detail };
    return { kind: "unknown", detail };
  }

  // Node's fetch throws TypeError("fetch failed") with a cause such as ENOTFOUND / ECONNREFUSED.
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
    const reason = cause ? String(cause.code ?? cause.message ?? "") : "";
    return { kind: "network", detail: reason ? `${error.message} (${reason})` : error.message };
  }

  return { kind: "unknown", detail: error instanceof Error ? error.message : String(error) };
}

/** Logs the real cause server-side and returns a user-facing error response with a concrete fix. */
export function upstreamErrorResponse(provider: UpstreamProvider, error: unknown) {
  const failure = classify(error);
  const { name, keyName } = provider;
  console.error(`${name} token request failed [${failure.kind}${failure.kind === "http" ? ` ${failure.status}` : ""}]:`, failure.detail.slice(0, 500));

  switch (failure.kind) {
    case "timeout":
      return jsonError(504, "UPSTREAM_UNAVAILABLE", `${name} did not respond within ${UPSTREAM_TIMEOUT_MS / 1000} seconds.`, "Check the server's internet connection and try again.");
    case "network":
      return jsonError(503, "UPSTREAM_UNAVAILABLE", `The server could not reach ${name}.`, "Check the server's internet connection, firewall, or proxy settings.");
    case "unknown":
      return jsonError(502, "UPSTREAM_ERROR", `Could not create a ${name} session token.`, "Check the server terminal for details.");
    case "http": {
      const { status } = failure;
      if (status === 401 || status === 403) {
        return jsonError(502, "UPSTREAM_AUTH", `${name} rejected the API key.`, `Check ${keyName} in .env (copy it again from your ${name} dashboard) and restart the server.`);
      }
      if (status === 402 || status === 429) {
        return jsonError(429, "UPSTREAM_QUOTA", `${name} quota or rate limit reached.`, `Wait a minute and try again, or check credits and billing in your ${name} account.`);
      }
      if (status >= 500) {
        return jsonError(503, "UPSTREAM_UNAVAILABLE", `${name} is temporarily unavailable (HTTP ${status}).`, "Try again in a minute.");
      }
      return jsonError(502, "UPSTREAM_ERROR", `${name} rejected the token request (HTTP ${status}).`, `Check that your ${name} account has access to the models in livebridge.config.ts.`);
    }
  }
}

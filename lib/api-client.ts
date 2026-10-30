import { isApiErrorBody, type ErrorCode } from "@/lib/errors";

/** A failed LiveBridge API call, carrying the server's code and fix hint. */
export class ApiError extends Error {
  constructor(message: string, readonly code: ErrorCode, readonly status: number, readonly hint?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type ErrorView = { message: string; hint?: string };

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** fetch() for LiveBridge API routes: returns parsed JSON or throws ApiError. Abort errors are rethrown unchanged. */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: "no-store", ...init });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError("Could not reach the LiveBridge server.", "NETWORK", 0, "Check that the server is running, then try again.");
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorBody(payload)) throw new ApiError(payload.message, payload.code, response.status, payload.hint);
    throw new ApiError(`The server returned an unexpected error (HTTP ${response.status}).`, "INTERNAL", response.status, "Check the server terminal for details.");
  }
  if (payload === undefined) {
    throw new ApiError("The server returned an unreadable response.", "INTERNAL", response.status, "Check the server terminal for details.");
  }
  return payload as T;
}

/** Normalizes anything thrown into a message (and hint, for API errors) for display. */
export function toErrorView(error: unknown, fallback: string): ErrorView {
  if (error instanceof ApiError) return { message: error.message, hint: error.hint };
  if (error instanceof Error && error.message) return { message: error.message };
  return { message: fallback };
}

export const ERROR_CODES = [
  "CONFIG_MISSING",
  "CONFIG_INVALID",
  "ORIGIN_NOT_ALLOWED",
  "PROVIDER_INACTIVE",
  "BAD_REQUEST",
  "UNSUPPORTED_MODEL",
  "RATE_LIMITED",
  "UPSTREAM_AUTH",
  "UPSTREAM_QUOTA",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_ERROR",
  "INTERNAL",
  // Client-only: the browser could not reach the LiveBridge server.
  "NETWORK",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** JSON body returned by every API route on failure. */
export type ApiErrorBody = {
  code: ErrorCode;
  /** What went wrong, safe to show to the user. */
  message: string;
  /** How to fix it, when there is a concrete action. */
  hint?: string;
};

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.message === "string" &&
    (ERROR_CODES as readonly unknown[]).includes(body.code) &&
    (body.hint === undefined || typeof body.hint === "string")
  );
}

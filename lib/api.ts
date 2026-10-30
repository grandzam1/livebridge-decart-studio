import "server-only";

import { NextResponse } from "next/server";
import { getConfiguredAppOrigins, isDevelopment, publicConfig } from "@/lib/config";
import type { ApiErrorBody, ErrorCode } from "@/lib/errors";

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonOk<T>(data: T, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status, headers: NO_STORE });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

export function jsonError(status: number, code: ErrorCode, message: string, hint?: string, headers?: Record<string, string>) {
  const body: ApiErrorBody = hint ? { code, message, hint } : { code, message };
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** 503 for one or more unset environment variables. */
export function missingConfig(names: string[]) {
  const list = names.join(" and ");
  return jsonError(
    503,
    "CONFIG_MISSING",
    `${list} ${names.length > 1 ? "are" : "is"} not set on the server.`,
    `Add ${list} to .env and restart the server.`,
  );
}

/** Dev-only escape hatch: exact-host loopback origins on any port (no suffix tricks like localhost.evil.com). */
function isLoopbackOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** Returns the allowlisted request origin, or an error response to send back as-is. */
export function requireOrigin(request: Request): { origin: string } | NextResponse {
  const allowed = getConfiguredAppOrigins();
  if (allowed.length === 0) return missingConfig(["APP_ORIGINS"]);

  const origin = request.headers.get("origin");
  if (origin && (allowed.includes(origin) || (isDevelopment() && publicConfig.dev.allowLoopbackOrigins && isLoopbackOrigin(origin)))) {
    return { origin };
  }

  if (!origin) {
    return jsonError(403, "ORIGIN_NOT_ALLOWED", "This request did not come from the studio page.", "Open the studio in a browser and try again.");
  }
  return jsonError(
    403,
    "ORIGIN_NOT_ALLOWED",
    "This site is not in the server's allowed origins.",
    isDevelopment()
      ? `Add ${origin} to APP_ORIGINS in .env and restart the server.`
      : "Add this site's origin to APP_ORIGINS on the server.",
  );
}

/** Parses a JSON object body, or returns a 400 error response. */
export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<Partial<T> | NextResponse> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Partial<T>;
  } catch {
    // Fall through to the error response.
  }
  return jsonError(400, "BAD_REQUEST", "The request body must be a JSON object.");
}

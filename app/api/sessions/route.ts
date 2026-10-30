import { NextResponse } from "next/server";
import { jsonError, jsonOk, noContent, readJson, requireOrigin } from "@/lib/api";
import { appendSessionEvent, readSessionEvents, SESSION_EVENT_TYPES, SESSION_PROVIDERS, type SessionEvent, type SessionProvider } from "@/lib/session-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 500;
const MAX_DETAIL = 2000;

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}

export async function GET() {
  return jsonOk({ events: await readSessionEvents(50) });
}

type SessionEventBody = {
  type?: unknown;
  provider?: unknown;
  mode?: unknown;
  detail?: unknown;
  reference?: unknown;
  seconds?: unknown;
};

export async function POST(request: Request) {
  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  const body = await readJson<SessionEventBody>(request);
  if (body instanceof NextResponse) return body;

  if (!SESSION_EVENT_TYPES.includes(body.type as never)) {
    return jsonError(400, "BAD_REQUEST", "Invalid session event type.");
  }
  if (!SESSION_PROVIDERS.includes(body.provider as never)) {
    return jsonError(400, "BAD_REQUEST", "Invalid provider.");
  }
  const mode = text(body.mode, MAX_TEXT);
  if (!mode) return jsonError(400, "BAD_REQUEST", "Invalid mode.");

  const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) && body.seconds >= 0 && body.seconds <= 86_400
    ? Math.floor(body.seconds)
    : undefined;

  await appendSessionEvent({
    type: body.type as SessionEvent["type"],
    provider: body.provider as SessionProvider,
    mode,
    detail: text(body.detail, MAX_DETAIL) ?? undefined,
    reference: text(body.reference, MAX_TEXT) ?? undefined,
    seconds,
  });
  return noContent();
}

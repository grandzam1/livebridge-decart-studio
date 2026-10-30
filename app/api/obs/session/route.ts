import { NextResponse } from "next/server";
import { jsonError, noContent, readJson, requireOrigin } from "@/lib/api";
import { isRealtimeModelName, type RealtimeModelName } from "@/lib/decart";
import { publishObsSession } from "@/lib/obs-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,80}$/.test(value);
}

export async function POST(request: Request) {
  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  const body = await readJson<{ sessionId: unknown; subscribeToken: unknown; model: unknown }>(request);
  if (body instanceof NextResponse) return body;

  if (!isSessionId(body.sessionId)) {
    return jsonError(400, "BAD_REQUEST", "Invalid session id.");
  }

  const sessionId = body.sessionId;
  let update: { sessionId: string; subscribeToken: null } | { sessionId: string; subscribeToken: string; model: RealtimeModelName };
  if (body.subscribeToken === null) {
    update = { sessionId, subscribeToken: null };
  } else if (typeof body.subscribeToken === "string" && body.subscribeToken.length > 0 && body.subscribeToken.length <= 4096 && isRealtimeModelName(body.model)) {
    update = { sessionId, subscribeToken: body.subscribeToken, model: body.model };
  } else {
    return jsonError(400, "BAD_REQUEST", "Invalid live session update.");
  }

  publishObsSession(update);
  return noContent();
}

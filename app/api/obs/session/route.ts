import { NextResponse } from "next/server";
import { isRealtimeModelName, type RealtimeModelName } from "@/lib/decart";
import { publishObsSession } from "@/lib/obs-state";
import { isAllowedRequestOrigin } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,80}$/.test(value);
}

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { error: "Live session updates must come from a configured app origin." },
      { status: 403, headers: noStore },
    );
  }

  let body: { sessionId?: unknown; subscribeToken?: unknown; model?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: noStore });
  }

  if (!isSessionId(body.sessionId)) {
    return NextResponse.json({ error: "Invalid session." }, { status: 400, headers: noStore });
  }

  const sessionId = body.sessionId;
  let update: { sessionId: string; subscribeToken: null } | { sessionId: string; subscribeToken: string; model: RealtimeModelName };
  if (body.subscribeToken === null) {
    update = { sessionId, subscribeToken: null };
  } else if (typeof body.subscribeToken === "string" && body.subscribeToken.length > 0 && body.subscribeToken.length <= 4096 && isRealtimeModelName(body.model)) {
    update = { sessionId, subscribeToken: body.subscribeToken, model: body.model };
  } else {
    return NextResponse.json({ error: "Invalid live session." }, { status: 400, headers: noStore });
  }

  try {
    publishObsSession(update);
    return new NextResponse(null, { status: 204, headers: noStore });
  } catch {
    return NextResponse.json({ error: "The live session could not be saved." }, { status: 500, headers: noStore });
  }
}

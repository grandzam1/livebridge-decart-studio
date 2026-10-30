import { NextResponse } from "next/server";
import { jsonError, jsonOk, noContent, readJson, requireOrigin } from "@/lib/api";
import {
  clearFalRelay,
  isFalSignalSizeOk,
  isValidViewKey,
  publishFalAnswer,
  publishFalOffer,
  readFalAnswer,
  readObsViewer,
  type ObsIceCandidate,
} from "@/lib/obs-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,80}$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const role = url.searchParams.get("role") ?? "viewer";
  const sessionId = url.searchParams.get("session") ?? "";
  if (!isValidViewKey(key)) return jsonError(403, "ORIGIN_NOT_ALLOWED", "Invalid OBS key.");

  if (role === "studio") {
    if (!isSessionId(sessionId)) return jsonError(400, "BAD_REQUEST", "Invalid session id.");
    return jsonOk({ answer: readFalAnswer(sessionId) });
  }

  // Viewer: reuse the status payload shape so the offer is only served while fresh.
  const viewer = readObsViewer(key);
  if (!viewer.live || viewer.provider !== "fal") return jsonOk({ live: false });
  return jsonOk(viewer);
}

type FalActionBody = {
  action?: unknown;
  key?: unknown;
  sessionId?: unknown;
  sdp?: unknown;
  candidates?: unknown;
};

export async function POST(request: Request) {
  const body = await readJson<FalActionBody>(request);
  if (body instanceof NextResponse) return body;

  const action = body.action;

  // Studio-side actions require a trusted page origin.
  if (action === "offer" || action === "clear") {
    const allowed = requireOrigin(request);
    if (allowed instanceof NextResponse) return allowed;

    if (!isSessionId(body.sessionId)) return jsonError(400, "BAD_REQUEST", "Invalid session id.");
    if (action === "clear") {
      clearFalRelay(body.sessionId);
      return noContent();
    }
    if (!isFalSignalSizeOk(body.sdp, body.candidates)) {
      return jsonError(400, "BAD_REQUEST", "Invalid WebRTC offer payload.");
    }
    publishFalOffer(body.sessionId, body.sdp as string, body.candidates as ObsIceCandidate[]);
    return noContent();
  }

  // Viewer action: anyone holding the OBS key may answer the current offer.
  if (action === "answer") {
    if (typeof body.key !== "string" || !isValidViewKey(body.key)) {
      return jsonError(403, "ORIGIN_NOT_ALLOWED", "Invalid OBS key.");
    }
    if (!isSessionId(body.sessionId) || !isFalSignalSizeOk(body.sdp, body.candidates)) {
      return jsonError(400, "BAD_REQUEST", "Invalid WebRTC answer payload.");
    }
    publishFalAnswer(body.sessionId, body.sdp as string, body.candidates as ObsIceCandidate[]);
    return noContent();
  }

  return jsonError(400, "BAD_REQUEST", "Unknown OBS relay action.");
}

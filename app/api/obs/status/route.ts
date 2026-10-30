import { jsonError, jsonOk } from "@/lib/api";
import { readObsViewer } from "@/lib/obs-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const windowMs = 10_000;
const requestLimit = 30;
const recentRequests: number[] = [];

function allowStatusRequest() {
  const now = Date.now();
  while (recentRequests.length > 0 && now - recentRequests[0] > windowMs) recentRequests.shift();
  if (recentRequests.length >= requestLimit) return false;
  recentRequests.push(now);
  return true;
}

export async function GET(request: Request) {
  if (!allowStatusRequest()) {
    return jsonError(429, "RATE_LIMITED", "Too many OBS viewer checks.", "Wait a few seconds; the viewer retries automatically.", { "Retry-After": "2" });
  }

  const viewKey = new URL(request.url).searchParams.get("key") ?? "";
  if (viewKey.length === 0 || viewKey.length > 128) {
    return jsonOk({ live: false });
  }

  try {
    return jsonOk(readObsViewer(viewKey));
  } catch {
    return jsonOk({ live: false });
  }
}

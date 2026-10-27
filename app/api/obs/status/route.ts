import { NextResponse } from "next/server";
import { readObsViewer } from "@/lib/obs-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
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
    return NextResponse.json(
      { error: "Too many OBS viewer checks." },
      { status: 429, headers: { ...noStore, "Retry-After": "2" } },
    );
  }

  const viewKey = new URL(request.url).searchParams.get("key") ?? "";
  if (viewKey.length === 0 || viewKey.length > 128) {
    return NextResponse.json({ live: false }, { headers: noStore });
  }

  try {
    return NextResponse.json(await readObsViewer(viewKey), { headers: noStore });
  } catch {
    return NextResponse.json({ live: false }, { headers: noStore });
  }
}

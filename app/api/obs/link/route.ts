import { NextResponse } from "next/server";
import { getObsViewKey } from "@/lib/obs-state";
import { isAllowedRequestOrigin } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isAllowedRequestOrigin(request)) {
    return NextResponse.json(
      { error: "OBS link requests must come from a configured app origin." },
      { status: 403, headers: noStore },
    );
  }

  const viewKey = getObsViewKey();
  if (!viewKey) {
    return NextResponse.json({ error: "Set OBS_KEY in the server environment." }, { status: 503, headers: noStore });
  }

  return NextResponse.json({ viewKey }, { headers: noStore });
}

import { NextResponse } from "next/server";
import { jsonOk, missingConfig, requireOrigin } from "@/lib/api";
import { getObsViewKey } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  const viewKey = getObsViewKey();
  if (!viewKey) return missingConfig(["OBS_KEY"]);

  return jsonOk({ viewKey });
}

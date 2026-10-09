import { NextResponse } from "next/server";
import { getServerConfigurationStatus } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getServerConfigurationStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}

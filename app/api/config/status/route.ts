import { jsonOk } from "@/lib/api";
import { getServerConfigurationStatus } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk(getServerConfigurationStatus());
}

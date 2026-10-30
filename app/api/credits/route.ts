import { jsonOk } from "@/lib/api";
import { getDecartApiKey, getFalKey } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 8_000;

type CreditsResult =
  | { ok: true; credits: number; usd: number; detail?: string }
  | { ok: false; reason: string };

async function decartCredits(): Promise<CreditsResult | null> {
  const key = getDecartApiKey();
  if (!key) return null;
  try {
    const response = await fetch("https://api.decart.ai/v1/credits", {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: `Decart returned HTTP ${response.status}.` };
    const body = await response.json() as { credits?: number };
    if (typeof body.credits !== "number") return { ok: false, reason: "Unexpected Decart response." };
    return { ok: true, credits: body.credits, usd: body.credits / 100 };
  } catch {
    return { ok: false, reason: "Could not reach Decart." };
  }
}

async function falCredits(): Promise<CreditsResult | null> {
  const key = getFalKey();
  if (!key) return null;
  try {
    const response = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 403) {
      return { ok: false, reason: "This FAL key lacks billing:usage:read permission. Use a READONLY or FULL preset key." };
    }
    if (!response.ok) return { ok: false, reason: `FAL returned HTTP ${response.status}.` };
    const body = await response.json() as { credits?: { current_balance?: number } };
    const balance = body.credits?.current_balance;
    if (typeof balance !== "number") return { ok: false, reason: "Unexpected FAL response." };
    // FAL reports a USD balance; shown as $1 = 100 credits to match Decart's unit.
    return { ok: true, credits: Math.round(balance * 100), usd: balance };
  } catch {
    return { ok: false, reason: "Could not reach FAL." };
  }
}

export async function GET() {
  const [decart, fal] = await Promise.all([decartCredits(), falCredits()]);
  return jsonOk({ decart, fal });
}

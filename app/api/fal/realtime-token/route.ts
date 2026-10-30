import { NextResponse } from "next/server";
import { jsonError, jsonOk, missingConfig, readJson, requireOrigin } from "@/lib/api";
import { getFalKey, getLiveProvider, publicConfig } from "@/lib/config";
import { FAL_LUCY_APPS, isFalLucyApp } from "@/lib/fal-models";
import { UPSTREAM_TIMEOUT_MS, UpstreamHttpError, upstreamErrorResponse } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_DURATION_SECONDS = publicConfig.tokens.falTtlSeconds;

export async function POST(request: Request) {
  if (getLiveProvider() !== "fal") {
    return jsonError(503, "PROVIDER_INACTIVE", "FAL is not the active live provider.", "Set LIVE_PROVIDER=fal in .env and restart the server.");
  }

  const falKey = getFalKey();
  if (!falKey) return missingConfig(["FAL_KEY"]);

  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  const body = await readJson<{ app: unknown }>(request);
  if (body instanceof NextResponse) return body;

  if (!isFalLucyApp(body.app)) {
    return jsonError(400, "UNSUPPORTED_MODEL", "Unsupported FAL app.", `Allowed: ${Object.values(FAL_LUCY_APPS).join(", ")}.`);
  }

  try {
    const response = await fetch("https://rest.fal.ai/tokens/realtime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${falKey}`,
      },
      body: JSON.stringify({
        app: body.app,
        allowed_apps: [body.app],
        duration: TOKEN_DURATION_SECONDS,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // FAL may answer with an HTML error page during outages, so only parse JSON when it is JSON.
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
    const payload = isJson
      ? await response.json().catch(() => null) as { token?: string; detail?: unknown; message?: unknown } | string | null
      : null;
    if (!response.ok) {
      const detail = payload ? JSON.stringify(typeof payload === "object" ? (payload.detail ?? payload.message ?? payload) : payload) : await response.text().catch(() => "");
      throw new UpstreamHttpError(response.status, detail || `HTTP ${response.status}`);
    }
    // FAL returns the JWT either as a bare JSON string or wrapped as { token }.
    const token = typeof payload === "string" ? payload : payload?.token;
    if (typeof token !== "string" || !token) {
      throw new Error(`FAL returned HTTP ${response.status} without a token (content-type: ${response.headers.get("content-type") ?? "none"}).`);
    }

    return jsonOk({ token, expiresIn: TOKEN_DURATION_SECONDS, app: body.app });
  } catch (error) {
    return upstreamErrorResponse({ name: "FAL", keyName: "FAL_KEY" }, error);
  }
}

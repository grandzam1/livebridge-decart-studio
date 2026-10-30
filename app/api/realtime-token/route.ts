import { createDecartClient } from "@decartai/sdk";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, missingConfig, readJson, requireOrigin } from "@/lib/api";
import { getDecartApiKey, publicConfig } from "@/lib/config";
import { REALTIME_MODES, isRealtimeModelName } from "@/lib/decart";
import { upstreamErrorResponse, withTimeout } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = getDecartApiKey();
  if (!secret) return missingConfig(["DECART_API_KEY"]);

  const allowed = requireOrigin(request);
  if (allowed instanceof NextResponse) return allowed;

  const body = await readJson<{ model: unknown }>(request);
  if (body instanceof NextResponse) return body;

  if (!isRealtimeModelName(body.model)) {
    return jsonError(
      400,
      "UNSUPPORTED_MODEL",
      "Unsupported realtime model.",
      `Use a model from livebridge.config.ts: ${REALTIME_MODES.map((mode) => mode.decartModel).join(", ")}.`,
    );
  }

  try {
    const client = createDecartClient({ apiKey: secret, telemetry: false });
    const token = await withTimeout(client.tokens.create({
      expiresIn: publicConfig.tokens.decartTtlSeconds,
      allowedModels: [body.model],
      allowedOrigins: [allowed.origin],
    }));

    return jsonOk({ clientToken: token.apiKey, expiresAt: token.expiresAt, model: body.model });
  } catch (error) {
    return upstreamErrorResponse({ name: "Decart", keyName: "DECART_API_KEY" }, error);
  }
}

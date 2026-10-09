import { createDecartClient } from "@decartai/sdk";
import { NextResponse } from "next/server";
import { isRealtimeModelName } from "@/lib/decart";
import { getConfiguredAppOrigins, getServerConfigurationStatus } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configuration = getServerConfigurationStatus();
  if (!configuration.configured) {
    return NextResponse.json(
      {
        error: `Decart is not configured. Set ${configuration.missing.join(" and ")} in the server environment.`,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const secret = process.env.DECART_API_KEY;
  const allowedOrigins = getConfiguredAppOrigins();
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) {
    return NextResponse.json(
      { error: "Token requests must come from a configured app origin." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { model?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isRealtimeModelName(body.model)) {
    return NextResponse.json(
      { error: "Unsupported realtime model." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const client = createDecartClient({ apiKey: secret, telemetry: false });
    const token = await client.tokens.create({
      expiresIn: 300,
      allowedModels: [body.model],
      allowedOrigins: [origin],
    });

    return NextResponse.json(
      { clientToken: token.apiKey, expiresAt: token.expiresAt, model: body.model },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not create a Decart client token. Check the server key and Decart account." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

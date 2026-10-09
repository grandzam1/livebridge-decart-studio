import { createDecartClient } from "@decartai/sdk";
import { NextResponse } from "next/server";
import { isRealtimeModelName } from "@/lib/decart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getTrustedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) return null;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol;

  if (host && `${protocol}//${host}` !== origin) return null;
  return origin;
}

export async function POST(request: Request) {
  const secret = process.env.DECART_API_KEY;
  if (!secret) {
    return NextResponse.json(
      { error: "Decart is not configured. Add DECART_API_KEY to the server environment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const origin = getTrustedOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { error: "Token requests must come from this app's origin." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { model?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isRealtimeModelName(body.model)) {
    return NextResponse.json({ error: "Unsupported realtime model." }, { status: 400 });
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

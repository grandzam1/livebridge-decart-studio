import { NextResponse } from "next/server";
import { FAL_LUCY_APPS, isFalLucyApp } from "@/lib/fal-models";
import { getLiveProvider, getConfiguredAppOrigins, getServerConfigurationStatus } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_DURATION_SECONDS = 120;

export async function POST(request: Request) {
  if (getLiveProvider() !== "fal") {
    return NextResponse.json(
      { error: "FAL is not the active live provider. Set LIVE_PROVIDER=fal to use this endpoint." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const configuration = getServerConfigurationStatus();
  if (!configuration.configured) {
    return NextResponse.json(
      {
        error: `FAL is not configured. Set ${configuration.missing.join(" and ")} in the server environment.`,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const falKey = process.env.FAL_KEY?.trim();
  if (!falKey) {
    return NextResponse.json(
      { error: "FAL_KEY is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const allowedOrigins = getConfiguredAppOrigins();
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) {
    return NextResponse.json(
      { error: "Token requests must come from a configured app origin." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { app?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isFalLucyApp(body.app)) {
    return NextResponse.json(
      {
        error: `Unsupported FAL app. Allowed: ${FAL_LUCY_APPS.edit}, ${FAL_LUCY_APPS.vton}.`,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await fetch("https://rest.fal.ai/tokens/realtime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${falKey}`,
      },
      body: JSON.stringify({
        allowed_apps: [body.app],
        duration: TOKEN_DURATION_SECONDS,
      }),
    });

    const payload = await response.json() as { token?: string; detail?: string; message?: string };
    if (!response.ok || !payload.token) {
      const detail = payload.detail ?? payload.message ?? `HTTP ${response.status}`;
      console.error("FAL realtime token request failed:", detail);
      return NextResponse.json(
        { error: "Could not create a FAL realtime token. Check FAL_KEY and account access." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { token: payload.token, expiresIn: TOKEN_DURATION_SECONDS, app: body.app },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown token error";
    console.error("FAL realtime token request failed:", detail);
    return NextResponse.json(
      { error: "Could not create a FAL realtime token. Check FAL_KEY and network access." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

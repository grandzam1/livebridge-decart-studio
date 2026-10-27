import "server-only";

import type { LiveProvider } from "@/lib/live-provider";

export type { LiveProvider };

export function getLiveProvider(): LiveProvider {
  const raw = process.env.LIVE_PROVIDER?.trim().toLowerCase();
  return raw === "fal" ? "fal" : "decart";
}

export function getConfiguredAppOrigins(): string[] {
  const configured = process.env.APP_ORIGINS ?? "";
  const origins = new Set<string>();

  for (const entry of configured.split(",")) {
    const candidate = entry.trim();
    if (!candidate) continue;

    try {
      const parsed = new URL(candidate);
      if (
        parsed.origin === candidate &&
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.pathname === "/" &&
        !parsed.search &&
        !parsed.hash &&
        !parsed.username &&
        !parsed.password
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed entries; an empty valid allowlist keeps token issuance disabled.
    }
  }

  return [...origins];
}

export function isAllowedRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && getConfiguredAppOrigins().includes(origin));
}

export function getServerConfigurationStatus() {
  const provider = getLiveProvider();
  const missing: string[] = [];
  if (provider === "fal") {
    if (!process.env.FAL_KEY?.trim()) missing.push("FAL_KEY");
  } else if (!process.env.DECART_API_KEY?.trim()) {
    missing.push("DECART_API_KEY");
  }
  if (getConfiguredAppOrigins().length === 0) missing.push("APP_ORIGINS");
  return { configured: missing.length === 0, missing, provider };
}

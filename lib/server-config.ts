import "server-only";

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

export function getServerConfigurationStatus() {
  const missing: string[] = [];
  if (!process.env.DECART_API_KEY?.trim()) missing.push("DECART_API_KEY");
  if (getConfiguredAppOrigins().length === 0) missing.push("APP_ORIGINS");
  return { configured: missing.length === 0, missing };
}

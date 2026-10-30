import "server-only";

import type { LiveProvider } from "@/lib/live-provider";
import { publicConfig } from "@/lib/public-config";

export type { LiveProvider };
export { publicConfig };

// The only place in the app that reads process.env. Values are read per call so `.env` edits apply after a restart/reload.
function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function isDevelopment() {
  return process.env.NODE_ENV !== "production";
}

export function getLiveProvider(): LiveProvider {
  return env("LIVE_PROVIDER")?.toLowerCase() === "fal" ? "fal" : "decart";
}

export function getDecartApiKey() {
  return env("DECART_API_KEY");
}

export function getFalKey() {
  return env("FAL_KEY");
}

export function getObsViewKey() {
  return env("OBS_KEY");
}

function parseAppOrigins() {
  const valid = new Set<string>();
  const rejected: string[] = [];

  for (const entry of (env("APP_ORIGINS") ?? "").split(",")) {
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
        valid.add(parsed.origin);
        continue;
      }
    } catch {
      // Malformed entries are reported as rejected; an empty valid allowlist keeps token issuance disabled.
    }
    rejected.push(candidate);
  }

  return { valid: [...valid], rejected };
}

export function getConfiguredAppOrigins(): string[] {
  return parseAppOrigins().valid;
}

export type ConfigCheck = {
  name: string;
  /** missing/invalid on a required setting blocks live sessions; warning and skipped never do. */
  status: "ok" | "missing" | "invalid" | "warning" | "skipped";
  /** Human-readable detail for the server terminal. Never contains secret values. */
  detail: string;
};

/** Every server setting with its state. Used by the startup checklist and /api/config/status. */
export function getConfigChecks(): ConfigCheck[] {
  const checks: ConfigCheck[] = [];
  const provider = getLiveProvider();
  const rawProvider = env("LIVE_PROVIDER");

  if (rawProvider && !["decart", "fal"].includes(rawProvider.toLowerCase())) {
    checks.push({ name: "LIVE_PROVIDER", status: "invalid", detail: `"${rawProvider}" is not "decart" or "fal"; using decart` });
  } else {
    checks.push({ name: "LIVE_PROVIDER", status: "ok", detail: rawProvider ? provider : "decart (default)" });
  }

  const keys = [
    { name: "DECART_API_KEY", provider: "decart", value: getDecartApiKey() },
    { name: "FAL_KEY", provider: "fal", value: getFalKey() },
  ] as const;
  for (const key of keys) {
    if (key.provider !== provider) checks.push({ name: key.name, status: "skipped", detail: `not used (LIVE_PROVIDER=${provider})` });
    else if (key.value) checks.push({ name: key.name, status: "ok", detail: "set" });
    else checks.push({ name: key.name, status: "missing", detail: `required for LIVE_PROVIDER=${provider}` });
  }

  const origins = parseAppOrigins();
  const rejectedNote = `ignored: ${origins.rejected.join(", ")} (use scheme://host[:port], no path or trailing slash)`;
  if (origins.valid.length === 0 && origins.rejected.length === 0) {
    checks.push({ name: "APP_ORIGINS", status: "missing", detail: "required, e.g. http://localhost:3000" });
  } else if (origins.valid.length === 0) {
    checks.push({ name: "APP_ORIGINS", status: "invalid", detail: `no valid origins; ${rejectedNote}` });
  } else if (origins.rejected.length > 0) {
    checks.push({ name: "APP_ORIGINS", status: "warning", detail: `${origins.valid.join(", ")}; ${rejectedNote}` });
  } else {
    checks.push({ name: "APP_ORIGINS", status: "ok", detail: origins.valid.join(", ") });
  }

  if (getObsViewKey()) checks.push({ name: "OBS_KEY", status: "ok", detail: "set" });
  else checks.push({ name: "OBS_KEY", status: "warning", detail: "not set; the OBS link is disabled" });

  return checks;
}

export function getServerConfigurationStatus() {
  const checks = getConfigChecks();
  const missing = checks.filter((check) => check.status === "missing").map((check) => check.name);
  const invalid = checks.filter((check) => check.status === "invalid").map((check) => check.name);
  // An invalid LIVE_PROVIDER falls back to decart, so it is reported but does not block live sessions.
  const blocking = [...missing, ...invalid.filter((name) => name !== "LIVE_PROVIDER")];
  return { configured: blocking.length === 0, missing, invalid, provider: getLiveProvider() };
}

const CHECK_ICONS: Record<ConfigCheck["status"], string> = { ok: "✓", missing: "✗", invalid: "✗", warning: "!", skipped: "-" };

/** Prints the startup checklist to the server terminal. */
export function logConfigChecklist() {
  const checks: ConfigCheck[] = [
    ...getConfigChecks(),
    { name: "livebridge.config.ts", status: "ok", detail: `${publicConfig.modes.length} modes (${publicConfig.modes.map((mode) => mode.id).join(", ")})` },
  ];
  const width = Math.max(...checks.map((check) => check.name.length));
  const { configured } = getServerConfigurationStatus();
  const lines = [
    "LiveBridge config check",
    ...checks.map((check) => `  ${CHECK_ICONS[check.status]} ${check.name.padEnd(width)}  ${check.detail}`),
    configured ? "  Ready for live sessions." : "  Live start is disabled until the ✗ items are fixed in .env (then restart the server).",
  ];
  if (configured) console.log(lines.join("\n"));
  else console.warn(lines.join("\n"));
}

import { isRealtimeModel, listModels } from "@decartai/sdk";
import userConfig from "@/livebridge.config";
import { FAL_LUCY_APPS, type LiveBridgeConfig } from "@/lib/config-types";

const FILE = "livebridge.config.ts";

function fail(path: string, problem: string): never {
  throw new Error(`[${FILE}] ${path} ${problem}`);
}

function requireText(value: unknown, path: string) {
  if (typeof value !== "string" || value.trim().length === 0) fail(path, "must be a non-empty string.");
}

function requirePositiveInteger(value: unknown, path: string, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > max) {
    fail(path, `must be a whole number between 1 and ${max} (got ${JSON.stringify(value)}).`);
  }
}

function validate(config: LiveBridgeConfig): LiveBridgeConfig {
  requireText(config.branding?.appName, "branding.appName");
  const logoUrl = config.branding.logoUrl;
  if (typeof logoUrl !== "string" || (logoUrl !== "" && !logoUrl.startsWith("/") && !/^https?:\/\//.test(logoUrl))) {
    fail("branding.logoUrl", 'must be "", a path like "/logo.svg", or an http(s) URL.');
  }

  if (!Array.isArray(config.modes) || config.modes.length === 0) fail("modes", "must list at least one mode.");
  const falApps: string[] = Object.values(FAL_LUCY_APPS);
  const seen = new Set<string>();
  config.modes.forEach((mode, index) => {
    const path = `modes[${index}]`;
    if (typeof mode.id !== "string" || !/^[a-z0-9-]+$/.test(mode.id)) {
      fail(`${path}.id`, "must use lowercase letters, numbers and dashes only.");
    }
    if (seen.has(mode.id)) fail(`${path}.id`, `"${mode.id}" is used by more than one mode.`);
    seen.add(mode.id);
    requireText(mode.label, `${path}.label`);
    requireText(mode.detail, `${path}.detail`);
    if (typeof mode.decartModel !== "string" || !isRealtimeModel(mode.decartModel)) {
      const valid = [...new Set(listModels({ kind: "realtime" }).map((model) => model.name))].join(", ");
      fail(`${path}.decartModel`, `"${String(mode.decartModel)}" is not a Decart realtime model. Valid: ${valid}.`);
    }
    if (!falApps.includes(mode.falApp)) {
      fail(`${path}.falApp`, `"${String(mode.falApp)}" is not supported. Valid: ${falApps.join(", ")}.`);
    }
    requireText(mode.falPrompt, `${path}.falPrompt`);
  });

  requirePositiveInteger(config.tokens?.decartTtlSeconds, "tokens.decartTtlSeconds", 3600);
  requirePositiveInteger(config.tokens?.falTtlSeconds, "tokens.falTtlSeconds", 3600);

  const maxImageMb = config.upload?.maxImageMb;
  if (typeof maxImageMb !== "number" || !(maxImageMb > 0) || maxImageMb > 100) {
    fail("upload.maxImageMb", `must be a number above 0 and up to 100 (got ${JSON.stringify(maxImageMb)}).`);
  }

  if (typeof config.dev?.allowLoopbackOrigins !== "boolean") {
    fail("dev.allowLoopbackOrigins", "must be true or false.");
  }

  return config;
}

/** Validated, browser-safe settings from livebridge.config.ts. */
export const publicConfig: LiveBridgeConfig = validate(userConfig);

export const maxImageBytes = Math.floor(publicConfig.upload.maxImageMb * 1024 * 1024);

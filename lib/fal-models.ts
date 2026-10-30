import { modeById, type RealtimeMode } from "@/lib/decart";
import { FAL_LUCY_APPS, type FalLucyApp } from "@/lib/config-types";

export { FAL_LUCY_APPS, type FalLucyApp };

export function falAppForMode(mode: RealtimeMode): FalLucyApp {
  return modeById(mode).falApp;
}

export function falPromptForMode(mode: RealtimeMode): string {
  return modeById(mode).falPrompt;
}

export function isFalLucyApp(value: unknown): value is FalLucyApp {
  return Object.values(FAL_LUCY_APPS).some((app) => app === value);
}

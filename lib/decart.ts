import type { RealTimeModels } from "@decartai/sdk";
import { publicConfig } from "@/lib/public-config";

export const REALTIME_MODES = publicConfig.modes;

export type RealtimeMode = string;
export type RealtimeModelName = RealTimeModels;

export const DEFAULT_MODE: RealtimeMode = REALTIME_MODES[0].id;

export function isRealtimeModelName(value: unknown): value is RealtimeModelName {
  return REALTIME_MODES.some((item) => item.decartModel === value);
}

export function modeById(mode: RealtimeMode) {
  return REALTIME_MODES.find((item) => item.id === mode) ?? REALTIME_MODES[0];
}

export function modelForMode(mode: RealtimeMode): RealtimeModelName {
  return modeById(mode).decartModel;
}

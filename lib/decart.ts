export const REALTIME_MODES = [
  { id: "character", label: "Character", model: "lucy-latest", detail: "Use a reference image as a character guide" },
  { id: "restyle", label: "Restyle", model: "lucy-restyle-2", detail: "Use a reference image as a visual style guide" },
  { id: "try-on", label: "Try-on", model: "lucy-vton-latest", detail: "Try a look using a reference image" },
] as const;

export type RealtimeMode = (typeof REALTIME_MODES)[number]["id"];
export type RealtimeModelName = (typeof REALTIME_MODES)[number]["model"];

export function isRealtimeModelName(value: unknown): value is RealtimeModelName {
  return REALTIME_MODES.some((item) => item.model === value);
}

export function modelForMode(mode: RealtimeMode): RealtimeModelName {
  return REALTIME_MODES.find((item) => item.id === mode)?.model ?? "lucy-latest";
}

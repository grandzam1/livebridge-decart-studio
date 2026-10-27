import type { RealtimeMode } from "@/lib/decart";

/** FAL realtime endpoint IDs for Lucy live video. */
export const FAL_LUCY_APPS = {
  edit: "decart/lucy-2-5/realtime",
  vton: "decart/lucy2-vton/realtime",
} as const;

export type FalLucyApp = (typeof FAL_LUCY_APPS)[keyof typeof FAL_LUCY_APPS];

const FAL_MODE_PROMPTS: Record<RealtimeMode, string> = {
  character: "Substitute the character in the video with the person in the reference image.",
  restyle: "Change the style of the video to match the reference image.",
  "try-on": "Substitute the current top with the outfit from the reference image, matching its color, material, and fit",
};

export function falAppForMode(mode: RealtimeMode): FalLucyApp {
  return mode === "try-on" ? FAL_LUCY_APPS.vton : FAL_LUCY_APPS.edit;
}

export function falPromptForMode(mode: RealtimeMode): string {
  return FAL_MODE_PROMPTS[mode];
}

export function isFalLucyApp(value: unknown): value is FalLucyApp {
  return value === FAL_LUCY_APPS.edit || value === FAL_LUCY_APPS.vton;
}

// LiveBridge settings. Edit this file instead of the code; restart `pnpm dev` after changes.
//
// Everything here is PUBLIC and is sent to the browser. Never put API keys or other secrets here —
// secrets (DECART_API_KEY, FAL_KEY, OBS_KEY) and deployment values (LIVE_PROVIDER, APP_ORIGINS) belong in `.env`.

import type { LiveBridgeConfig } from "./lib/config-types";

const config = {
  branding: {
    appName: "LiveBridge",
    logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663822981058/UYzJhILMtevHaUae.svg",
  },

  // Live modes shown in the studio. The first one is selected by default.
  // decartModel must be a Decart realtime model (e.g. "lucy-latest", "lucy-restyle-2", "lucy-vton-latest").
  // falApp must be "decart/lucy-2-5/realtime" or "decart/lucy2-vton/realtime".
  modes: [
    {
      id: "character",
      label: "Character",
      detail: "Use a reference image as a character guide",
      decartModel: "lucy-latest",
      falApp: "decart/lucy-2-5/realtime",
      falPrompt: "Substitute the character in the video with the person in the reference image.",
    },
    {
      id: "restyle",
      label: "Restyle",
      detail: "Use a reference image as a visual style guide",
      decartModel: "lucy-restyle-2",
      falApp: "decart/lucy-2-5/realtime",
      falPrompt: "Change the style of the video to match the reference image.",
    },
    {
      id: "try-on",
      label: "Try-on",
      detail: "Try a look using a reference image",
      decartModel: "lucy-vton-latest",
      falApp: "decart/lucy2-vton/realtime",
      falPrompt: "Substitute the current top with the outfit from the reference image, matching its color, material, and fit",
    },
  ],

  tokens: {
    decartTtlSeconds: 300,
    falTtlSeconds: 120,
  },

  upload: {
    maxImageMb: 10,
  },

  dev: {
    // Development only: trust http://localhost:* and http://127.0.0.1:* origins on top of
    // APP_ORIGINS, so dev/preview proxies on random ports keep working. Ignored in production.
    allowLoopbackOrigins: true,
  },
} satisfies LiveBridgeConfig;

export default config;

import type { RealTimeModels } from "@decartai/sdk";

/** FAL realtime endpoint IDs for Lucy live video. */
export const FAL_LUCY_APPS = {
  edit: "decart/lucy-2-5/realtime",
  vton: "decart/lucy2-vton/realtime",
} as const;

export type FalLucyApp = (typeof FAL_LUCY_APPS)[keyof typeof FAL_LUCY_APPS];

export type LiveModeConfig = {
  /** Stable id, lowercase letters, numbers and dashes. */
  id: string;
  /** Button label in the studio. */
  label: string;
  /** Short description shown under "Live mode". */
  detail: string;
  /** Decart realtime model used when LIVE_PROVIDER=decart. */
  decartModel: RealTimeModels;
  /** FAL realtime app used when LIVE_PROVIDER=fal. */
  falApp: FalLucyApp;
  /** Built-in prompt sent to FAL for this mode. */
  falPrompt: string;
};

export type LiveBridgeConfig = {
  branding: {
    appName: string;
    /** Absolute http(s) URL or a path under /public (e.g. "/logo.svg"). Empty string uses the built-in icon. */
    logoUrl: string;
  };
  /** First entry is the default mode. */
  modes: LiveModeConfig[];
  tokens: {
    /** Lifetime of short-lived Decart browser tokens, in seconds. */
    decartTtlSeconds: number;
    /** Lifetime of short-lived FAL realtime tokens, in seconds. */
    falTtlSeconds: number;
  };
  upload: {
    /** Largest reference image accepted, in megabytes. */
    maxImageMb: number;
  };
  dev: {
    /**
     * Development only: also trust http://localhost:* and http://127.0.0.1:* origins,
     * so preview proxies on random ports work without editing APP_ORIGINS.
     * Ignored in production, which always uses the exact APP_ORIGINS allowlist.
     */
    allowLoopbackOrigins: boolean;
  };
};

"use client";

import { createDecartClient, type RealTimeSubscribeClient } from "@decartai/sdk";
import { useEffect, useRef, useState } from "react";
import { isRealtimeModelName, type RealtimeModelName } from "@/lib/decart";

type ViewerPayload = {
  live?: boolean;
  subscribeToken?: string;
  model?: string;
};

export function ObsViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const viewKey = new URLSearchParams(window.location.search).get("key");
    if (!viewKey) return;

    let disposed = false;
    let ticking = false;
    let activeToken: string | null = null;
    let subscriber: RealTimeSubscribeClient | null = null;

    const clearVideo = () => {
      const current = subscriber;
      subscriber = null;
      activeToken = null;
      current?.disconnect();
      if (videoRef.current) videoRef.current.srcObject = null;
      if (!disposed) setMessage("");
    };

    const subscribe = async (subscribeToken: string, model: RealtimeModelName) => {
      const client = createDecartClient({
        telemetry: false,
        apiKeyProvider: async () => {
          const tokenResponse = await fetch("/api/realtime-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model }),
            cache: "no-store",
          });
          const tokenPayload = await tokenResponse.json() as { clientToken?: string; error?: string };
          if (!tokenResponse.ok || !tokenPayload.clientToken) {
            throw new Error(tokenPayload.error ?? "OBS viewer could not get a Decart token.");
          }
          return tokenPayload.clientToken;
        },
      });
      if (disposed || activeToken !== subscribeToken) return;
      const nextSubscriber = await client.realtime.subscribe({
        token: subscribeToken,
        onRemoteStream: (stream) => {
          const video = videoRef.current;
          if (disposed || activeToken !== subscribeToken || !video) return;
          video.muted = true;
          video.srcObject = stream;
          setMessage("");
          void video.play().catch(() => {
            if (!disposed && activeToken === subscribeToken) setMessage("If playback is blocked, interact with this OBS Browser Source once.");
          });
        },
      });
      if (disposed || activeToken !== subscribeToken) {
        nextSubscriber.disconnect();
        return;
      }
      subscriber = nextSubscriber;
      nextSubscriber.on("connectionChange", (state) => {
        if (disposed || subscriber !== nextSubscriber) return;
        if (state === "disconnected") clearVideo();
      });
      nextSubscriber.on("error", () => {
        if (disposed || subscriber !== nextSubscriber) return;
        clearVideo();
      });
    };

    const tick = async () => {
      if (disposed || ticking) return;
      ticking = true;
      try {
        const response = await fetch(`/api/obs/status?key=${encodeURIComponent(viewKey)}`, { cache: "no-store" });
        if (disposed) return;
        if (response.status === 429) return;
        if (!response.ok) {
          clearVideo();
          return;
        }
        const payload = await response.json() as ViewerPayload;
        if (disposed) return;
        if (!payload.live || !payload.subscribeToken || !isRealtimeModelName(payload.model)) {
          clearVideo();
          return;
        }
        if (payload.subscribeToken === activeToken) return;
        clearVideo();
        activeToken = payload.subscribeToken;
        await subscribe(payload.subscribeToken, payload.model);
      } catch (error) {
        if (!disposed) {
          console.error("OBS viewer could not attach to the live session.", error);
          clearVideo();
        }
      } finally {
        ticking = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      clearVideo();
    };
  }, []);

  return (
    <main className="obs-page" aria-label="LiveBridge OBS output">
      <div className="obs-stage">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="obs-message" aria-live="polite">{message}</div>
      </div>
    </main>
  );
}

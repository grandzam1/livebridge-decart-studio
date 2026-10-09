"use client";

import { createDecartClient } from "@decartai/sdk";
import { useEffect, useRef, useState } from "react";
import { isRealtimeModelName } from "@/lib/decart";

type ViewerStatus = "loading" | "connected" | "error";

export function ObsViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    let disconnectSubscriber: (() => void) | null = null;

    const connect = async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const subscribeToken = params.get("token");
      const model = params.get("model");
      if (!subscribeToken || !isRealtimeModelName(model)) {
        setStatus("error");
        setMessage("Open the Studio and copy its OBS viewer link.");
        return;
      }

      try {
        const tokenResponse = await fetch("/api/realtime-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
          cache: "no-store",
        });
        const tokenPayload = await tokenResponse.json() as { clientToken?: string; error?: string };
        if (!tokenResponse.ok || !tokenPayload.clientToken) {
          throw new Error(tokenPayload.error ?? "The OBS viewer could not get a Decart connection token.");
        }

        const client = createDecartClient({ apiKey: tokenPayload.clientToken, telemetry: false });
        const subscriber = await client.realtime.subscribe({
          token: subscribeToken,
          onRemoteStream: (stream) => {
            if (disposed || !videoRef.current) return;
            videoRef.current.srcObject = stream;
            setStatus("connected");
            setMessage("");
            void videoRef.current.play().catch(() => {
              if (!disposed) setMessage("If playback is blocked, interact with this OBS Browser Source once.");
            });
          },
        });
        disconnectSubscriber = () => subscriber.disconnect();
        subscriber.on("connectionChange", (state) => {
          if (disposed) return;
          if (state === "connected") {
            setStatus("connected");
            setMessage("");
          } else if (state === "disconnected") {
            setStatus("error");
            setMessage("The Studio session ended. Copy a new viewer link from LiveBridge.");
          }
        });
        subscriber.on("error", (error) => {
          if (disposed) return;
          setStatus("error");
          setMessage(error.message || "The OBS viewer could not connect to the live session.");
        });
      } catch (caught) {
        if (disposed) return;
        setStatus("error");
        setMessage(caught instanceof Error ? caught.message : "The OBS viewer could not connect.");
      }
    };

    void connect();
    return () => {
      disposed = true;
      disconnectSubscriber?.();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  return (
    <main className="obs-page" aria-label="LiveBridge OBS output">
      <div className="obs-stage">
        <video ref={videoRef} autoPlay playsInline />
        <div className="obs-message" aria-live="polite">{status === "loading" ? "Connecting to live output…" : message}</div>
      </div>
    </main>
  );
}

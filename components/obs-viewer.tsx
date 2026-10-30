"use client";

import { createDecartClient, type RealTimeSubscribeClient } from "@decartai/sdk";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/api-client";
import { isRealtimeModelName, type RealtimeModelName } from "@/lib/decart";

type ViewerPayload = {
  live?: boolean;
  provider?: "decart" | "fal";
  subscribeToken?: string;
  model?: string;
  sessionId?: string;
  offer?: { sdp: string; candidates: RTCIceCandidateInit[] };
};

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);
    function done() {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    function onChange() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

export function ObsViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState(false);

  useEffect(() => {
    const viewKey = new URLSearchParams(window.location.search).get("key");
    if (!viewKey) return;

    let disposed = false;
    let ticking = false;
    let activeToken: string | null = null;
    let subscriber: RealTimeSubscribeClient | null = null;
    let falPeer: RTCPeerConnection | null = null;
    // The page stays blank for OBS; failures are reported once per type in the console.
    const logged = new Set<string>();
    const logOnce = (kind: string, detail: string, error?: unknown) => {
      if (logged.has(kind)) return;
      logged.add(kind);
      console.error(`[obs] ${detail}`, error ?? "");
    };

    const clearVideo = () => {
      const current = subscriber;
      subscriber = null;
      const peer = falPeer;
      falPeer = null;
      activeToken = null;
      current?.disconnect();
      peer?.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      if (!disposed) {
        setMessage("");
        setLive(false);
      }
    };

    const subscribe = async (subscribeToken: string, model: RealtimeModelName) => {
      const client = createDecartClient({
        telemetry: false,
        apiKeyProvider: async () => {
          const tokenPayload = await fetchJson<{ clientToken?: string }>("/api/realtime-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model }),
          });
          if (!tokenPayload.clientToken) throw new Error("OBS viewer could not get a Decart token.");
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
          setLive(true);
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
      nextSubscriber.on("error", (sdkError) => {
        if (disposed || subscriber !== nextSubscriber) return;
        logOnce("subscriber-error", "The Decart subscription reported an error; retrying on the next status poll.", sdkError);
        clearVideo();
      });
    };

    const attachStream = (stream: MediaStream) => {
      const video = videoRef.current;
      if (!video) return;
      video.muted = true;
      video.srcObject = stream;
      setMessage("");
      setLive(true);
      void video.play().catch(() => {
        if (!disposed) setMessage("If playback is blocked, interact with this OBS Browser Source once.");
      });
    };

    const subscribeFal = async (sessionId: string, offer: { sdp: string; candidates: RTCIceCandidateInit[] }) => {
      const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      const candidates: RTCIceCandidateInit[] = [];
      peer.onicecandidate = (event) => {
        if (event.candidate) candidates.push(event.candidate.toJSON());
      };
      peer.ontrack = (event) => {
        if (disposed || falPeer !== peer) return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        attachStream(stream);
      };
      peer.onconnectionstatechange = () => {
        if (disposed || falPeer !== peer) return;
        if (peer.connectionState === "failed" || peer.connectionState === "closed") clearVideo();
      };

      await peer.setRemoteDescription({ type: "offer", sdp: offer.sdp });
      for (const candidate of offer.candidates) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);
      if (disposed) {
        peer.close();
        return;
      }
      falPeer = peer;
      await fetch("/api/obs/fal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "answer",
          key: viewKey,
          sessionId,
          sdp: peer.localDescription?.sdp ?? answer.sdp,
          candidates,
        }),
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
          logOnce(`status-${response.status}`, `The OBS status endpoint returned HTTP ${response.status}. Check the server terminal and the key in this URL.`);
          clearVideo();
          return;
        }
        const payload = await response.json() as ViewerPayload;
        if (disposed) return;

        if (payload.live && payload.provider === "fal" && payload.sessionId && payload.offer) {
          const token = `fal:${payload.sessionId}:${payload.offer.sdp.length}:${payload.offer.sdp.slice(0, 64)}`;
          if (token === activeToken) return;
          clearVideo();
          activeToken = token;
          await subscribeFal(payload.sessionId, payload.offer);
          return;
        }

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
          logOnce("attach-failed", "Could not reach the server or attach to the live session; retrying on the next status poll.", error);
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
        {!live && <iframe src="/standby" className="obs-standby-frame" title="Waiting for live session" />}
        <div className="obs-message" aria-live="polite">{message}</div>
      </div>
    </main>
  );
}

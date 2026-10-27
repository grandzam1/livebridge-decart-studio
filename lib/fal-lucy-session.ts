"use client";

import { fal } from "@fal-ai/client";
import type { RealtimeMode } from "@/lib/decart";
import { falAppForMode, falPromptForMode, type FalLucyApp } from "@/lib/fal-models";

type FalRealtimeConnection = {
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
};

type IceServerLike = {
  urls?: string | string[];
  username?: string;
  credential?: string;
};

type FalSignalResult = {
  type?: string;
  iceServers?: IceServerLike[];
  iceservers?: IceServerLike[];
  ice_servers?: IceServerLike[];
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  turn_config?: {
    server_url?: string;
    username?: string;
    credential?: string;
  };
  success?: boolean;
  error?: string;
};

export type FalLucySession = {
  disconnect: () => void;
  setImage: (file: File | null) => Promise<void>;
};

export type ConnectFalLucyOptions = {
  mode: RealtimeMode;
  media: MediaStream;
  reference?: File | null;
  onRemoteStream: (stream: MediaStream) => void;
  onError: (message: string) => void;
  onConnected: () => void;
  onGenerationStarted?: () => void;
  signal?: AbortSignal;
};

function normalizeIceServers(servers: IceServerLike[] | undefined): RTCIceServer[] {
  if (!Array.isArray(servers)) return [];
  return servers
    .filter((server) => server?.urls)
    .map((server) => ({
      urls: server.urls as string | string[],
      username: server.username,
      credential: server.credential,
    }));
}

async function fileToDataUri(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the reference image."));
    };
    reader.onerror = () => reject(new Error("Could not read the reference image."));
    reader.readAsDataURL(file);
  });
}

async function fetchFalToken(app: FalLucyApp, signal?: AbortSignal): Promise<string> {
  const response = await fetch("/api/fal/realtime-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app }),
    cache: "no-store",
    signal,
  });
  const payload = await response.json() as { token?: string; error?: string };
  if (!response.ok || !payload.token) {
    throw new Error(payload.error ?? "Could not get a short-lived FAL session token.");
  }
  return payload.token;
}

/**
 * Opens a FAL Lucy realtime WebRTC session for studio preview only.
 * OBS subscribe is not supported on this path.
 */
export async function connectFalLucySession(options: ConnectFalLucyOptions): Promise<FalLucySession> {
  const app = falAppForMode(options.mode);
  const prompt = falPromptForMode(options.mode);
  let peer: RTCPeerConnection | null = null;
  let connection: FalRealtimeConnection | null = null;
  let disposed = false;
  let connectedNotified = false;

  const cleanup = () => {
    disposed = true;
    const currentPeer = peer;
    peer = null;
    currentPeer?.close();
    const currentConnection = connection;
    connection = null;
    try {
      currentConnection?.close();
    } catch {
      // Ignore close races after network errors.
    }
  };

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const onAbort = () => cleanup();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const handleResult = async (result: FalSignalResult) => {
    if (disposed || !connection) return;
    const type = result.type;

    try {
      switch (type) {
        case "iceservers":
        case "iceServers": {
          if (peer) return;
          const servers = normalizeIceServers(result.iceServers ?? result.iceservers ?? result.ice_servers);
          peer = new RTCPeerConnection({ iceServers: servers });
          const activePeer = peer;

          options.media.getTracks().forEach((track) => {
            activePeer.addTrack(track, options.media);
          });

          activePeer.ontrack = (event) => {
            if (disposed) return;
            const stream = event.streams[0] ?? new MediaStream([event.track]);
            options.onRemoteStream(stream);
            if (!connectedNotified) {
              connectedNotified = true;
              options.onConnected();
            }
          };

          activePeer.onicecandidate = (event) => {
            if (disposed || !connection || !event.candidate) return;
            connection.send({
              type: "icecandidate",
              candidate: {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
              },
            });
          };

          activePeer.onconnectionstatechange = () => {
            if (disposed || !activePeer) return;
            if (activePeer.connectionState === "failed") {
              options.onError("The FAL WebRTC session failed. Start a new session to reconnect.");
              cleanup();
            }
          };

          const offer = await activePeer.createOffer();
          await activePeer.setLocalDescription(offer);
          if (disposed || !connection) return;
          connection.send({ type: "offer", sdp: offer.sdp });
          break;
        }
        case "answer": {
          if (!peer || !result.sdp) return;
          await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
          break;
        }
        case "icecandidate": {
          if (!peer || !result.candidate) return;
          await peer.addIceCandidate(new RTCIceCandidate(result.candidate));
          break;
        }
        case "ice-restart": {
          if (!peer || !result.turn_config?.server_url) return;
          peer.setConfiguration({
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              {
                urls: result.turn_config.server_url,
                username: result.turn_config.username,
                credential: result.turn_config.credential,
              },
            ],
          });
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(offer);
          if (disposed || !connection) return;
          connection.send({ type: "offer", sdp: offer.sdp });
          break;
        }
        case "generation_started": {
          options.onGenerationStarted?.();
          break;
        }
        case "prompt_ack":
        case "set_image_ack": {
          if (result.success === false) {
            options.onError(result.error || "FAL rejected the prompt or reference image update.");
          }
          break;
        }
        case "error": {
          options.onError(result.error || "The FAL session reported an error.");
          cleanup();
          break;
        }
        default:
          break;
      }
    } catch (error) {
      if (disposed) return;
      options.onError(error instanceof Error ? error.message : "FAL WebRTC signaling failed.");
      cleanup();
    }
  };

  try {
    connection = fal.realtime.connect(app, {
      connectionKey: `livebridge-fal-${Date.now()}`,
      throttleInterval: 0,
      tokenExpirationSeconds: 120,
      tokenProvider: async () => fetchFalToken(app, options.signal),
      onError: (error) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : "The FAL session reported an error.";
        options.onError(message);
        cleanup();
      },
      onResult: (raw) => {
        void handleResult(raw as FalSignalResult);
      },
    }) as FalRealtimeConnection;

    const initialPayload: Record<string, unknown> = {
      prompt,
      enable_prompt_expansion: true,
      enhance_prompt: true,
    };
    if (options.reference) {
      initialPayload.reference_image_url = await fileToDataUri(options.reference);
    }
    if (disposed || !connection) throw new DOMException("Aborted", "AbortError");
    connection.send(initialPayload);

    return {
      disconnect: () => {
        options.signal?.removeEventListener("abort", onAbort);
        cleanup();
      },
      setImage: async (file) => {
        if (disposed || !connection) throw new Error("The FAL session is not connected.");
        const payload: Record<string, unknown> = {
          prompt,
          enable_prompt_expansion: true,
          enhance_prompt: true,
        };
        if (file) payload.reference_image_url = await fileToDataUri(file);
        else payload.reference_image_url = null;
        connection.send(payload);
      },
    };
  } catch (error) {
    options.signal?.removeEventListener("abort", onAbort);
    cleanup();
    throw error;
  }
}

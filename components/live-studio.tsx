"use client";

import { createDecartClient, models, type RealTimeClient } from "@decartai/sdk";
import {
  ActionIcon,
  Alert,
  AppShell,
  AspectRatio,
  Badge,
  Box,
  Button,
  Center,
  Container,
  CopyButton,
  Divider,
  Flex,
  Group,
  Image,
  Indicator,
  Loader,
  Paper,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import {
  IconAperture,
  IconCamera,
  IconCheck,
  IconCoins,
  IconCopy,
  IconExternalLink,
  IconLayoutColumns,
  IconPhoto,
  IconPictureInPicture,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconUpload,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, toErrorView, type ErrorView } from "@/lib/api-client";
import { DEFAULT_MODE, REALTIME_MODES, modeById, modelForMode, type RealtimeMode, type RealtimeModelName } from "@/lib/decart";
import { connectFalLucySession, type FalLucySession } from "@/lib/fal-lucy-session";
import type { LiveProvider } from "@/lib/live-provider";
import { maxImageBytes, publicConfig } from "@/lib/public-config";

type SessionState = "idle" | "connecting" | "connected" | "generating" | "reconnecting" | "disconnected" | "error";
type ServerSetupStatus = { configured: boolean; missing: string[]; invalid?: string[]; provider?: LiveProvider };
type SavedReference = { name: string; url: string };
type SessionEvent = {
  id: string;
  at: string;
  type: "start" | "stop" | "error" | "reference";
  provider: "decart" | "fal";
  mode: string;
  detail?: string;
  reference?: string;
  seconds?: number;
};

function formatEventTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatEventDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function setupProblem(status: ServerSetupStatus | null) {
  const parts: string[] = [];
  if (status?.missing.length) parts.push(`Add ${status.missing.join(" and ")} to .env`);
  if (status?.invalid?.length) parts.push(`fix ${status.invalid.join(" and ")} in .env (details in the server terminal)`);
  return parts.length ? `${parts.join(" and ")}, then restart the server.` : "Set the provider key and APP_ORIGINS in .env, then restart the server.";
}

const { appName, logoUrl } = publicConfig.branding;
const REFERENCE_MAX_BYTES = maxImageBytes;
const REFERENCE_MAX_LABEL = `${publicConfig.upload.maxImageMb} MB`;
const ACCEPTED_IMAGE_TYPES = new Set<string>(IMAGE_MIME_TYPE);

function imageFileFromClipboard(data: DataTransfer | null) {
  if (!data) return null;
  const listed = Array.from(data.files).find((file) => file.type.startsWith("image/"));
  if (listed) return listed;
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

function isTextEntry(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function viewerUrl(viewKey: string) {
  return `${window.location.origin}/obs?key=${encodeURIComponent(viewKey)}`;
}

function obsKeyFromUrl(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("key");
  } catch {
    return null;
  }
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 2500) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);
    function done() {
      window.clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    function onChange() {
      if (peer.iceGatheringState === "complete") done();
    }
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}

type FalObsRelay = {
  sessionId: string;
  peer: RTCPeerConnection;
  publishTimer: number | null;
  answerTimer: number | null;
  answered: boolean;
};

function VideoPlaceholder({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <Center pos="absolute" inset={0} p="md" style={{ background: "#080c0c" }}>
      <Stack gap={6} align="center" ta="center" maw={320}>
        <Box c="dimmed">{icon}</Box>
        <Text size="sm" fw={600} c="gray.4">{title}</Text>
        <Text size="xs" c="dimmed" lineClamp={3}>{detail}</Text>
      </Stack>
    </Center>
  );
}

export function LiveStudio() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const realtimeRef = useRef<RealTimeClient | null>(null);
  const falSessionRef = useRef<FalLucySession | null>(null);
  const falObsRef = useRef<FalObsRelay | null>(null);
  const mountedRef = useRef(false);
  const startGenerationRef = useRef(0);
  const startAbortRef = useRef<AbortController | null>(null);
  const obsSessionIdRef = useRef<string | null>(null);
  const obsModelRef = useRef<RealtimeModelName | null>(null);
  const clearPublishedSessionRef = useRef<() => void>(() => undefined);
  const stopFalObsRelayRef = useRef<() => void>(() => undefined);
  const modeRef = useRef<RealtimeMode>(DEFAULT_MODE);
  const liveProviderRef = useRef<"decart" | "fal">("decart");
  const cameraLabelRef = useRef<string | null>(null);
  const secondsRef = useRef(0);
  const falRetryRef = useRef(0);
  const startSessionRef = useRef<() => void>(() => undefined);
  const logSessionRef = useRef<(type: SessionEvent["type"], extra?: { detail?: string; reference?: string; seconds?: number }) => void>(() => undefined);
  const loadCreditsRef = useRef<() => void>(() => undefined);
  const [mode, setMode] = useState<RealtimeMode>(DEFAULT_MODE);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceApplied, setReferenceApplied] = useState(false);
  const [savedRefs, setSavedRefs] = useState<SavedReference[]>([]);
  const [savedRefBusy, setSavedRefBusy] = useState<string | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [credits, setCredits] = useState<{ decart: { ok: boolean; credits?: number; usd?: number; reason?: string } | null; fal: { ok: boolean; credits?: number; usd?: number; reason?: string } | null } | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [obsUrl, setObsUrl] = useState<string | null>(null);
  const [error, setErrorState] = useState<ErrorView | null>(null);
  const setError = useCallback((value: string | ErrorView | null) => {
    setErrorState(typeof value === "string" ? { message: value } : value);
  }, []);
  const [busy, setBusy] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [pipLayout, setPipLayout] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerSetupStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [obsLinkFailed, setObsLinkFailed] = useState(false);
  const isMobile = useMediaQuery("(max-width: 48em)");

  const loadServerStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/config/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Configuration status unavailable");
      const status = await response.json() as ServerSetupStatus;
      if (!mountedRef.current) return;
      setServerStatus(status);
      setStatusFailed(false);
    } catch {
      if (mountedRef.current) setStatusFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadServerStatus();
  }, [loadServerStatus]);

  const publishObsSession = useCallback(async (sessionId: string, subscribeToken: string | null, model: RealtimeModelName | null) => {
    try {
      const response = await fetch("/api/obs/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, subscribeToken, model }),
        cache: "no-store",
        keepalive: true,
      });
      return response.ok || response.status === 204;
    } catch {
      return false;
    }
  }, []);

  clearPublishedSessionRef.current = () => {
    const sessionId = obsSessionIdRef.current;
    obsSessionIdRef.current = null;
    obsModelRef.current = null;
    if (!sessionId) return;
    void publishObsSession(sessionId, null, null);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const sessionId = obsSessionIdRef.current;
      const modelName = obsModelRef.current;
      const session = realtimeRef.current;
      const subscribeToken = session?.subscribeToken;
      if (!sessionId || !modelName || !subscribeToken || !session.isConnected()) return;
      void publishObsSession(sessionId, subscribeToken, modelName);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [publishObsSession]);

  const loadObsLink = useCallback(async () => {
    try {
      const response = await fetch("/api/obs/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("OBS link unavailable");
      const payload = await response.json() as { viewKey?: string };
      if (!mountedRef.current) return;
      setObsLinkFailed(false);
      if (payload.viewKey) setObsUrl(viewerUrl(payload.viewKey));
    } catch {
      if (!mountedRef.current) return;
      setObsUrl(null);
      setObsLinkFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadObsLink();
  }, [loadObsLink]);

  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      const videoInputs = devices.filter((device) => device.kind === "videoinput");
      setCameras(videoInputs);
      setCameraId((current) => {
        if (current && videoInputs.some((device) => device.deviceId === current)) return current;
        // Prefer a physical camera — virtual feeds (OBS, etc.) loop the app back into itself.
        const physical = videoInputs.find((device) => !/virtual|obs|epoccam|iriun|droidcam|manycam/i.test(device.label));
        return (physical ?? videoInputs[0])?.deviceId ?? null;
      });
    } catch {
      if (mountedRef.current) setError("Camera devices could not be listed. Check browser permissions and reload.");
    }
  }, []);

  useEffect(() => {
    void refreshCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshCameras);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshCameras);
  }, [refreshCameras]);

  useEffect(() => {
    if (sessionState !== "connected" && sessionState !== "generating" && sessionState !== "reconnecting") return;
    const timer = window.setInterval(() => setSessionSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [sessionState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startGenerationRef.current += 1;
      startAbortRef.current?.abort();
      startAbortRef.current = null;
      clearPublishedSessionRef.current();
      const session = realtimeRef.current;
      realtimeRef.current = null;
      session?.disconnect();
      const falSession = falSessionRef.current;
      falSessionRef.current = null;
      falSession?.disconnect();
      stopFalObsRelayRef.current();
      const media = localStreamRef.current;
      localStreamRef.current = null;
      media?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!referenceUrl) return;
    return () => URL.revokeObjectURL(referenceUrl);
  }, [referenceUrl]);

  const stopFalObsRelay = useCallback(() => {
    const relay = falObsRef.current;
    falObsRef.current = null;
    if (!relay) return;
    if (relay.publishTimer !== null) window.clearInterval(relay.publishTimer);
    if (relay.answerTimer !== null) window.clearInterval(relay.answerTimer);
    relay.peer.close();
    void fetch("/api/obs/fal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", sessionId: relay.sessionId }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);
  stopFalObsRelayRef.current = stopFalObsRelay;

  const startFalObsRelay = useCallback((stream: MediaStream) => {
    if (falObsRef.current || !mountedRef.current) return;
    const key = obsKeyFromUrl(obsUrl);
    if (!key) return;

    const sessionId = crypto.randomUUID();
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const candidates: RTCIceCandidateInit[] = [];
    peer.onicecandidate = (event) => {
      if (event.candidate) candidates.push(event.candidate.toJSON());
    };
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    void (async () => {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const sdp = peer.localDescription?.sdp;
      if (!sdp || !mountedRef.current || falObsRef.current) {
        peer.close();
        return;
      }

      const relay: FalObsRelay = { sessionId, peer, publishTimer: null, answerTimer: null, answered: false };
      falObsRef.current = relay;

      const publishOffer = () => fetch("/api/obs/fal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "offer", sessionId, sdp, candidates }),
        keepalive: true,
      }).catch(() => undefined);

      void publishOffer();
      relay.publishTimer = window.setInterval(() => void publishOffer(), 8_000);

      relay.answerTimer = window.setInterval(() => {
        void (async () => {
          if (relay.answered || falObsRef.current !== relay) return;
          try {
            const response = await fetch(`/api/obs/fal?role=studio&key=${encodeURIComponent(key)}&session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
            if (!response.ok) return;
            const payload = await response.json() as { answer?: { sdp: string; candidates: RTCIceCandidateInit[] } | null };
            if (!payload.answer?.sdp || relay.answered || falObsRef.current !== relay) return;
            relay.answered = true;
            if (relay.answerTimer !== null) {
              window.clearInterval(relay.answerTimer);
              relay.answerTimer = null;
            }
            await peer.setRemoteDescription({ type: "answer", sdp: payload.answer.sdp });
            for (const candidate of payload.answer.candidates) {
              await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
            }
          } catch {
            // The viewer polls the status endpoint; the next tick retries.
          }
        })();
      }, 1_500);
    })().catch(() => {
      if (falObsRef.current?.sessionId === sessionId) falObsRef.current = null;
      peer.close();
    });
  }, [obsUrl]);

  const attachOutput = useCallback((stream: MediaStream) => {
    const video = outputVideoRef.current;
    if (video) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
    if (falSessionRef.current) startFalObsRelay(stream);
  }, [startFalObsRelay]);

  const stopSession = useCallback(() => {
    const hadSession = Boolean(realtimeRef.current || falSessionRef.current);
    startGenerationRef.current += 1;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    clearPublishedSessionRef.current();
    stopFalObsRelayRef.current();
    const session = realtimeRef.current;
    realtimeRef.current = null;
    session?.disconnect();
    const falSession = falSessionRef.current;
    falSessionRef.current = null;
    falSession?.disconnect();
    const media = localStreamRef.current;
    localStreamRef.current = null;
    media?.getTracks().forEach((track) => track.stop());
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (outputVideoRef.current) outputVideoRef.current.srcObject = null;
    setSessionState("idle");
    setSessionSeconds(0);
    setReferenceApplied(false);
    falRetryRef.current = 0;
    if (hadSession) {
      logSessionRef.current("stop", { seconds: secondsRef.current });
      loadCreditsRef.current();
    }
  }, []);

  const startSession = useCallback(async () => {
    if (busy || sessionState === "connected" || sessionState === "connecting") return;
    if (!serverStatus?.configured) {
      setError({ message: "The server is not set up for live sessions yet.", hint: setupProblem(serverStatus) });
      return;
    }
    if (!mountedRef.current) return;

    const attemptId = ++startGenerationRef.current;
    const abortController = new AbortController();
    startAbortRef.current = abortController;
    const isCurrentAttempt = () => mountedRef.current && startGenerationRef.current === attemptId;
    const disposePendingMedia = (media: MediaStream) => {
      media.getTracks().forEach((track) => track.stop());
      if (localStreamRef.current === media) localStreamRef.current = null;
      if (localVideoRef.current?.srcObject === media) localVideoRef.current.srcObject = null;
    };
    const provider = serverStatus.provider === "fal" ? "fal" : "decart";

    setBusy(true);
    setError(null);
    setSessionState("connecting");
    const modelName = modelForMode(mode);

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: microphoneOn,
      });
      if (!isCurrentAttempt()) {
        disposePendingMedia(media);
        return;
      }
      localStreamRef.current = media;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = media;
        void localVideoRef.current.play().catch(() => undefined);
      }
      await refreshCameras();
      if (!isCurrentAttempt()) {
        disposePendingMedia(media);
        return;
      }

      if (provider === "fal") {
        const falSession = await connectFalLucySession({
          mode,
          media,
          reference,
          signal: abortController.signal,
          onRemoteStream: attachOutput,
          onConnected: () => {
            if (!mountedRef.current || !isCurrentAttempt()) return;
            setSessionState("connected");
          },
          onGenerationStarted: () => {
            if (!mountedRef.current || !isCurrentAttempt()) return;
            setSessionState("generating");
          },
          onError: (message) => {
            if (!mountedRef.current || !isCurrentAttempt()) return;
            const text = typeof message === "string" ? message : message.message;
            if (/concurrent|limit/i.test(text) && falRetryRef.current < 4) {
              falSession.disconnect();
              disposePendingMedia(media);
              falRetryRef.current += 1;
              const delay = 15;
              setSessionState("connecting");
              setError({
                message: "FAL reports the previous session is still closing.",
                hint: `Retrying automatically in ${delay}s (attempt ${falRetryRef.current}/4)…`,
              });
              window.setTimeout(() => {
                if (isCurrentAttempt()) startSessionRef.current();
              }, delay * 1000);
              return;
            }
            stopSession();
            setSessionState("error");
            setError(message);
            logSessionRef.current("error", { detail: text });
          },
        });
        if (!isCurrentAttempt()) {
          falSession.disconnect();
          disposePendingMedia(media);
          return;
        }
        falSessionRef.current = falSession;
        falRetryRef.current = 0;
        setSessionSeconds(0);
        setReferenceApplied(Boolean(reference));
        logSessionRef.current("start", { detail: cameraLabelRef.current ?? undefined, reference: reference?.name });
        return;
      }

      const tokenPayload = await fetchJson<{ clientToken?: string }>("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName }),
        signal: abortController.signal,
      });
      if (!isCurrentAttempt()) {
        disposePendingMedia(media);
        return;
      }
      if (!tokenPayload.clientToken) {
        throw new Error("Could not get a short-lived Decart session token.");
      }

      const client = createDecartClient({ apiKey: tokenPayload.clientToken, telemetry: false });
      const realtime = await client.realtime.connect(media, {
        model: models.realtime(modelName),
        resolution: "720p",
        mirror: "auto",
        onRemoteStream: attachOutput,
        ...(reference ? { initialState: { image: reference } } : {}),
      });
      if (!isCurrentAttempt()) {
        realtime.disconnect();
        disposePendingMedia(media);
        return;
      }
      realtimeRef.current = realtime;
      const sessionId = crypto.randomUUID();
      obsSessionIdRef.current = sessionId;
      obsModelRef.current = modelName;
      setSessionState(realtime.getConnectionState() as SessionState);
      setSessionSeconds(0);
      setReferenceApplied(Boolean(reference));
      logSessionRef.current("start", { detail: cameraLabelRef.current ?? undefined, reference: reference?.name });

      const publishViewer = () => {
        const subscribeToken = realtime.subscribeToken;
        if (!subscribeToken) return;
        void publishObsSession(sessionId, subscribeToken, modelName).then((published) => {
          if (!published && mountedRef.current && realtimeRef.current === realtime) {
            setError("The live video is running here, but the OBS page could not be updated.");
          }
        });
      };
      publishViewer();
      realtime.on("connectionChange", (state) => {
        if (!mountedRef.current || realtimeRef.current !== realtime) return;
        if (state === "disconnected") {
          stopSession();
          setSessionState("error");
          setError("The Decart session disconnected. Start a new session to reconnect.");
          return;
        }
        setSessionState(state as SessionState);
        publishViewer();
      });
      realtime.on("generationTick", ({ seconds }) => {
        if (mountedRef.current && realtimeRef.current === realtime) setSessionSeconds(seconds);
      });
      realtime.on("error", (sdkError) => {
        if (!mountedRef.current || realtimeRef.current !== realtime) return;
        stopSession();
        setSessionState("error");
        const message = sdkError.message || "The Decart session reported an error.";
        setError(message);
        logSessionRef.current("error", { detail: message });
      });
      realtime.on("sessionEnded", () => {
        if (!mountedRef.current || realtimeRef.current !== realtime) return;
        stopSession();
        setSessionState("error");
        setError("Decart ended this session. Start a new session to reconnect.");
        logSessionRef.current("error", { detail: "Decart ended this session." });
      });
    } catch (caught) {
      if (!isCurrentAttempt()) return;
      stopSession();
      if (!mountedRef.current) return;
      setSessionState("error");
      const view = toErrorView(caught, "Unable to start the live session.");
      setError(view);
      logSessionRef.current("error", { detail: view.message });
    } finally {
      if (startAbortRef.current === abortController) startAbortRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  }, [attachOutput, busy, cameraId, mode, microphoneOn, publishObsSession, refreshCameras, reference, serverStatus, sessionState, stopSession]);
  startSessionRef.current = () => void startSession();

  const applyReference = async () => {
    if (!reference || referenceBusy) return;
    setReferenceBusy(true);
    setError(null);
    try {
      const falSession = falSessionRef.current;
      if (falSession) {
        await falSession.setImage(reference);
        if (mountedRef.current && falSessionRef.current === falSession) setReferenceApplied(true);
        logSessionRef.current("reference", { detail: "Applied to live", reference: reference.name });
        return;
      }
      const session = realtimeRef.current;
      if (session) {
        await session.setImage(reference);
        if (mountedRef.current && realtimeRef.current === session) setReferenceApplied(true);
        logSessionRef.current("reference", { detail: "Applied to live", reference: reference.name });
      }
    } catch (caught) {
      if (mountedRef.current) setError(toErrorView(caught, "The reference image could not be applied."));
    } finally {
      if (mountedRef.current) setReferenceBusy(false);
    }
  };

  const clearReference = async () => {
    if (referenceBusy) return;
    setReferenceBusy(true);
    setError(null);
    try {
      if (falSessionRef.current) await falSessionRef.current.setImage(null);
      else if (realtimeRef.current) await realtimeRef.current.setImage(null);
      if (!mountedRef.current) return;
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
      const clearedName = reference?.name;
      setReference(null);
      setReferenceUrl(null);
      setReferenceApplied(false);
      logSessionRef.current("reference", { detail: "Cleared", reference: clearedName });
    } catch (caught) {
      if (mountedRef.current) setError(toErrorView(caught, "The live reference could not be cleared."));
    } finally {
      if (mountedRef.current) setReferenceBusy(false);
    }
  };

  const loadSavedRefs = useCallback(async () => {
    try {
      const payload = await fetchJson<{ images?: SavedReference[] }>("/api/references");
      if (mountedRef.current && Array.isArray(payload.images)) setSavedRefs(payload.images);
    } catch {
      // The saved library is optional — keep the studio usable if it cannot be listed.
    }
  }, []);

  useEffect(() => {
    void loadSavedRefs();
  }, [loadSavedRefs]);

  const loadSessionEvents = useCallback(async () => {
    try {
      const payload = await fetchJson<{ events?: SessionEvent[] }>("/api/sessions");
      if (mountedRef.current && Array.isArray(payload.events)) setSessionEvents(payload.events);
    } catch {
      // The activity log is informational only.
    }
  }, []);

  useEffect(() => {
    void loadSessionEvents();
  }, [loadSessionEvents]);

  const loadCredits = useCallback(async () => {
    try {
      const payload = await fetchJson<{ decart: { ok: boolean; credits?: number; usd?: number; reason?: string } | null; fal: { ok: boolean; credits?: number; usd?: number; reason?: string } | null }>("/api/credits");
      if (mountedRef.current) setCredits(payload);
    } catch {
      // Balance display is informational only.
    }
  }, []);

  useEffect(() => {
    void loadCredits();
  }, [loadCredits]);
  loadCreditsRef.current = () => void loadCredits();

  const logSession = useCallback((type: SessionEvent["type"], extra?: { detail?: string; reference?: string; seconds?: number; provider?: "decart" | "fal"; mode?: string }) => {
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        provider: extra?.provider ?? liveProviderRef.current,
        mode: extra?.mode ?? modeRef.current,
        detail: extra?.detail,
        reference: extra?.reference,
        seconds: extra?.seconds,
      }),
    })
      .then((response) => { if (response.ok) void loadSessionEvents(); })
      .catch(() => undefined);
  }, [loadSessionEvents]);
  logSessionRef.current = logSession;

  const persistReference = useCallback((file: File) => {
    const form = new FormData();
    form.set("file", file, file.name || "reference");
    void fetchJson<{ image: SavedReference }>("/api/references", { method: "POST", body: form })
      .then((payload) => {
        if (!mountedRef.current || !payload.image) return;
        setSavedRefs((current) => (current.some((item) => item.name === payload.image.name) ? current : [payload.image, ...current]));
      })
      .catch((caught) => {
        if (mountedRef.current) setError(toErrorView(caught, "The image was selected but could not be saved to the library."));
      });
  }, [setError]);

  const selectReference = useCallback((file: File) => {
    if (referenceBusy || busy) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type) || file.size > REFERENCE_MAX_BYTES) {
      setError(`Choose a supported image file up to ${REFERENCE_MAX_LABEL}.`);
      return;
    }
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReference(file);
    setReferenceUrl(URL.createObjectURL(file));
    setReferenceApplied(false);
    setError(null);
    persistReference(file);
  }, [busy, persistReference, referenceBusy, referenceUrl, setError]);

  const pickSavedReference = useCallback(async (saved: SavedReference) => {
    if (referenceBusy || busy || savedRefBusy) return;
    setSavedRefBusy(saved.name);
    setError(null);
    try {
      const response = await fetch(saved.url, { cache: "no-store" });
      if (!response.ok) throw new Error("The saved image could not be loaded.");
      const blob = await response.blob();
      const file = new File([blob], saved.name, { type: blob.type || "image/png" });
      if (!mountedRef.current) return;
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
      setReference(file);
      setReferenceUrl(saved.url);
      setReferenceApplied(false);
    } catch (caught) {
      if (mountedRef.current) setError(toErrorView(caught, "The saved image could not be used."));
    } finally {
      if (mountedRef.current) setSavedRefBusy(null);
    }
  }, [busy, referenceBusy, referenceUrl, savedRefBusy, setError]);

  const deleteSavedReference = useCallback(async (saved: SavedReference) => {
    if (savedRefBusy) return;
    setSavedRefBusy(saved.name);
    setError(null);
    try {
      await fetchJson("/api/references", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saved.name }),
      });
      if (!mountedRef.current) return;
      setSavedRefs((current) => current.filter((item) => item.name !== saved.name));
      if (referenceUrl === saved.url) {
        setReference(null);
        setReferenceUrl(null);
        setReferenceApplied(false);
      }
    } catch (caught) {
      if (mountedRef.current) setError(toErrorView(caught, "The saved image could not be deleted."));
    } finally {
      if (mountedRef.current) setSavedRefBusy(null);
    }
  }, [referenceUrl, savedRefBusy, setError]);

  const onDrop = (files: File[]) => {
    const file = files[0];
    if (file) selectReference(file);
  };

  useEffect(() => {
    if (reference) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isTextEntry(event.target)) return;
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      selectReference(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [reference, selectReference]);

  const connected = sessionState === "connected" || sessionState === "generating" || sessionState === "reconnecting";
  const currentMode = modeById(mode);
  const liveProvider = serverStatus?.provider === "fal" ? "fal" : "decart";
  modeRef.current = mode;
  liveProviderRef.current = liveProvider;
  cameraLabelRef.current = cameras.find((device) => device.deviceId === cameraId)?.label ?? null;
  secondsRef.current = sessionSeconds;
  const cameraOptions = cameras.map((device, index) => ({
    value: device.deviceId,
    label: device.label
      ? `${device.label}${/virtual|obs|epoccam|iriun|droidcam|manycam/i.test(device.label) ? " (virtual feed)" : ""}`
      : `Camera ${index + 1}`,
  }));
  // Decart: 2 credits/sec realtime, 1 credit/sec for lucy-restyle-2. FAL Lucy apps: $0.02/sec (= 2 credits/sec).
  const creditsPerSecond = liveProvider === "decart" && modelForMode(mode) === "lucy-restyle-2" ? 1 : 2;
  const statusColor = !serverStatus ? "gray" : !serverStatus.configured ? "yellow" : connected ? "teal" : sessionState === "error" ? "red" : "gray";
  const statusLabel = !serverStatus ? (statusFailed ? "Status check failed" : "Checking setup") : !serverStatus.configured ? "Setup required" : connected ? "Live" : sessionState === "connecting" ? "Connecting" : sessionState === "error" ? "Needs attention" : "Ready";

  const cameraFrame = (
    <AspectRatio ratio={16 / 9}>
      <Box className={`video-frame${pipLayout ? " video-frame-pip" : ""}`} pos="relative" h="100%" bg="dark.9" style={{ overflow: "hidden", borderRadius: "var(--mantine-radius-md)" }}>
        <Badge className="video-chip" size="xs" variant="filled" color="dark" leftSection={<IconCamera size={12} />}>
          Camera
        </Badge>
        <video ref={localVideoRef} muted autoPlay playsInline />
        {!connected && (
          <VideoPlaceholder
            icon={<IconCamera size={24} />}
            title="Camera preview"
            detail="Select a camera, then start the live transformation."
          />
        )}
      </Box>
    </AspectRatio>
  );

  const outputFrame = (
    <AspectRatio ratio={16 / 9}>
      <Box className="video-frame" pos="relative" h="100%" bg="dark.9" style={{ overflow: "hidden", borderRadius: "var(--mantine-radius-md)" }}>
        <Badge className="video-chip" size="xs" variant="filled" color="dark" leftSection={<Indicator color={connected ? "teal" : "gray"} size={6} processing={connected} />}>
          Output
        </Badge>
        <video ref={outputVideoRef} autoPlay playsInline />
        {!connected && (
          <VideoPlaceholder
            icon={<IconAperture size={24} />}
            title="Output will appear here"
            detail={liveProvider === "fal" ? "The FAL Lucy stream appears after the connection is ready." : "The Decart stream appears after the connection is ready."}
          />
        )}
      </Box>
    </AspectRatio>
  );

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" miw={0}>
            {logoUrl ? (
              <Image src={logoUrl} alt={`${appName} logo`} w={28} h={28} fit="contain" />
            ) : (
              <ThemeIcon size="md" radius="md" variant="light" color="teal">
                <IconAperture size={18} stroke={1.8} />
              </ThemeIcon>
            )}
            <Box miw={0}>
              <Text size="sm" fw={700} truncate>{appName}</Text>
              <Text size="xs" c="dimmed" visibleFrom="xs" truncate>
                {liveProvider === "fal" ? "FAL Lucy studio" : "Decart live studio"}
              </Text>
            </Box>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text size="xs" c="dimmed" visibleFrom="sm">Your camera stays in your control</Text>
            {credits?.[liveProvider] && (
              <Tooltip
                label={credits[liveProvider]!.ok
                  ? `${liveProvider === "fal" ? "FAL" : "Decart"} balance ($${credits[liveProvider]!.usd!.toFixed(2)}) · ~${Math.floor(credits[liveProvider]!.credits! / (60 * creditsPerSecond))} min at ${creditsPerSecond} credits/sec · click to refresh`
                  : credits[liveProvider]!.reason}
              >
                <Badge
                  color={credits[liveProvider]!.ok ? "teal" : "yellow"}
                  variant="light"
                  leftSection={<IconCoins size={12} />}
                  style={{ cursor: "pointer" }}
                  onClick={() => void loadCredits()}
                >
                  {credits[liveProvider]!.ok
                    ? `${credits[liveProvider]!.credits!.toLocaleString("en-US")} credits (~${Math.floor(credits[liveProvider]!.credits! / (60 * creditsPerSecond))} min)`
                    : "Balance n/a"}
                </Badge>
              </Tooltip>
            )}
            <Badge color={statusColor} variant="light" leftSection={<Indicator color={statusColor} size={6} processing={connected} />}>
              {statusLabel}
            </Badge>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl" px={0}>
          <Stack gap="md">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Box maw={560}>
                <Title order={2}>Live studio</Title>
                <Text size="sm" c="dimmed" mt={4}>
                  {liveProvider === "fal"
                    ? "Choose a reference image, connect your camera, and preview the FAL Lucy transform here."
                    : "Choose a reference image, connect your camera, and send the transformed feed to OBS."}
                </Text>
              </Box>
              <Badge variant="outline" color="gray" leftSection={<IconAperture size={13} />}>
                {liveProvider === "fal" ? "FAL-hosted Lucy inference" : "Decart-hosted inference"}
              </Badge>
            </Group>

            {statusFailed && (
              <Alert
                color="red"
                variant="light"
                title="Could not check server setup"
                icon={<IconX size={16} />}
                withCloseButton
                onClose={() => setStatusFailed(false)}
              >
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <Text size="sm">The studio could not reach the server to check its configuration. Live start is disabled.</Text>
                  <Button size="xs" variant="light" color="red" leftSection={<IconRefresh size={14} />} onClick={() => void loadServerStatus()}>
                    Retry
                  </Button>
                </Group>
              </Alert>
            )}

            {serverStatus && (!serverStatus.configured || Boolean(serverStatus.invalid?.length)) && (
              <Alert color="yellow" variant="light" title={serverStatus.configured ? "Check server settings" : "Server setup needed"} icon={<IconX size={16} />}>
                {setupProblem(serverStatus)}
                {!serverStatus.configured && " The studio remains available, but live start is disabled until setup is complete."}
              </Alert>
            )}

            {error && (
              <Alert color="red" variant="light" title="Something needs attention" icon={<IconX size={16} />}>
                {error.message}
                {error.hint && <Text size="xs" mt={6} c="dimmed">{error.hint}</Text>}
              </Alert>
            )}

            <Paper withBorder radius="md" p={{ base: "sm", sm: "md" }}>
              <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
                <Box>
                  <Text size="sm" fw={700}>Live preview</Text>
                  <Text size="xs" c="dimmed">Your input and transformed output</Text>
                </Box>
                <Group gap="xs">
                  <Text size="xs" c="dimmed" ff="monospace">
                    {connected ? `SESSION ${formatDuration(sessionSeconds)}` : "CAMERA NOT CONNECTED"}
                  </Text>
                  <Tooltip label={pipLayout ? "Show side-by-side" : "Picture-in-picture"}>
                    <ActionIcon
                      variant={pipLayout ? "filled" : "default"}
                      color={pipLayout ? "teal" : "gray"}
                      size="sm"
                      aria-label={pipLayout ? "Show side-by-side preview" : "Show picture-in-picture preview"}
                      aria-pressed={pipLayout}
                      onClick={() => setPipLayout((current) => !current)}
                    >
                      {pipLayout ? <IconLayoutColumns size={16} /> : <IconPictureInPicture size={16} />}
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              {pipLayout ? (
                <Box pos="relative">
                  {outputFrame}
                  <Box className="video-pip-inset">{cameraFrame}</Box>
                </Box>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {cameraFrame}
                  {outputFrame}
                </SimpleGrid>
              )}

              <Divider my="md" />

              <Flex
                gap="sm"
                align={{ base: "stretch", sm: "center" }}
                direction={{ base: "column", sm: "row" }}
                justify="space-between"
              >
                <Group grow={!!isMobile} gap="sm" wrap="wrap" style={{ flex: 1 }} preventGrowOverflow={false}>
                  <Select
                    aria-label="Camera device"
                    placeholder="Choose camera"
                    data={cameraOptions}
                    value={cameraId}
                    onChange={setCameraId}
                    disabled={connected || sessionState === "connecting" || cameraOptions.length === 0}
                    leftSection={<IconCamera size={15} />}
                    size="sm"
                    w={{ base: "100%", sm: 240 }}
                    style={{ flex: isMobile ? 1 : undefined }}
                  />
                  <Tooltip label={microphoneOn ? "Microphone audio is included" : "Microphone audio is off"}>
                    <Switch
                      checked={microphoneOn}
                      onChange={(event) => setMicrophoneOn(event.currentTarget.checked)}
                      disabled={connected || sessionState === "connecting"}
                      label={<Group gap={6}><IconVolume size={15} /><Text size="xs">Mic</Text></Group>}
                      size="sm"
                    />
                  </Tooltip>
                </Group>
                {!connected ? (
                  <Button
                    fullWidth={!!isMobile}
                    leftSection={busy ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />}
                    onClick={() => void startSession()}
                    loading={busy}
                    disabled={!serverStatus?.configured || referenceBusy}
                    color="teal"
                    size="sm"
                  >
                    {!serverStatus ? (statusFailed ? "Status check failed" : "Checking setup") : serverStatus.configured ? "Start live" : "Setup required"}
                  </Button>
                ) : (
                  <Button
                    fullWidth={!!isMobile}
                    leftSection={<IconPlayerStop size={16} />}
                    onClick={stopSession}
                    color="red"
                    variant="light"
                    size="sm"
                  >
                    End session
                  </Button>
                )}
              </Flex>
            </Paper>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              <Paper withBorder radius="md" p={{ base: "sm", sm: "md" }}>
                <Group justify="space-between" align="flex-start" mb="sm">
                  <Box>
                    <Text size="sm" fw={700}>Reference image</Text>
                    <Text size="xs" c="dimmed" mt={4}>Use a visual guide for the live look</Text>
                  </Box>
                  <IconPhoto size={18} />
                </Group>
                {!reference ? (
                  <Dropzone
                    onDrop={onDrop}
                    onReject={() => setError(`Choose a supported image file up to ${REFERENCE_MAX_LABEL}.`)}
                    disabled={referenceBusy || busy}
                    accept={IMAGE_MIME_TYPE}
                    maxSize={REFERENCE_MAX_BYTES}
                    maxFiles={1}
                    multiple={false}
                  >
                    <Stack align="center" gap="xs" mih={120} justify="center" ta="center" py="md">
                      <IconUpload size={22} />
                      <Text size="sm" fw={600}>Drop, paste, or browse an image</Text>
                      <Text size="xs" c="dimmed">PNG, JPEG, WebP · up to {REFERENCE_MAX_LABEL} · Ctrl+V</Text>
                    </Stack>
                  </Dropzone>
                ) : (
                  <Stack gap="sm">
                    {referenceUrl && (
                      <Image
                        src={referenceUrl}
                        alt="Selected reference image preview"
                        radius="md"
                        mah={220}
                        fit="contain"
                        bg="dark.8"
                      />
                    )}
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Box miw={0} style={{ flex: 1 }}>
                        <Text size="xs" fw={600} truncate>{reference.name}</Text>
                        <Text size="xs" c="dimmed" ff="monospace" mt={4}>
                          {(reference.size / 1024 / 1024).toFixed(2)} MB · {reference.type || "image"}
                        </Text>
                      </Box>
                      <Badge color={referenceApplied ? "teal" : "gray"} variant="light" leftSection={referenceApplied ? <IconCheck size={12} /> : undefined}>
                        {referenceApplied ? "In use" : connected ? "Not applied" : "Ready"}
                      </Badge>
                    </Group>
                    <Group grow gap="xs" preventGrowOverflow={false}>
                      <Dropzone
                        onDrop={onDrop}
                        onReject={() => setError(`That image could not be used. Choose a supported image up to ${REFERENCE_MAX_LABEL}.`)}
                        disabled={referenceBusy || busy}
                        accept={IMAGE_MIME_TYPE}
                        maxSize={REFERENCE_MAX_BYTES}
                        maxFiles={1}
                        multiple={false}
                        activateOnClick
                        bd={0}
                        bg="transparent"
                        p={0}
                        style={{ minHeight: 0 }}
                      >
                        <Button component="span" size="xs" variant="default" fullWidth leftSection={<IconRefresh size={14} />} disabled={referenceBusy || busy}>
                          Replace
                        </Button>
                      </Dropzone>
                      {connected ? (
                        <Button size="xs" variant="light" color="teal" onClick={() => void applyReference()} loading={referenceBusy} disabled={referenceApplied || referenceBusy}>
                          {referenceApplied ? "Applied" : "Apply to live"}
                        </Button>
                      ) : (
                        <Badge color="gray" variant="light" fullWidth h={30} style={{ justifyContent: "center" }}>
                          Ready for next session
                        </Badge>
                      )}
                      <Tooltip label="Clear selected image">
                        <ActionIcon aria-label="Clear reference image" size="sm" variant="subtle" color="red" onClick={() => void clearReference()} disabled={referenceBusy || busy}>
                          {referenceBusy ? <Loader size={14} /> : <IconX size={15} />}
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Stack>
                )}
                {savedRefs.length > 0 && (
                  <>
                    <Divider my="sm" label="Saved references" labelPosition="left" />
                    <SimpleGrid cols={{ base: 3, xs: 4 }} spacing="xs">
                      {savedRefs.map((saved) => {
                        const selected = referenceUrl === saved.url;
                        const itemBusy = savedRefBusy === saved.name;
                        return (
                          <Box
                            key={saved.name}
                            pos="relative"
                            component="button"
                            type="button"
                            onClick={() => void pickSavedReference(saved)}
                            disabled={referenceBusy || busy || savedRefBusy !== null}
                            aria-label={`Use saved image ${saved.name}`}
                            style={{
                              cursor: referenceBusy || busy || savedRefBusy !== null ? "not-allowed" : "pointer",
                              border: selected ? "2px solid var(--mantine-color-teal-5)" : "2px solid transparent",
                              borderRadius: "var(--mantine-radius-sm)",
                              padding: 0,
                              overflow: "hidden",
                              background: "transparent",
                              opacity: selected ? 1 : 0.85,
                            }}
                          >
                            <Image src={saved.url} alt={saved.name} h={64} fit="cover" radius="sm" bg="dark.8" loading="lazy" />
                            {itemBusy && (
                              <Center pos="absolute" inset={0} bg="rgba(0,0,0,0.45)">
                                <Loader size={14} />
                              </Center>
                            )}
                            {selected && (
                              <Badge size="xs" color="teal" variant="filled" pos="absolute" bottom={4} left={4}>
                                In use
                              </Badge>
                            )}
                            <ActionIcon
                              component="span"
                              size="xs"
                              variant="filled"
                              color="red"
                              pos="absolute"
                              top={4}
                              right={4}
                              aria-label={`Delete saved image ${saved.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteSavedReference(saved);
                              }}
                            >
                              <IconX size={11} />
                            </ActionIcon>
                          </Box>
                        );
                      })}
                    </SimpleGrid>
                    <Text size="xs" c="dimmed" mt={6}>
                      Click a saved image to use it. Uploads are kept here for next time.
                    </Text>
                  </>
                )}
                <Text size="xs" c="dimmed" mt="sm">
                  {referenceBusy
                    ? "Updating the live reference…"
                    : connected
                      ? referenceApplied
                        ? "This image is guiding the active session."
                        : "Preview the replacement, then apply it to change the live look."
                      : "The selected image is sent only when the next live session starts."}
                </Text>
              </Paper>

              <Stack gap="md">
                <Paper withBorder radius="md" p={{ base: "sm", sm: "md" }}>
                  <Group justify="space-between" align="flex-start" mb="sm" wrap="wrap">
                    <Box>
                      <Text size="sm" fw={700}>Live mode</Text>
                      <Text size="xs" c="dimmed" mt={4}>{currentMode.detail}</Text>
                    </Box>
                    <Badge color="teal" variant="light">Image guided</Badge>
                  </Group>
                  <SegmentedControl
                    fullWidth
                    size={isMobile ? "xs" : "sm"}
                    value={mode}
                    onChange={(value) => setMode(value as RealtimeMode)}
                    disabled={connected || sessionState === "connecting"}
                    data={REALTIME_MODES.map((item) => ({ value: item.id, label: item.label }))}
                  />
                  <Text size="xs" c="dimmed" mt="xs">
                    {liveProvider === "fal"
                      ? "Choose the mode before connecting. FAL uses a built-in prompt per mode plus your reference image."
                      : "Choose the mode before connecting. No text prompt is needed in this studio."}
                  </Text>
                </Paper>

                <Paper withBorder radius="md" p={{ base: "sm", sm: "md" }}>
                  <Group justify="space-between" mb="xs">
                    <Box>
                      <Text size="sm" fw={700}>Your OBS link</Text>
                      <Text size="xs" c="dimmed" mt={4}>One Browser Source for the AI video</Text>
                    </Box>
                    <IconExternalLink size={18} />
                  </Group>
                  {obsUrl ? (
                    <Stack gap="xs">
                      <Paper withBorder p="xs" radius="sm" bg="dark.8">
                        <Text size="xs" ff="monospace" style={{ overflowWrap: "anywhere" }}>{obsUrl}</Text>
                      </Paper>
                      <CopyButton value={obsUrl} timeout={1800}>
                        {({ copied, copy }) => (
                          <Button fullWidth onClick={copy} size="xs" variant={copied ? "light" : "filled"} color="teal" leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}>
                            {copied ? "Copied" : "Copy"}
                          </Button>
                        )}
                      </CopyButton>
                      <Text size="xs" c="dimmed">
                        Paste this into OBS once as a Browser Source at 1920×1080. Leave this studio page open while you are live. Opening the OBS link in this same tab ends the call.
                      </Text>
                    </Stack>
                  ) : obsLinkFailed ? (
                    <Alert color="red" variant="light" icon={<IconX size={16} />}>
                      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                        <Text size="xs">The OBS link could not be loaded from the server.</Text>
                        <Button size="compact-xs" variant="light" color="red" leftSection={<IconRefresh size={12} />} onClick={() => void loadObsLink()}>
                          Retry
                        </Button>
                      </Group>
                    </Alert>
                  ) : (
                    <Alert color="gray" variant="light" icon={<IconAperture size={16} />}>
                      <Text size="xs">The OBS link is not available yet. Set OBS_KEY and add this site to APP_ORIGINS.</Text>
                    </Alert>
                  )}
                </Paper>

                <Paper withBorder radius="md" p={{ base: "sm", sm: "md" }}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Group gap="xs" wrap="nowrap" align="flex-start" miw={0} style={{ flex: 1 }}>
                      <Indicator color={connected ? "teal" : "gray"} size={8} processing={connected} mt={6} />
                      <Box miw={0}>
                        <Text size="sm" fw={700}>Session status</Text>
                        <Text size="xs" c="dimmed" mt={3}>
                          {connected
                            ? `Connected · ${formatDuration(sessionSeconds)}`
                            : !serverStatus
                              ? "Checking server setup…"
                              : !serverStatus.configured
                                ? "Server setup required before connecting"
                                : sessionState === "connecting"
                                  ? "Requesting camera and connecting…"
                                  : sessionState === "error"
                                    ? "Connection needs attention"
                                    : "Not connected"}
                        </Text>
                      </Box>
                    </Group>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {connected ? "LIVE" : !serverStatus ? "CHECKING" : serverStatus.configured ? "READY" : "SETUP"}
                    </Text>
                  </Group>
                  {sessionEvents.length > 0 && (
                    <>
                      <Divider my="sm" label="Recent activity" labelPosition="left" />
                      <Stack gap={4}>
                        {sessionEvents.slice(0, 8).map((event) => (
                          <Group key={event.id} gap={6} wrap="nowrap" align="flex-start">
                            <Text size="xs" ff="monospace" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                              {formatEventDate(event.at)} {formatEventTime(event.at)}
                            </Text>
                            <Badge
                              size="xs"
                              variant="light"
                              color={event.type === "error" ? "red" : event.type === "start" ? "teal" : event.type === "reference" ? "blue" : "gray"}
                            >
                              {event.type}
                            </Badge>
                            <Text size="xs" c="dimmed" lineClamp={1} miw={0}>
                              {event.mode}
                              {event.seconds != null ? ` · ${formatDuration(event.seconds)}` : ""}
                              {event.reference ? ` · ${event.reference}` : ""}
                              {event.detail ? ` · ${event.detail}` : ""}
                            </Text>
                          </Group>
                        ))}
                      </Stack>
                    </>
                  )}
                </Paper>
              </Stack>
            </SimpleGrid>

            <Text size="xs" c="dimmed">
              {liveProvider === "fal"
                ? "Live video is processed through FAL (Decart Lucy). This app hosts the controls; it does not run models locally. Permanent FAL_KEY stays on the server. The OBS page receives the output through a local in-browser relay."
                : "Live video is processed by Decart. This app hosts the controls; it does not run Decart models locally. Keep a publicly reachable deployment behind owner access control to protect billable token creation."}
            </Text>
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

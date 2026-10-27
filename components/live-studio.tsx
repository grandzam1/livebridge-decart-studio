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
  Container,
  CopyButton,
  Divider,
  Group,
  Loader,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import {
  IconAperture,
  IconCamera,
  IconCheck,
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
import { REALTIME_MODES, modelForMode, type RealtimeMode, type RealtimeModelName } from "@/lib/decart";
import { connectFalLucySession, type FalLucySession } from "@/lib/fal-lucy-session";
import type { LiveProvider } from "@/lib/live-provider";

type SessionState = "idle" | "connecting" | "connected" | "generating" | "reconnecting" | "disconnected" | "error";
type ServerSetupStatus = { configured: boolean; missing: string[]; provider?: LiveProvider };

const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
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

function VideoPlaceholder({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="video-placeholder">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function LiveStudio() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const realtimeRef = useRef<RealTimeClient | null>(null);
  const falSessionRef = useRef<FalLucySession | null>(null);
  const mountedRef = useRef(false);
  const startGenerationRef = useRef(0);
  const startAbortRef = useRef<AbortController | null>(null);
  const obsSessionIdRef = useRef<string | null>(null);
  const obsModelRef = useRef<RealtimeModelName | null>(null);
  const clearPublishedSessionRef = useRef<() => void>(() => undefined);
  const [mode, setMode] = useState<RealtimeMode>("character");
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphoneOn, setMicrophoneOn] = useState(true);
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceApplied, setReferenceApplied] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [obsUrl, setObsUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [pipLayout, setPipLayout] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerSetupStatus | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/config/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Configuration status unavailable");
        return await response.json() as ServerSetupStatus;
      })
      .then((status) => {
        if (active) setServerStatus(status);
      })
      .catch(() => {
        if (active) setServerStatus({ configured: false, missing: ["server configuration status"] });
      });
    return () => { active = false; };
  }, []);

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

  useEffect(() => {
    let active = true;
    void fetch("/api/obs/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("OBS link unavailable");
        return await response.json() as { viewKey?: string };
      })
      .then((payload) => {
        if (!active || !payload.viewKey) return;
        setObsUrl(viewerUrl(payload.viewKey));
      })
      .catch(() => {
        if (active) setObsUrl(null);
      });
    return () => { active = false; };
  }, []);

  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mountedRef.current) return;
      const videoInputs = devices.filter((device) => device.kind === "videoinput");
      setCameras(videoInputs);
      setCameraId((current) => current && videoInputs.some((device) => device.deviceId === current) ? current : videoInputs[0]?.deviceId ?? null);
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
      const media = localStreamRef.current;
      localStreamRef.current = null;
      media?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!referenceUrl) return;
    return () => URL.revokeObjectURL(referenceUrl);
  }, [referenceUrl]);

  const attachOutput = useCallback((stream: MediaStream) => {
    const video = outputVideoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, []);

  const stopSession = useCallback(() => {
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
    const media = localStreamRef.current;
    localStreamRef.current = null;
    media?.getTracks().forEach((track) => track.stop());
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (outputVideoRef.current) outputVideoRef.current.srcObject = null;
    setSessionState("idle");
    setSessionSeconds(0);
    setReferenceApplied(false);
  }, []);

  const startSession = useCallback(async () => {
    if (busy || sessionState === "connected" || sessionState === "connecting") return;
    if (!serverStatus?.configured) {
      const missing = serverStatus?.missing?.length
        ? serverStatus.missing.join(" and ")
        : "the required provider credentials and APP_ORIGINS";
      setError(`Add ${missing} to the server environment before starting a live session.`);
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
            stopSession();
            setSessionState("error");
            setError(message);
          },
        });
        if (!isCurrentAttempt()) {
          falSession.disconnect();
          disposePendingMedia(media);
          return;
        }
        falSessionRef.current = falSession;
        setSessionSeconds(0);
        setReferenceApplied(Boolean(reference));
        return;
      }

      const tokenResponse = await fetch("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName }),
        cache: "no-store",
        signal: abortController.signal,
      });
      if (!isCurrentAttempt()) {
        disposePendingMedia(media);
        return;
      }
      const tokenPayload = await tokenResponse.json() as { clientToken?: string; error?: string };
      if (!isCurrentAttempt()) {
        disposePendingMedia(media);
        return;
      }
      if (!tokenResponse.ok || !tokenPayload.clientToken) {
        throw new Error(tokenPayload.error ?? "Could not get a short-lived Decart session token.");
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
        setError(sdkError.message || "The Decart session reported an error.");
      });
      realtime.on("sessionEnded", () => {
        if (!mountedRef.current || realtimeRef.current !== realtime) return;
        stopSession();
        setSessionState("error");
        setError("Decart ended this session. Start a new session to reconnect.");
      });
    } catch (caught) {
      if (!isCurrentAttempt()) return;
      stopSession();
      if (!mountedRef.current) return;
      setSessionState("error");
      setError(caught instanceof Error ? caught.message : "Unable to start the live session.");
    } finally {
      if (startAbortRef.current === abortController) startAbortRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  }, [attachOutput, busy, cameraId, mode, microphoneOn, publishObsSession, refreshCameras, reference, serverStatus, sessionState, stopSession]);

  const applyReference = async () => {
    if (!reference || referenceBusy) return;
    setReferenceBusy(true);
    setError(null);
    try {
      const falSession = falSessionRef.current;
      if (falSession) {
        await falSession.setImage(reference);
        if (mountedRef.current && falSessionRef.current === falSession) setReferenceApplied(true);
        return;
      }
      const session = realtimeRef.current;
      if (session) {
        await session.setImage(reference);
        if (mountedRef.current && realtimeRef.current === session) setReferenceApplied(true);
      }
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : "The reference image could not be applied.");
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
      setReference(null);
      setReferenceUrl(null);
      setReferenceApplied(false);
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : "The live reference could not be cleared.");
    } finally {
      if (mountedRef.current) setReferenceBusy(false);
    }
  };

  const selectReference = useCallback((file: File) => {
    if (referenceBusy || busy) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type) || file.size > REFERENCE_MAX_BYTES) {
      setError("Choose a supported image file up to 10 MB.");
      return;
    }
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReference(file);
    setReferenceUrl(URL.createObjectURL(file));
    setReferenceApplied(false);
    setError(null);
  }, [busy, referenceBusy, referenceUrl]);

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
  const currentMode = REALTIME_MODES.find((item) => item.id === mode) ?? REALTIME_MODES[0];
  const liveProvider = serverStatus?.provider === "fal" ? "fal" : "decart";
  const cameraOptions = cameras.map((device, index) => ({
    value: device.deviceId,
    label: device.label || `Camera ${index + 1}`,
  }));

  return (
    <AppShell header={{ height: 76 }} className="studio-shell">
      <AppShell.Header className="studio-header">
        <Group gap="sm" className="brand-lockup">
          <Box className="brand-glyph"><IconAperture size={20} stroke={1.8} /></Box>
          <Box>
            <Text className="brand-title">LiveBridge</Text>
            <Text className="brand-subtitle">{liveProvider === "fal" ? "FAL Lucy studio" : "Decart live studio"}</Text>
          </Box>
        </Group>
        <Group gap="md" className="header-meta">
          <Text size="xs" c="dimmed" className="desktop-only">Your camera stays in your control</Text>
          <Badge color={!serverStatus ? "gray" : !serverStatus.configured ? "yellow" : connected ? "teal" : sessionState === "error" ? "red" : "gray"} variant="light" leftSection={<span className={`status-led ${connected ? "is-live" : ""}`} />}>
            {!serverStatus ? "Checking setup" : !serverStatus.configured ? "Setup required" : connected ? "Live" : sessionState === "connecting" ? "Connecting" : sessionState === "error" ? "Needs attention" : "Ready"}
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="xl" className="studio-main">
          <Group className="page-heading" align="flex-end">
            <Box>
              <Title order={1}>Live studio</Title>
              <Text>
                {liveProvider === "fal"
                  ? "Choose a reference image, connect your camera, and preview the FAL Lucy transform here."
                  : "Choose a reference image, connect your camera, and send the transformed feed to OBS."}
              </Text>
            </Box>
            <Badge variant="outline" color="gray" leftSection={<IconAperture size={13} />}>
              {liveProvider === "fal" ? "FAL-hosted Lucy inference" : "Decart-hosted inference"}
            </Badge>
          </Group>

          {serverStatus && !serverStatus.configured && (
            <Alert mb="md" color="yellow" variant="light" title="Server setup needed" icon={<IconX size={16} />}>
              Add {serverStatus.missing.join(" and ")} to the server environment. The studio remains available, but live start is disabled until setup is complete.
            </Alert>
          )}

          {error && (
            <Alert mb="md" color="red" variant="light" title="Something needs attention" icon={<IconX size={16} />}>
              {error}
            </Alert>
          )}

          <div className="studio-layout">
            <Paper className="panel preview-panel" radius="lg" p="md">
                <Group justify="space-between" mb="sm" wrap="wrap">
                  <Group gap="xs">
                    <Text className="panel-title">Live preview</Text>
                    <Text className="panel-kicker">Your input and transformed output</Text>
                  </Group>
                  <Group gap="xs" align="center">
                    <Text className="mono-meta">{connected ? `SESSION ${formatDuration(sessionSeconds)}` : "CAMERA NOT CONNECTED"}</Text>
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
                <div className={`video-pair${pipLayout ? " is-pip" : ""}`}>
                  <div className="video-frame video-frame-camera">
                    <div className="video-label"><IconCamera size={12} /> Camera input</div>
                    <video ref={localVideoRef} muted autoPlay playsInline />
                    {!connected && <VideoPlaceholder icon={<IconCamera size={24} />} title="Camera preview" detail="Select a camera, then start the live transformation." />}
                  </div>
                  <div className="video-frame video-frame-output">
                    <div className="video-label"><span className={`status-led ${connected ? "is-live" : ""}`} /> Transformed output</div>
                    <video ref={outputVideoRef} autoPlay playsInline />
                    {!connected && (
                      <VideoPlaceholder
                        icon={<IconAperture size={24} />}
                        title="Output will appear here"
                        detail={liveProvider === "fal" ? "The FAL Lucy stream appears after the connection is ready." : "The Decart stream appears after the connection is ready."}
                      />
                    )}
                  </div>
                </div>
                <Divider my="md" color="dark.5" />
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <Group gap="sm" align="center" wrap="wrap">
                    <Select
                      aria-label="Camera device"
                      placeholder="Choose camera"
                      data={cameraOptions}
                      value={cameraId}
                      onChange={setCameraId}
                      disabled={connected || sessionState === "connecting" || cameraOptions.length === 0}
                      leftSection={<IconCamera size={15} />}
                      w={220}
                      size="sm"
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
                  <Group gap="xs">
                    {!connected ? (
                      <Button leftSection={busy ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />} onClick={() => void startSession()} loading={busy} disabled={!serverStatus?.configured || referenceBusy} color="teal" size="sm">
                        {!serverStatus ? "Checking setup" : serverStatus.configured ? "Start live" : "Setup required"}
                      </Button>
                    ) : (
                      <Button leftSection={<IconPlayerStop size={16} />} onClick={stopSession} color="red" variant="light" size="sm">
                        End session
                      </Button>
                    )}
                  </Group>
                </Group>
              </Paper>

            <div className="studio-main-column">
              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" align="flex-start" mb="sm">
                  <Box>
                    <Text className="panel-title">Reference image</Text>
                    <Text className="panel-kicker" mt={4}>Use a visual guide for the live look</Text>
                  </Box>
                  <IconPhoto size={18} color="var(--lb-accent)" />
                </Group>
                {!reference ? (
                  <Dropzone
                    onDrop={onDrop}
                    onReject={() => setError("Choose a supported image file up to 10 MB.")}
                    disabled={referenceBusy || busy}
                    accept={IMAGE_MIME_TYPE}
                    maxSize={10 * 1024 * 1024}
                    maxFiles={1}
                    multiple={false}
                    className="panel"
                    style={{ borderStyle: "dashed", boxShadow: "none", background: "rgba(7, 12, 12, .38)" }}
                  >
                    <div className="reference-empty">
                      <IconUpload size={23} color="var(--lb-accent)" />
                      <Text size="sm" fw={600}>Drop, paste, or browse an image</Text>
                      <Text size="xs" c="dimmed">PNG, JPEG, WebP and other common formats · up to 10 MB · Ctrl+V</Text>
                    </div>
                  </Dropzone>
                ) : (
                  <Stack gap="sm">
                    {referenceUrl && <img src={referenceUrl} alt="Selected reference image preview" className="reference-preview" />}
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Box className="reference-meta">
                        <Text size="xs" fw={600} className="reference-name">{reference.name}</Text>
                        <Text className="mono-meta" mt={4}>{(reference.size / 1024 / 1024).toFixed(2)} MB · {reference.type || "image"}</Text>
                      </Box>
                      <Badge color={referenceApplied ? "teal" : "gray"} variant="light" leftSection={referenceApplied ? <IconCheck size={12} /> : undefined}>
                        {referenceApplied ? "In use" : connected ? "Not applied" : "Ready"}
                      </Badge>
                    </Group>
                    <Group grow gap="xs">
                      <Dropzone
                        onDrop={onDrop}
                        onReject={() => setError("That image could not be used. Choose a supported image up to 10 MB.")}
                        disabled={referenceBusy || busy}
                        accept={IMAGE_MIME_TYPE}
                        maxSize={10 * 1024 * 1024}
                        maxFiles={1}
                        multiple={false}
                        activateOnClick
                        style={{ border: 0, padding: 0, background: "transparent" }}
                      >
                        <Button component="span" size="xs" variant="default" leftSection={<IconRefresh size={14} />} disabled={referenceBusy || busy}>Replace</Button>
                      </Dropzone>
                      {connected ? (
                        <Button size="xs" variant="light" color="teal" onClick={() => void applyReference()} loading={referenceBusy} disabled={referenceApplied || referenceBusy}>
                          {referenceApplied ? "Applied" : "Apply to live"}
                        </Button>
                      ) : (
                        <Badge color="gray" variant="light">Ready for next session</Badge>
                      )}
                      <Tooltip label="Clear selected image">
                        <ActionIcon aria-label="Clear reference image" size="sm" variant="subtle" color="red" onClick={() => void clearReference()} disabled={referenceBusy || busy}>
                          {referenceBusy ? <Loader size={14} /> : <IconX size={15} />}
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Stack>
                )}
                <Text className="panel-kicker" mt="sm">
                  {referenceBusy ? "Updating the live reference…" : connected ? referenceApplied ? "This image is guiding the active session." : "Preview the replacement, then apply it to change the live look." : "The selected image is sent only when the next live session starts."}
                </Text>
              </Paper>
            </div>

            <div className="studio-side-column">
              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" align="flex-start" mb="sm" wrap="wrap">
                  <Box>
                    <Text className="panel-title">Live mode</Text>
                    <Text className="panel-kicker" mt={4}>{currentMode.detail}</Text>
                  </Box>
                  <Badge color="teal" variant="light">Image guided</Badge>
                </Group>
                <SegmentedControl
                  className="mode-selector"
                  fullWidth
                  value={mode}
                  onChange={(value) => setMode(value as RealtimeMode)}
                  disabled={connected || sessionState === "connecting"}
                  data={REALTIME_MODES.map((item) => ({ value: item.id, label: item.label }))}
                />
                <Text className="panel-kicker" mt="xs">
                  {liveProvider === "fal"
                    ? "Choose the mode before connecting. FAL uses a built-in prompt per mode plus your reference image."
                    : "Choose the mode before connecting. No text prompt is needed in this studio."}
                </Text>
              </Paper>

              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" mb="xs">
                  <Box>
                    <Text className="panel-title">Your OBS link</Text>
                    <Text className="panel-kicker" mt={4}>One Browser Source for the AI video</Text>
                  </Box>
                  <IconExternalLink size={18} color="var(--lb-accent)" />
                </Group>
                {liveProvider === "fal" ? (
                  <Alert color="yellow" variant="light" icon={<IconAperture size={16} />}>
                    <Text size="xs">OBS Browser Source is Decart-only for now. With LIVE_PROVIDER=fal, live preview works in this studio, but the OBS page is not updated.</Text>
                  </Alert>
                ) : obsUrl ? (
                  <Stack gap="xs">
                    <Text className="obs-url">{obsUrl}</Text>
                    <CopyButton value={obsUrl} timeout={1800}>
                      {({ copied, copy }) => (
                        <Button onClick={copy} size="xs" variant={copied ? "light" : "filled"} color={copied ? "teal" : "teal"} leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}>
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      )}
                    </CopyButton>
                    <Text className="panel-kicker">Paste this into OBS once as a Browser Source at 1920×1080. Leave this studio page open while you are live. Opening the OBS link in this same tab ends the call.</Text>
                  </Stack>
                ) : (
                  <Alert color="gray" variant="light" icon={<IconAperture size={16} />}>
                    <Text size="xs">The OBS link is not available yet. Set OBS_KEY and add this site to APP_ORIGINS.</Text>
                  </Alert>
                )}
              </Paper>

              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <span className={`status-led ${connected ? "is-live" : ""}`} />
                    <Box>
                      <Text className="panel-title">Session status</Text>
                      <Text className="panel-kicker" mt={3}>{connected ? `Connected · ${formatDuration(sessionSeconds)}` : !serverStatus ? "Checking server setup…" : !serverStatus.configured ? "Server setup required before connecting" : sessionState === "connecting" ? "Requesting camera and connecting…" : sessionState === "error" ? "Connection needs attention" : "Not connected"}</Text>
                    </Box>
                  </Group>
                  <Text className="mono-meta">{connected ? "LIVE" : !serverStatus ? "CHECKING" : serverStatus.configured ? "READY" : "SETUP"}</Text>
                </Group>
              </Paper>
            </div>
          </div>
          <Text className="footer-note">
            {liveProvider === "fal"
              ? "Live video is processed through FAL (Decart Lucy). This app hosts the controls; it does not run models locally. Permanent FAL_KEY stays on the server. OBS output is not available on the FAL provider yet."
              : "Live video is processed by Decart. This app hosts the controls; it does not run Decart models locally. Keep a publicly reachable deployment behind owner access control to protect billable token creation."}
          </Text>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

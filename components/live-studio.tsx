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
  IconPhoto,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconUpload,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { REALTIME_MODES, modelForMode, type RealtimeMode, type RealtimeModelName } from "@/lib/decart";

type SessionState = "idle" | "connecting" | "connected" | "generating" | "reconnecting" | "disconnected" | "error";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function buildViewerUrl(token: string, model: RealtimeModelName) {
  const fragment = new URLSearchParams({ token, model });
  return `${window.location.origin}/obs#${fragment.toString()}`;
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

  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === "videoinput");
      setCameras(videoInputs);
      setCameraId((current) => current && videoInputs.some((device) => device.deviceId === current) ? current : videoInputs[0]?.deviceId ?? null);
    } catch {
      setError("Camera devices could not be listed. Check browser permissions and reload.");
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

  useEffect(() => () => {
    realtimeRef.current?.disconnect();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
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
    realtimeRef.current?.disconnect();
    realtimeRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (outputVideoRef.current) outputVideoRef.current.srcObject = null;
    setSessionState("idle");
    setSessionSeconds(0);
    setObsUrl(null);
    setReferenceApplied(false);
  }, []);

  const startSession = useCallback(async () => {
    if (busy || sessionState === "connected" || sessionState === "connecting") return;
    setBusy(true);
    setError(null);
    setSessionState("connecting");
    setObsUrl(null);
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
      localStreamRef.current = media;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = media;
        void localVideoRef.current.play().catch(() => undefined);
      }
      await refreshCameras();

      const tokenResponse = await fetch("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName }),
        cache: "no-store",
      });
      const tokenPayload = await tokenResponse.json() as { clientToken?: string; error?: string };
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
      realtimeRef.current = realtime;
      setSessionState(realtime.getConnectionState() as SessionState);
      setSessionSeconds(0);
      setReferenceApplied(Boolean(reference));

      const syncViewerLink = () => {
        if (realtime.subscribeToken) setObsUrl(buildViewerUrl(realtime.subscribeToken, modelName));
      };
      syncViewerLink();
      realtime.on("connectionChange", (state) => {
        setSessionState(state as SessionState);
        syncViewerLink();
      });
      realtime.on("generationTick", ({ seconds }) => setSessionSeconds(seconds));
      realtime.on("error", (sdkError) => {
        setError(sdkError.message || "The Decart session reported an error.");
      });
    } catch (caught) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setSessionState("error");
      setError(caught instanceof Error ? caught.message : "Unable to start the live session.");
    } finally {
      setBusy(false);
    }
  }, [attachOutput, busy, cameraId, mode, microphoneOn, refreshCameras, reference, sessionState]);

  const applyReference = async () => {
    if (!reference) return;
    setError(null);
    try {
      if (realtimeRef.current) await realtimeRef.current.setImage(reference);
      setReferenceApplied(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reference image could not be applied.");
    }
  };

  const clearReference = async () => {
    setError(null);
    try {
      if (realtimeRef.current) await realtimeRef.current.setImage(null);
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
      setReference(null);
      setReferenceUrl(null);
      setReferenceApplied(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The live reference could not be cleared.");
    }
  };

  const onDrop = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    setReference(file);
    setReferenceUrl(URL.createObjectURL(file));
    setReferenceApplied(false);
    setError(null);
    if (realtimeRef.current) {
      try {
        await realtimeRef.current.setImage(file);
        setReferenceApplied(true);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The replacement image could not be applied.");
      }
    }
  };

  const connected = sessionState === "connected" || sessionState === "generating" || sessionState === "reconnecting";
  const currentMode = REALTIME_MODES.find((item) => item.id === mode) ?? REALTIME_MODES[0];
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
            <Text className="brand-subtitle">Decart live studio</Text>
          </Box>
        </Group>
        <Group gap="md" className="header-meta">
          <Text size="xs" c="dimmed" className="desktop-only">Your camera stays in your control</Text>
          <Badge color={connected ? "teal" : sessionState === "error" ? "red" : "gray"} variant="light" leftSection={<span className={`status-led ${connected ? "is-live" : ""}`} />}>
            {connected ? "Live" : sessionState === "connecting" ? "Connecting" : sessionState === "error" ? "Needs attention" : "Ready"}
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="xl" className="studio-main">
          <Group className="page-heading" align="flex-end">
            <Box>
              <Title order={1}>Live studio</Title>
              <Text>Choose a reference image, connect your camera, and send the transformed feed to OBS.</Text>
            </Box>
            <Badge variant="outline" color="gray" leftSection={<IconAperture size={13} />}>Decart-hosted inference</Badge>
          </Group>

          {error && (
            <Alert mb="md" color="red" variant="light" title="Something needs attention" icon={<IconX size={16} />}>
              {error}
            </Alert>
          )}

          <div className="studio-layout">
            <div className="studio-main-column">
              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" mb="sm" wrap="wrap">
                  <Group gap="xs">
                    <Text className="panel-title">Live preview</Text>
                    <Text className="panel-kicker">Your input and transformed output</Text>
                  </Group>
                  <Text className="mono-meta">{connected ? `SESSION ${formatDuration(sessionSeconds)}` : "CAMERA NOT CONNECTED"}</Text>
                </Group>
                <div className="video-pair">
                  <div className="video-frame">
                    <div className="video-label"><IconCamera size={12} /> Camera input</div>
                    <video ref={localVideoRef} muted autoPlay playsInline />
                    {!connected && <VideoPlaceholder icon={<IconCamera size={24} />} title="Camera preview" detail="Select a camera, then start the live transformation." />}
                  </div>
                  <div className="video-frame">
                    <div className="video-label"><span className={`status-led ${connected ? "is-live" : ""}`} /> Transformed output</div>
                    <video ref={outputVideoRef} autoPlay playsInline />
                    {!connected && <VideoPlaceholder icon={<IconAperture size={24} />} title="Output will appear here" detail="The Decart stream appears after the connection is ready." />}
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
                      <Button leftSection={busy ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />} onClick={() => void startSession()} loading={busy} color="teal" size="sm">
                        Start live
                      </Button>
                    ) : (
                      <Button leftSection={<IconPlayerStop size={16} />} onClick={stopSession} color="red" variant="light" size="sm">
                        End session
                      </Button>
                    )}
                  </Group>
                </Group>
              </Paper>

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
                <Text className="panel-kicker" mt="xs">Choose the mode before connecting. No text prompt is needed in this studio.</Text>
              </Paper>
            </div>

            <div className="studio-side-column">
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
                    accept={IMAGE_MIME_TYPE}
                    maxSize={10 * 1024 * 1024}
                    maxFiles={1}
                    multiple={false}
                    className="panel"
                    style={{ borderStyle: "dashed", boxShadow: "none", background: "rgba(7, 12, 12, .38)" }}
                  >
                    <div className="reference-empty">
                      <IconUpload size={23} color="var(--lb-accent)" />
                      <Text size="sm" fw={600}>Drop an image or browse</Text>
                      <Text size="xs" c="dimmed">PNG, JPEG, WebP and other common formats · up to 10 MB</Text>
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
                        accept={IMAGE_MIME_TYPE}
                        maxSize={10 * 1024 * 1024}
                        maxFiles={1}
                        multiple={false}
                        activateOnClick
                        style={{ border: 0, padding: 0, background: "transparent" }}
                      >
                        <Button component="span" size="xs" variant="default" leftSection={<IconRefresh size={14} />}>Replace</Button>
                      </Dropzone>
                      <Button size="xs" variant="light" color="teal" onClick={() => void applyReference()} disabled={referenceApplied}>
                        {connected ? "Apply to live" : "Use next session"}
                      </Button>
                      <Tooltip label="Clear selected image">
                        <ActionIcon aria-label="Clear reference image" size="sm" variant="subtle" color="red" onClick={() => void clearReference()}>
                          <IconX size={15} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Stack>
                )}
                <Text className="panel-kicker" mt="sm">The image is sent to Decart only when the live session starts or you apply it.</Text>
              </Paper>

              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" mb="xs">
                  <Box>
                    <Text className="panel-title">OBS output</Text>
                    <Text className="panel-kicker" mt={4}>Clean viewer page for a Browser Source</Text>
                  </Box>
                  <IconExternalLink size={18} color="var(--lb-accent)" />
                </Group>
                {obsUrl ? (
                  <Stack gap="xs">
                    <Text className="obs-url">{obsUrl}</Text>
                    <Group grow gap="xs">
                      <CopyButton value={obsUrl} timeout={1800}>
                        {({ copied, copy }) => (
                          <Button onClick={copy} size="xs" variant={copied ? "light" : "filled"} color={copied ? "teal" : "teal"} leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}>
                            {copied ? "Copied" : "Copy OBS link"}
                          </Button>
                        )}
                      </CopyButton>
                      <Button component="a" href={obsUrl} target="_blank" rel="noreferrer" size="xs" variant="default" rightSection={<IconExternalLink size={14} />}>
                        Open
                      </Button>
                    </Group>
                    <Text className="panel-kicker">In OBS: add a Browser Source and paste the copied URL. This is not an RTMP/SRT endpoint.</Text>
                  </Stack>
                ) : (
                  <Alert color="gray" variant="light" icon={<IconAperture size={16} />}>
                    <Text size="xs">Start a live session to create its private viewer link. It works only while this session is active.</Text>
                  </Alert>
                )}
              </Paper>

              <Paper className="panel" radius="lg" p="md">
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <span className={`status-led ${connected ? "is-live" : ""}`} />
                    <Box>
                      <Text className="panel-title">Session status</Text>
                      <Text className="panel-kicker" mt={3}>{connected ? `Connected · ${formatDuration(sessionSeconds)}` : sessionState === "connecting" ? "Requesting camera and connecting…" : sessionState === "error" ? "Connection needs attention" : "Not connected"}</Text>
                    </Box>
                  </Group>
                  <Text className="mono-meta">{connected ? "LIVE" : "READY"}</Text>
                </Group>
              </Paper>
            </div>
          </div>
          <Text className="footer-note">Live video is processed by Decart. This app hosts the controls; it does not run Decart models locally. Keep a publicly reachable deployment behind owner access control to protect billable token creation.</Text>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getObsViewKey } from "@/lib/config";
import { type RealtimeModelName } from "@/lib/decart";

type ObsLiveSession = {
  sessionId: string;
  subscribeToken: string;
  model: RealtimeModelName;
};

export type ObsIceCandidate = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

type ObsFalRelay = {
  sessionId: string;
  offerSdp: string;
  offerCandidates: ObsIceCandidate[];
  offerUpdatedAt: number;
  answerSdp: string | null;
  answerCandidates: ObsIceCandidate[];
};

type ObsStore = {
  liveSession: ObsLiveSession | null;
  retiredSessionIds: string[];
  falRelay: ObsFalRelay | null;
};

const FAL_OFFER_TTL_MS = 15_000;
const MAX_SIGNAL_BYTES = 256_000;

const globalStore = globalThis as typeof globalThis & { __livebridgeObs?: ObsStore };

function obsStore(): ObsStore {
  if (!globalStore.__livebridgeObs) {
    globalStore.__livebridgeObs = { liveSession: null, retiredSessionIds: [], falRelay: null };
  }
  return globalStore.__livebridgeObs;
}

function secretsEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function publishObsSession(
  session: { sessionId: string; subscribeToken: null } | { sessionId: string; subscribeToken: string; model: RealtimeModelName },
) {
  const store = obsStore();
  if (session.subscribeToken === null) {
    if (store.liveSession?.sessionId === session.sessionId) store.liveSession = null;
    if (!store.retiredSessionIds.includes(session.sessionId)) store.retiredSessionIds.unshift(session.sessionId);
    if (store.retiredSessionIds.length > 20) store.retiredSessionIds.length = 20;
    return;
  }
  if (store.retiredSessionIds.includes(session.sessionId)) return;
  store.liveSession = {
    sessionId: session.sessionId,
    subscribeToken: session.subscribeToken,
    model: session.model,
  };
}

export function isValidViewKey(viewKey: string) {
  const expected = getObsViewKey();
  return typeof expected === "string" && expected.length > 0 && secretsEqual(expected, viewKey);
}

export function readObsViewer(viewKey: string) {
  if (!isValidViewKey(viewKey)) return { live: false as const };
  const store = obsStore();
  if (store.liveSession) {
    return { live: true as const, provider: "decart" as const, subscribeToken: store.liveSession.subscribeToken, model: store.liveSession.model };
  }
  const relay = store.falRelay;
  if (relay && Date.now() - relay.offerUpdatedAt <= FAL_OFFER_TTL_MS) {
    return {
      live: true as const,
      provider: "fal" as const,
      sessionId: relay.sessionId,
      offer: { sdp: relay.offerSdp, candidates: relay.offerCandidates },
    };
  }
  return { live: false as const };
}

export function isFalSignalSizeOk(sdp: unknown, candidates: unknown) {
  return typeof sdp === "string" && sdp.length > 0 && sdp.length <= MAX_SIGNAL_BYTES && Array.isArray(candidates) && candidates.length <= 128;
}

export function publishFalOffer(sessionId: string, sdp: string, candidates: ObsIceCandidate[]) {
  const store = obsStore();
  const previous = store.falRelay;
  const sameOffer = previous?.sessionId === sessionId && previous.offerSdp === sdp;
  store.falRelay = {
    sessionId,
    offerSdp: sdp,
    offerCandidates: candidates,
    offerUpdatedAt: Date.now(),
    answerSdp: sameOffer ? previous.answerSdp : null,
    answerCandidates: sameOffer ? previous.answerCandidates : [],
  };
}

export function publishFalAnswer(sessionId: string, sdp: string, candidates: ObsIceCandidate[]) {
  const relay = obsStore().falRelay;
  if (!relay || relay.sessionId !== sessionId) return;
  relay.answerSdp = sdp;
  relay.answerCandidates = candidates;
}

export function readFalAnswer(sessionId: string) {
  const relay = obsStore().falRelay;
  if (!relay || relay.sessionId !== sessionId || !relay.answerSdp) return null;
  return { sdp: relay.answerSdp, candidates: relay.answerCandidates };
}

export function clearFalRelay(sessionId: string) {
  const store = obsStore();
  if (store.falRelay?.sessionId === sessionId) store.falRelay = null;
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { type RealtimeModelName } from "@/lib/decart";

type ObsLiveSession = {
  sessionId: string;
  subscribeToken: string;
  model: RealtimeModelName;
};

type ObsStore = {
  liveSession: ObsLiveSession | null;
  retiredSessionIds: string[];
};

const globalStore = globalThis as typeof globalThis & { __livebridgeObs?: ObsStore };

function obsStore(): ObsStore {
  if (!globalStore.__livebridgeObs) {
    globalStore.__livebridgeObs = { liveSession: null, retiredSessionIds: [] };
  }
  return globalStore.__livebridgeObs;
}

function secretsEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function getObsViewKey() {
  const viewKey = process.env.OBS_KEY?.trim() ?? "";
  return viewKey.length > 0 ? viewKey : null;
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

export function readObsViewer(viewKey: string) {
  const expected = getObsViewKey();
  const liveSession = obsStore().liveSession;
  if (!expected || !secretsEqual(expected, viewKey) || !liveSession) return { live: false as const };
  return { live: true as const, subscribeToken: liveSession.subscribeToken, model: liveSession.model };
}

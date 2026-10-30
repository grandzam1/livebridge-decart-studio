import "server-only";

import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

export const SESSION_EVENT_TYPES = ["start", "stop", "error", "reference"] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];
export const SESSION_PROVIDERS = ["decart", "fal"] as const;
export type SessionProvider = (typeof SESSION_PROVIDERS)[number];

export type SessionEvent = {
  id: string;
  at: string;
  type: SessionEventType;
  provider: SessionProvider;
  mode: string;
  detail?: string;
  reference?: string;
  seconds?: number;
};

const LOG_DIR = path.join(process.cwd(), "data");
const LOG_FILE = path.join(LOG_DIR, "sessions.jsonl");
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.at === "string" &&
    (SESSION_EVENT_TYPES as readonly unknown[]).includes(event.type) &&
    (SESSION_PROVIDERS as readonly unknown[]).includes(event.provider) &&
    typeof event.mode === "string"
  );
}

export async function appendSessionEvent(event: Omit<SessionEvent, "id" | "at">) {
  const record: SessionEvent = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...event,
  };
  const line = `${JSON.stringify(record)}\n`;
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(LOG_FILE, line, "utf8");

  // Keep the log bounded: once it crosses ~5 MB, keep the newest half.
  const info = await stat(LOG_FILE).catch(() => null);
  if (info && info.size > MAX_FILE_BYTES) {
    const text = await readFile(LOG_FILE, "utf8").catch(() => "");
    const lines = text.split("\n").filter(Boolean);
    const kept = lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n";
    const temp = `${LOG_FILE}.tmp`;
    await appendFile(temp, kept, "utf8");
    await rename(temp, LOG_FILE).catch(() => undefined);
  }
}

export async function readSessionEvents(limit = 50): Promise<SessionEvent[]> {
  const text = await readFile(LOG_FILE, "utf8").catch(() => "");
  const events: SessionEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isSessionEvent(parsed)) events.push(parsed);
    } catch {
      // Skip malformed lines.
    }
  }
  return events.reverse().slice(0, limit);
}

import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunEntry {
  userId: string;
  conversationId: string;
  message: string;
  createdAt: number;
}

interface PendingConfirmationEntry {
  name: string;
  params: Record<string, unknown>;
  userId: string;
  requireTyping?: string;
  createdAt: number;
}

export interface PendingConfirmation {
  name: string;
  params: Record<string, unknown>;
  userId: string;
  requireTyping?: string;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

/** TTL for stream run entries — short, only needed until the SSE client connects. */
const RUN_TTL_MS = 60_000;

/** TTL for pending confirmation entries — longer to allow human deliberation. */
const CONFIRM_TTL_MS = 300_000;

const runs = new Map<string, RunEntry>();
const pendingConfirmations = new Map<string, PendingConfirmationEntry>();

// ─── TTL cleanup ──────────────────────────────────────────────────────────────

function cleanup(): void {
  const now = Date.now();
  for (const [key, entry] of runs) {
    if (now - entry.createdAt > RUN_TTL_MS) runs.delete(key);
  }
  for (const [key, entry] of pendingConfirmations) {
    if (now - entry.createdAt > CONFIRM_TTL_MS) pendingConfirmations.delete(key);
  }
}

// Periodic cleanup — unref so it doesn't keep the Node process alive
const cleanupInterval = setInterval(cleanup, 30_000);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (typeof cleanupInterval.unref === "function") cleanupInterval.unref();

// ─── Run management ───────────────────────────────────────────────────────────

/**
 * Register a pending stream run.  Returns a unique streamId (UUID).
 * Entries expire after ~60 seconds.
 *
 * NOTE: In-memory only — does not survive process restart and is not shared
 * across multiple server instances.  Acceptable for single-process deployments.
 */
export function createRun(data: {
  userId: string;
  conversationId: string;
  message: string;
}): string {
  cleanup();
  const streamId = randomUUID();
  runs.set(streamId, { ...data, createdAt: Date.now() });
  return streamId;
}

/**
 * Retrieve and consume (delete) a run by streamId.
 * Returns undefined if not found or expired.
 */
export function takeRun(streamId: string): Omit<RunEntry, "createdAt"> | undefined {
  const entry = runs.get(streamId);
  if (!entry) return undefined;
  // Enforce TTL on read — regardless of when the periodic cleanup last ran
  if (Date.now() - entry.createdAt > RUN_TTL_MS) {
    runs.delete(streamId);
    return undefined;
  }
  runs.delete(streamId);
  return { userId: entry.userId, conversationId: entry.conversationId, message: entry.message };
}

// ─── Pending confirmation management ─────────────────────────────────────────

/**
 * Store a pending tool confirmation, keyed by `${conversationId}:${toolCallId}`.
 */
export function storePendingConfirmation(
  conversationId: string,
  toolCallId: string,
  data: PendingConfirmation
): void {
  cleanup();
  const key = `${conversationId}:${toolCallId}`;
  pendingConfirmations.set(key, { ...data, createdAt: Date.now() });
}

/**
 * Retrieve and consume a pending confirmation.
 * Returns undefined if not found or expired.
 */
export function takePendingConfirmation(
  conversationId: string,
  toolCallId: string
): PendingConfirmation | undefined {
  const key = `${conversationId}:${toolCallId}`;
  const entry = pendingConfirmations.get(key);
  if (!entry) return undefined;
  // Enforce TTL on read — regardless of when the periodic cleanup last ran
  if (Date.now() - entry.createdAt > CONFIRM_TTL_MS) {
    pendingConfirmations.delete(key);
    return undefined;
  }
  pendingConfirmations.delete(key);
  return {
    name: entry.name,
    params: entry.params,
    userId: entry.userId,
    requireTyping: entry.requireTyping,
  };
}

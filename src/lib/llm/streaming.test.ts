import { test } from "node:test";
import assert from "node:assert/strict";
import type { LLMEvent } from "../../types/llm";
import { encodeSSE, sseStream } from "./streaming";

// ─── encodeSSE: exact wire format ────────────────────────────────────────────

test("encodeSSE: produces correct SSE wire format", () => {
  const result = encodeSSE("token", { type: "token", content: "hi" });
  assert.equal(
    result,
    'event: token\ndata: {"type":"token","content":"hi"}\n\n',
    "SSE wire format must match exactly"
  );
});

test("encodeSSE: works with done event", () => {
  const result = encodeSSE("done", { type: "done" });
  assert.equal(result, 'event: done\ndata: {"type":"done"}\n\n');
});

// ─── sseStream: collect chunks from a 2-event generator ──────────────────────

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

test("sseStream: encodes 2-event generator into SSE chunks", async () => {
  async function* gen(): AsyncGenerator<LLMEvent> {
    yield { type: "token", content: "Hello" };
    yield { type: "done" };
  }

  const stream = sseStream(gen());
  const chunks = await collectStream(stream);

  assert.equal(chunks.length, 2, "should produce 2 chunks");
  assert.equal(
    chunks[0],
    'event: token\ndata: {"type":"token","content":"Hello"}\n\n',
    "first chunk is token SSE"
  );
  assert.equal(
    chunks[1],
    'event: done\ndata: {"type":"done"}\n\n',
    "second chunk is done SSE"
  );
});

test("sseStream: emits error SSE on generator throw", async () => {
  async function* gen(): AsyncGenerator<LLMEvent> {
    yield { type: "token", content: "ok" };
    throw new Error("upstream failure");
  }

  const stream = sseStream(gen());
  const chunks = await collectStream(stream);

  // First chunk is the token, second is the error SSE
  assert.equal(chunks.length, 2, "should produce 2 chunks (token + error)");
  assert.ok(
    chunks[1]?.startsWith("event: error\n"),
    "second chunk must be an error SSE event"
  );
  assert.ok(
    chunks[1]?.includes("upstream failure"),
    "error SSE must contain the error message"
  );
});

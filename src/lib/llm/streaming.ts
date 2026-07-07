import type { LLMEvent } from "../../types/llm.js";

// ─── SSE helpers for the chat orchestrator (Task 11) ─────────────────────────

/**
 * Returns the HTTP headers required for a Server-Sent Events response.
 */
export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
  };
}

/**
 * Encodes an event + data payload into the SSE wire format:
 *   event: <event>\ndata: <JSON>\n\n
 */
export function encodeSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Wraps an AsyncGenerator<LLMEvent> into a web ReadableStream<Uint8Array>.
 *
 * Each event is encoded via encodeSSE using the event's `type` as the SSE
 * event name (supporting: token, tool_call, tool_result, confirm_required,
 * done, error). An optional `mapEvent` function can override the name/data.
 *
 * On generator error, emits a final `error` SSE event then closes the stream.
 */
export function sseStream(
  generator: AsyncGenerator<LLMEvent>,
  mapEvent?: (event: LLMEvent) => { name: string; data: unknown }
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of generator) {
          const { name, data } = mapEvent
            ? mapEvent(event)
            : { name: event.type, data: event };
          controller.enqueue(encoder.encode(encodeSSE(name, data)));
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(encodeSSE("error", { message })));
        controller.close();
      }
    },
  });
}

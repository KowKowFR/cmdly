import { test } from "node:test";
import assert from "node:assert/strict";
import type { LLMEvent, LLMMessage, LLMTool } from "../../types/llm";
import type { AnthropicClientLike } from "./anthropic";
import { AnthropicProvider } from "./anthropic";

// ─── Fake streaming event types ───────────────────────────────────────────────

type AntRawEvent =
  | { type: "message_start"; message: Record<string, unknown> }
  | { type: "content_block_start"; index: number; content_block: { type: "text" } | { type: "tool_use"; id: string; name: string } }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: Record<string, unknown> }
  | { type: "message_stop" };

// ─── Fake client helper ───────────────────────────────────────────────────────

function makeFakeClient(events: AntRawEvent[]): AnthropicClientLike {
  return {
    messages: {
      stream: () => {
        async function* gen() {
          for (const event of events) yield event;
        }
        return gen();
      },
    },
  };
}

const noTools: LLMTool[] = [];
const msgs: LLMMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Bonjour" },
];

// ─── Test 1: text delta → token events + done ─────────────────────────────────

test("chatStream: text_delta events yield token events then done", async () => {
  const events: AntRawEvent[] = [
    { type: "message_start", message: { id: "msg_1" } },
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bon" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "jour" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];

  const provider = new AnthropicProvider("fake-key", undefined, makeFakeClient(events));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "claude-opus-4-8", messages: msgs, tools: noTools })) {
    collected.push(ev);
  }

  // Expect: token("Bon"), token("jour"), done
  assert.equal(collected.length, 3, "should yield exactly 3 events");

  const [ev0, ev1, ev2] = collected;
  assert.ok(ev0 !== undefined && ev0.type === "token", "first event is token");
  assert.ok(ev0.type === "token" && ev0.content === "Bon", "first token content is 'Bon'");

  assert.ok(ev1 !== undefined && ev1.type === "token", "second event is token");
  assert.ok(ev1.type === "token" && ev1.content === "jour", "second token content is 'jour'");

  assert.ok(ev2 !== undefined && ev2.type === "done", "last event is done");
});

// ─── Test 2: tool_use block accumulation → tool_call event + done ─────────────

test("chatStream: tool_use block with input_json_delta fragments yields tool_call then done", async () => {
  // Tool call: list_vms with {a:1}, streamed as fragmented JSON
  const events: AntRawEvent[] = [
    { type: "message_start", message: { id: "msg_2" } },
    // Text content before tool call
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bonjour" } },
    { type: "content_block_stop", index: 0 },
    // Tool use block at index 1
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "list_vms" } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"a":' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "1}" } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
    { type: "message_stop" },
  ];

  const provider = new AnthropicProvider("fake-key", undefined, makeFakeClient(events));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "claude-opus-4-8", messages: msgs, tools: noTools })) {
    collected.push(ev);
  }

  // Expect: token("Bonjour"), tool_call(id="toolu_1", name="list_vms", args={a:1}), done
  assert.equal(collected.length, 3, "should yield exactly 3 events");

  const [ev0, ev1, ev2] = collected;

  assert.ok(ev0 !== undefined && ev0.type === "token", "first event is token");
  assert.ok(ev0.type === "token" && ev0.content === "Bonjour", "token content is 'Bonjour'");

  assert.ok(ev1 !== undefined && ev1.type === "tool_call", "second event is tool_call");
  assert.ok(ev1.type === "tool_call" && ev1.call.id === "toolu_1", "tool_call id is 'toolu_1'");
  assert.ok(ev1.type === "tool_call" && ev1.call.name === "list_vms", "tool_call name is 'list_vms'");
  assert.deepEqual(
    ev1.type === "tool_call" ? ev1.call.arguments : null,
    { a: 1 },
    "tool_call arguments parsed correctly"
  );

  assert.ok(ev2 !== undefined && ev2.type === "done", "last event is done");
});

// ─── Test 3: pure text → only tokens + done, no tool_call ────────────────────

test("chatStream: pure text stream yields tokens then done with no tool_call", async () => {
  const events: AntRawEvent[] = [
    { type: "message_start", message: {} },
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_stop" },
  ];

  const pureTextMsgs: LLMMessage[] = [{ role: "user", content: "hi" }];
  const provider = new AnthropicProvider("fake-key", undefined, makeFakeClient(events));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "claude-opus-4-8", messages: pureTextMsgs, tools: noTools })) {
    collected.push(ev);
  }

  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["token", "token", "done"], "should yield two tokens then done");

  const toolCallEvents = collected.filter((e) => e.type === "tool_call");
  assert.equal(toolCallEvents.length, 0, "no tool_call events for pure text");
});

// ─── Test 4: malformed JSON in tool_use → error event, no tool_call ───────────

test("chatStream: malformed tool_use JSON yields error event and no tool_call", async () => {
  const events: AntRawEvent[] = [
    { type: "message_start", message: {} },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_bad", name: "broken_tool" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{not: valid json" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_stop" },
  ];

  const provider = new AnthropicProvider("fake-key", undefined, makeFakeClient(events));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "claude-opus-4-8", messages: msgs, tools: noTools })) {
    collected.push(ev);
  }

  assert.equal(collected.length, 2, "should yield exactly 2 events: error, done");

  const [ev0, ev1] = collected;
  assert.ok(ev0 !== undefined && ev0.type === "error", "first event is error");
  assert.ok(
    ev0.type === "error" && ev0.message.includes("broken_tool"),
    "error message references the tool name"
  );

  const toolCallEvents = collected.filter((e) => e.type === "tool_call");
  assert.equal(toolCallEvents.length, 0, "no tool_call events when args are malformed");

  assert.ok(ev1 !== undefined && ev1.type === "done", "last event is done");
});

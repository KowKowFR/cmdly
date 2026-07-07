import { test } from "node:test";
import assert from "node:assert/strict";
import type { LLMEvent, LLMMessage, LLMTool } from "../../types/llm";
import type { OllamaClientLike } from "./ollama";
import { OllamaProvider } from "./ollama";

// ─── Fake client helper ───────────────────────────────────────────────────────

interface OllamaChunk {
  message: {
    role: string;
    content: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done: boolean;
}

function makeFakeClient(chunks: OllamaChunk[]): OllamaClientLike {
  return {
    chat: async () => {
      async function* gen() {
        for (const chunk of chunks) yield chunk;
      }
      return gen();
    },
  };
}

const noTools: LLMTool[] = [];
const msgs: LLMMessage[] = [{ role: "user", content: "hi" }];

// ─── Test 1: text stream → tokens + done ─────────────────────────────────────

test("chatStream: text chunks yield token events then done", async () => {
  const chunks: OllamaChunk[] = [
    { message: { role: "assistant", content: "Bon" }, done: false },
    { message: { role: "assistant", content: "jour" }, done: false },
    { message: { role: "assistant", content: "" }, done: true },
  ];

  const provider = new OllamaProvider("http://localhost:11434", makeFakeClient(chunks));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "llama3", messages: msgs, tools: noTools })) {
    collected.push(ev);
  }

  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["token", "token", "done"], "should yield two tokens then done");

  const [ev0, ev1] = collected;
  assert.ok(ev0 !== undefined && ev0.type === "token" && ev0.content === "Bon", "first token is 'Bon'");
  assert.ok(ev1 !== undefined && ev1.type === "token" && ev1.content === "jour", "second token is 'jour'");
});

// ─── Test 2: tool call → token + tool_call + done ────────────────────────────

test("chatStream: tool_calls in chunk yields tool_call event then done", async () => {
  const chunks: OllamaChunk[] = [
    { message: { role: "assistant", content: "Bonjour" }, done: false },
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "list_vms", arguments: { a: 1 } } }],
      },
      done: true,
    },
  ];

  const provider = new OllamaProvider("http://localhost:11434", makeFakeClient(chunks));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "llama3", messages: msgs, tools: noTools })) {
    collected.push(ev);
  }

  // Expect: token("Bonjour"), tool_call(list_vms, {a:1}), done
  assert.equal(collected.length, 3, "should yield exactly 3 events");

  const [ev0, ev1, ev2] = collected;

  assert.ok(ev0 !== undefined && ev0.type === "token", "first event is token");
  assert.ok(ev0.type === "token" && ev0.content === "Bonjour", "token content is 'Bonjour'");

  assert.ok(ev1 !== undefined && ev1.type === "tool_call", "second event is tool_call");
  assert.ok(ev1.type === "tool_call" && ev1.call.name === "list_vms", "tool_call name is 'list_vms'");
  assert.ok(ev1.type === "tool_call" && typeof ev1.call.id === "string" && ev1.call.id.length > 0, "tool_call has a generated id");
  assert.deepEqual(
    ev1.type === "tool_call" ? ev1.call.arguments : null,
    { a: 1 },
    "tool_call arguments are correct"
  );

  assert.ok(ev2 !== undefined && ev2.type === "done", "last event is done");
});

// ─── Test 3: pure text, no tool calls ────────────────────────────────────────

test("chatStream: pure text stream yields tokens then done with no tool_call", async () => {
  const chunks: OllamaChunk[] = [
    { message: { role: "assistant", content: "Hello" }, done: false },
    { message: { role: "assistant", content: " world" }, done: true },
  ];

  const provider = new OllamaProvider("http://localhost:11434", makeFakeClient(chunks));
  const collected: LLMEvent[] = [];
  for await (const ev of provider.chatStream({ model: "llama3", messages: msgs, tools: noTools })) {
    collected.push(ev);
  }

  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["token", "token", "done"], "should yield tokens then done");

  const toolCallEvents = collected.filter((e) => e.type === "tool_call");
  assert.equal(toolCallEvents.length, 0, "no tool_call events in pure text response");
});

// ─── Test 4: message/tool mapping (verifies conversion is not rejected) ───────

test("chatStream: messages with system, user, and tool result are mapped without error", async () => {
  const complexMsgs: LLMMessage[] = [
    { role: "system", content: "Be helpful." },
    { role: "user", content: "Run list_vms" },
    { role: "assistant", content: null, toolCalls: [{ id: "tc_1", name: "list_vms", arguments: {} }] },
    { role: "tool", toolCallId: "tc_1", content: "vm1, vm2" },
    { role: "user", content: "Thanks" },
  ];

  const chunks: OllamaChunk[] = [
    { message: { role: "assistant", content: "Done" }, done: true },
  ];

  const provider = new OllamaProvider("http://localhost:11434", makeFakeClient(chunks));
  const collected: LLMEvent[] = [];

  // Should not throw — only checking that message mapping doesn't error.
  for await (const ev of provider.chatStream({ model: "llama3", messages: complexMsgs, tools: noTools })) {
    collected.push(ev);
  }

  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["token", "done"], "should yield token then done");
  assert.ok(!types.includes("error"), "no error events when messages are well-formed");
});

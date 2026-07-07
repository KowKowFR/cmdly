import { test } from "node:test";
import assert from "node:assert/strict";
import type { LLMEvent, LLMMessage, LLMTool } from "../../types/llm.js";
import type { OpenAIClientLike, StreamChunk } from "./openai.js";
import { OpenAIProvider } from "./openai.js";

// ─── Fake client helpers ──────────────────────────────────────────────────────

function makeFakeClient(chunks: StreamChunk[]): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: async () => {
          async function* gen() {
            for (const chunk of chunks) yield chunk;
          }
          return gen();
        },
      },
    },
  };
}

const noTools: LLMTool[] = [];
const msgs: LLMMessage[] = [{ role: "user", content: "hi" }];

// ─── Test 1: text delta + tool_call fragments → token + tool_call + done ─────

test("chatStream: text delta then streamed tool_call yields token, tool_call, done", async () => {
  const chunks: StreamChunk[] = [
    // content delta
    {
      choices: [
        { delta: { content: "Hello" }, finish_reason: null },
      ],
    },
    // tool call: index 0, first fragment (id + name + partial args)
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "list_vms", arguments: '{"a":' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    // tool call: index 0, second fragment (rest of args)
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: "1}" } }],
          },
          finish_reason: null,
        },
      ],
    },
    // done
    {
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    },
  ];

  const provider = new OpenAIProvider("fake-key", makeFakeClient(chunks));
  const events: LLMEvent[] = [];
  for await (const event of provider.chatStream({ model: "gpt-4o", messages: msgs, tools: noTools })) {
    events.push(event);
  }

  assert.equal(events.length, 3, "should yield exactly 3 events");

  const [ev0, ev1, ev2] = events;
  assert.ok(ev0 !== undefined && ev0.type === "token", "first event is token");
  assert.ok(ev0.type === "token" && ev0.content === "Hello", "token content is Hello");

  assert.ok(ev1 !== undefined && ev1.type === "tool_call", "second event is tool_call");
  assert.ok(
    ev1.type === "tool_call" &&
      ev1.call.id === "call_1" &&
      ev1.call.name === "list_vms",
    "tool_call has correct id and name"
  );
  assert.ok(
    ev1.type === "tool_call" && typeof ev1.call.arguments === "object",
    "tool_call arguments is an object"
  );
  assert.deepEqual(
    ev1.type === "tool_call" ? ev1.call.arguments : null,
    { a: 1 },
    "tool_call arguments parsed correctly"
  );

  assert.ok(ev2 !== undefined && ev2.type === "done", "last event is done");
});

// ─── Test 2: pure-text stream → token(s) + done, no tool_call ────────────────


test("chatStream: pure text stream yields tokens then done", async () => {
  const chunks: StreamChunk[] = [
    { choices: [{ delta: { content: "Foo" }, finish_reason: null }] },
    { choices: [{ delta: { content: " bar" }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ];

  const provider = new OpenAIProvider("fake-key", makeFakeClient(chunks));
  const events: LLMEvent[] = [];
  for await (const event of provider.chatStream({ model: "gpt-4o", messages: msgs, tools: noTools })) {
    events.push(event);
  }

  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["token", "token", "done"], "should yield two tokens then done");

  const [t1, t2] = events;
  assert.ok(t1 !== undefined && t1.type === "token" && t1.content === "Foo", "first token");
  assert.ok(t2 !== undefined && t2.type === "token" && t2.content === " bar", "second token");

  const toolCallEvents = events.filter((e) => e.type === "tool_call");
  assert.equal(toolCallEvents.length, 0, "no tool_call events for pure text");
});

// ─── Test 3: two simultaneous tool calls at index 0 and 1 → two tool_call events in order ───

test("chatStream: two simultaneous tool calls yield two tool_call events in index order then done", async () => {
  const chunks: StreamChunk[] = [
    // First chunk: establish both tool calls with id and name
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_a", function: { name: "search", arguments: '{"q":' } },
              { index: 1, id: "call_b", function: { name: "fetch", arguments: '{"url":' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    // Second chunk: argument continuations for both
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '"hello"}' } },
              { index: 1, function: { arguments: '"https://x.com"}' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    // Done
    {
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    },
  ];

  const provider = new OpenAIProvider("fake-key", makeFakeClient(chunks));
  const events: LLMEvent[] = [];
  for await (const event of provider.chatStream({ model: "gpt-4o", messages: msgs, tools: noTools })) {
    events.push(event);
  }

  assert.equal(events.length, 3, "should yield exactly 3 events: tool_call(0), tool_call(1), done");

  const [ev0, ev1, ev2] = events;

  // First tool call (index 0)
  assert.ok(ev0 !== undefined && ev0.type === "tool_call", "first event is tool_call");
  assert.ok(ev0.type === "tool_call" && ev0.call.id === "call_a", "first tool_call id is call_a");
  assert.ok(ev0.type === "tool_call" && ev0.call.name === "search", "first tool_call name is search");
  assert.deepEqual(
    ev0.type === "tool_call" ? ev0.call.arguments : null,
    { q: "hello" },
    "first tool_call arguments parsed correctly"
  );

  // Second tool call (index 1)
  assert.ok(ev1 !== undefined && ev1.type === "tool_call", "second event is tool_call");
  assert.ok(ev1.type === "tool_call" && ev1.call.id === "call_b", "second tool_call id is call_b");
  assert.ok(ev1.type === "tool_call" && ev1.call.name === "fetch", "second tool_call name is fetch");
  assert.deepEqual(
    ev1.type === "tool_call" ? ev1.call.arguments : null,
    { url: "https://x.com" },
    "second tool_call arguments parsed correctly"
  );

  assert.ok(ev2 !== undefined && ev2.type === "done", "last event is done");
});

// ─── Test 4: malformed tool-call args → error event, no tool_call ─────────────

test("chatStream: malformed tool-call arguments yields error event and no tool_call", async () => {
  const chunks: StreamChunk[] = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_bad", function: { name: "broken_tool", arguments: "{not: valid json" } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    },
  ];

  const provider = new OpenAIProvider("fake-key", makeFakeClient(chunks));
  const events: LLMEvent[] = [];
  for await (const event of provider.chatStream({ model: "gpt-4o", messages: msgs, tools: noTools })) {
    events.push(event);
  }

  assert.equal(events.length, 2, "should yield exactly 2 events: error, done");

  const [ev0, ev1] = events;
  assert.ok(ev0 !== undefined && ev0.type === "error", "first event is error");
  assert.ok(
    ev0.type === "error" && ev0.message.includes("broken_tool"),
    "error message references the tool name"
  );

  const toolCallEvents = events.filter((e) => e.type === "tool_call");
  assert.equal(toolCallEvents.length, 0, "no tool_call events when args are malformed");

  assert.ok(ev1 !== undefined && ev1.type === "done", "last event is done");
});

// ─── env must be set before any DB-touching import ───────────────────────────
process.env.DATABASE_URL ||= "postgresql://cmdly:cmdly@localhost:5432/cmdly";
process.env.BETTER_AUTH_SECRET ||= "dev-secret-please-change-0000000000000000";

import { test } from "node:test";
import assert from "node:assert/strict";

import type { LLMProvider, LLMEvent, LLMMessage } from "@/types/llm";
import type { ExecutionContext } from "@/types/tools";
import type { InfrastructureConfig } from "@/lib/config";
import type { OrchestratorDeps } from "@/lib/chat/orchestrator";

// Dynamic import — env vars must be set before db/index.ts is imported
const { runConversation } = await import("@/lib/chat/orchestrator");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_CONFIG = {} as InfrastructureConfig;

const FAKE_CTX: ExecutionContext = {
  userId: "test-user",
  userRole: "admin",
  ipAddress: "127.0.0.1",
  config: FAKE_CONFIG,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type OrchestratorEvent = { event: string; data: unknown };

async function collectEvents(
  gen: AsyncGenerator<OrchestratorEvent>
): Promise<OrchestratorEvent[]> {
  const out: OrchestratorEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

type PersistMsg = Parameters<NonNullable<OrchestratorDeps["persistMessageFn"]>>[0];

// ─── Test 1: token → tool_call → success → follow-up round → done ─────────────

test(
  "orchestrator: token + tool_call(success) → multi-round → done",
  async () => {
    const toolCallId = "call-001";
    let providerCallCount = 0;

    // Round 1 events: token + tool call + done
    const round1: LLMEvent[] = [
      { type: "token", content: "Je vais lister les VMs." },
      { type: "tool_call", call: { id: toolCallId, name: "list_vms", arguments: {} } },
      { type: "done" },
    ];
    // Round 2 events: follow-up summary + done
    const round2: LLMEvent[] = [
      { type: "token", content: "Il y a 2 VMs." },
      { type: "done" },
    ];

    const fakeProvider: LLMProvider = {
      name: "openai",
      async *chatStream() {
        const events = providerCallCount === 0 ? round1 : round2;
        providerCallCount++;
        for (const e of events) yield e;
      },
    };

    const fakeExecuteTool: NonNullable<OrchestratorDeps["executeToolFn"]> = async () => ({
      status: "success",
      result: { success: true, humanReadable: "2 VMs trouvées", data: { vms: [] } },
    });

    const persistedRoles: string[] = [];
    const fakePersist = async (msg: PersistMsg): Promise<string> => {
      persistedRoles.push(msg.role);
      return `msg-${persistedRoles.length}`;
    };

    const fakeLoadHistory = async (): Promise<LLMMessage[]> => [
      { role: "user", content: "Liste les VMs" },
    ];

    const deps: OrchestratorDeps = {
      executeToolFn: fakeExecuteTool,
      persistMessageFn: fakePersist,
      loadHistoryFn: fakeLoadHistory,
    };

    const gen = runConversation(FAKE_CTX, "conv-001", fakeProvider, "gpt-4o", deps);
    const events = await collectEvents(gen);
    const names = events.map((e) => e.event);

    // Required events (in order): token, tool_call, tool_result, token(round2), done
    assert.ok(names.includes("token"), "should yield a token event");
    assert.ok(names.includes("tool_call"), "should yield a tool_call event");
    assert.ok(names.includes("tool_result"), "should yield a tool_result event");
    assert.ok(names.includes("done"), "should yield a done event");
    assert.equal(names.at(-1), "done", "done must be the last event");

    // tool_call status must be "pending"
    const tcEvent = events.find((e) => e.event === "tool_call");
    assert.equal(
      (tcEvent?.data as { status: string }).status,
      "pending",
      "tool_call event must have status=pending"
    );

    // tool_result status must be "success"
    const trEvent = events.find((e) => e.event === "tool_result");
    assert.equal(
      (trEvent?.data as { status: string }).status,
      "success",
      "tool_result event must have status=success"
    );

    // Provider was called twice — round 1 + follow-up round
    assert.equal(providerCallCount, 2, "provider.chatStream should be called twice");

    // Persisted: 1 tool-result message + 1 assistant(tool_calls) from round 1
    //            + 1 assistant(text only) from round 2
    assert.ok(persistedRoles.includes("tool"), "should persist tool message");
    assert.ok(persistedRoles.includes("assistant"), "should persist assistant message");
  }
);

// ─── Test 2: confirm_required → done (no tool_result) ─────────────────────────

test(
  "orchestrator: confirm_required → done without tool_result",
  async () => {
    const toolCallId = "call-destroy-001";
    let providerCallCount = 0;

    const fakeProvider: LLMProvider = {
      name: "openai",
      async *chatStream() {
        providerCallCount++;
        yield {
          type: "tool_call",
          call: { id: toolCallId, name: "destroy_vm", arguments: { vmid: 100 } },
        } satisfies LLMEvent;
        yield { type: "done" } satisfies LLMEvent;
      },
    };

    const fakeExecuteTool: NonNullable<OrchestratorDeps["executeToolFn"]> = async () => ({
      status: "confirm_required",
      confirm: {
        action: "destroy_vm",
        params: { vmid: 100 },
        requireTyping: "web-01",
      },
    });

    const fakePersist = async (_msg: PersistMsg): Promise<string> => "persisted";

    const fakeLoadHistory = async (): Promise<LLMMessage[]> => [
      { role: "user", content: "Détruis la VM 100" },
    ];

    const deps: OrchestratorDeps = {
      executeToolFn: fakeExecuteTool,
      persistMessageFn: fakePersist,
      loadHistoryFn: fakeLoadHistory,
    };

    const gen = runConversation(FAKE_CTX, "conv-002", fakeProvider, "gpt-4o", deps);
    const events = await collectEvents(gen);
    const names = events.map((e) => e.event);

    // Must yield: tool_call, confirm_required, done
    assert.ok(names.includes("tool_call"), "should yield tool_call");
    assert.ok(names.includes("confirm_required"), "should yield confirm_required");
    assert.ok(!names.includes("tool_result"), "must NOT yield tool_result for confirm_required");
    assert.equal(names.at(-1), "done", "done must be the last event");

    // confirm_required data must include toolCallId and requireTyping
    const crEvent = events.find((e) => e.event === "confirm_required");
    const crData = crEvent?.data as {
      toolCallId: string;
      action: string;
      requireTyping?: string;
    };
    assert.equal(crData.toolCallId, toolCallId, "confirm_required must have toolCallId");
    assert.equal(crData.requireTyping, "web-01", "confirm_required must have requireTyping");

    // Provider was called only once — loop stops after confirm_required
    assert.equal(providerCallCount, 1, "provider should only be called once");
  }
);

// ─── env must be set before any DB-touching import ───────────────────────────
process.env.DATABASE_URL ||=
  "postgresql://cmdly:cmdly@localhost:5432/cmdly";
process.env.BETTER_AUTH_SECRET ||=
  "dev-secret-please-change-0000000000000000";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports — env vars must be set first
const { db } = await import("@/lib/db");
const { users, auditLog, rateLimits } = await import("@/lib/db/schema");
const { eq, and, like } = await import("drizzle-orm");
const { z } = await import("zod");
const { TOOLS, CONFIRM_REQUIRED } = await import("@/lib/tools/registry");
const { executeTool } = await import("@/lib/tools/executor");

// ─── Minimal fake InfrastructureConfig ───────────────────────────────────────

import type { InfrastructureConfig } from "@/lib/config";
import type { ExecutionContext, Tool, ToolResult } from "@/types/tools";

const FAKE_CONFIG = {} as InfrastructureConfig;

function makeCtx(
  userId: string,
  role: ExecutionContext["userRole"] = "admin"
): ExecutionContext {
  return { userId, userRole: role, ipAddress: "127.0.0.1", config: FAKE_CONFIG };
}

// ─── Unique test user per run ─────────────────────────────────────────────────

const TEST_USER_ID = `exec-test-${process.pid}`;
const TEST_EMAIL = `exec-test-${process.pid}@test.local`;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

before(async () => {
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      name: "Executor Test User",
      emailVerified: false,
    })
    .onConflictDoNothing();
});

after(async () => {
  // auditLog cascade-deletes when user is deleted
  await db.delete(users).where(like(users.id, "exec-test-%"));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Register a fake tool for the duration of a test, restore after. */
async function withFakeTool<T>(
  tool: Tool,
  fn: () => Promise<T>
): Promise<T> {
  const prev = TOOLS[tool.name];
  TOOLS[tool.name] = tool;
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete TOOLS[tool.name];
    } else {
      TOOLS[tool.name] = prev;
    }
  }
}

/** Register a name in CONFIRM_REQUIRED for the duration of a test. */
async function withConfirmRequired<T>(name: string, fn: () => Promise<T>): Promise<T> {
  CONFIRM_REQUIRED.add(name);
  try {
    return await fn();
  } finally {
    CONFIRM_REQUIRED.delete(name);
  }
}

/** Query audit rows for a specific userId + toolName + action. */
async function getAuditRows(
  userId: string,
  toolName: string,
  action?: string
) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.userId, userId));

  return rows.filter(
    (r) =>
      r.toolName === toolName &&
      (action === undefined || r.action === action)
  );
}

// ─── Fake tools ───────────────────────────────────────────────────────────────

const READ_TOOL: Tool = {
  name: `fake_read_${process.pid}`,
  description: "Fake read tool",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({ q: z.string() }),
  execute: async (_p, _ctx) => ({
    success: true,
    data: "ok",
    humanReadable: "read ok",
  }),
};

const MODIFY_TOOL_FOR_VIEWER: Tool = {
  name: `fake_modify_${process.pid}`,
  description: "Fake modify tool (requires operator)",
  category: "modify",
  requiredRole: "operator",
  parameters: z.object({ id: z.string() }),
  execute: async (_p, _ctx) => ({
    success: true,
    humanReadable: "modified",
  }),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

test("unknown tool → error + tool_call_failed audit row", async () => {
  const ctx = makeCtx(TEST_USER_ID);
  const outcome = await executeTool(`nonexistent_${process.pid}`, {}, ctx);

  assert.equal(outcome.status, "error");
  if (outcome.status === "error") {
    assert.ok(outcome.reason.includes("unknown tool"));
  }

  // The attempted audit still fires even for unknown tools
  const rows = await getAuditRows(TEST_USER_ID, `nonexistent_${process.pid}`, "tool_call_attempted");
  assert.ok(rows.length >= 1, "tool_call_attempted row should exist");
});

test("viewer calling operator-required tool → denied + tool_call_denied audit", async () => {
  await withFakeTool(MODIFY_TOOL_FOR_VIEWER, async () => {
    const ctx = makeCtx(TEST_USER_ID, "viewer");
    const outcome = await executeTool(MODIFY_TOOL_FOR_VIEWER.name, { id: "x" }, ctx);

    assert.equal(outcome.status, "denied");

    const denied = await getAuditRows(TEST_USER_ID, MODIFY_TOOL_FOR_VIEWER.name, "tool_call_denied");
    assert.ok(denied.length >= 1, "tool_call_denied row should exist");
    assert.equal(denied[0]?.result, "denied");
  });
});

test("CONFIRM_REQUIRED tool without confirmed → confirm_required, execute NOT called", async () => {
  let executeCalled = false;
  const confirmTool: Tool = {
    name: `fake_confirm_${process.pid}`,
    description: "Fake confirm tool",
    category: "modify",
    requiredRole: "operator",
    parameters: z.object({ target: z.string() }),
    confirm: { requireTyping: (p) => (p as { target: string }).target },
    execute: async (_p, _ctx) => {
      executeCalled = true;
      return { success: true, humanReadable: "done" };
    },
  };

  await withFakeTool(confirmTool, async () => {
    await withConfirmRequired(confirmTool.name, async () => {
      const ctx = makeCtx(TEST_USER_ID, "operator");
      const outcome = await executeTool(confirmTool.name, { target: "svc-web" }, ctx);

      assert.equal(outcome.status, "confirm_required");
      if (outcome.status === "confirm_required") {
        assert.equal(outcome.confirm.action, confirmTool.name);
        assert.equal(outcome.confirm.requireTyping, "svc-web");
      }
      assert.equal(executeCalled, false, "execute should NOT have been called");
    });
  });
});

test("CONFIRM_REQUIRED tool with confirmed:true → success + execute called", async () => {
  let executeCalled = false;
  const confirmTool: Tool = {
    name: `fake_confirm2_${process.pid}`,
    description: "Fake confirm tool 2",
    category: "modify",
    requiredRole: "operator",
    parameters: z.object({ target: z.string() }),
    execute: async (_p, _ctx) => {
      executeCalled = true;
      return { success: true, humanReadable: "done" };
    },
  };

  await withFakeTool(confirmTool, async () => {
    await withConfirmRequired(confirmTool.name, async () => {
      const ctx = makeCtx(TEST_USER_ID, "operator");
      const outcome = await executeTool(
        confirmTool.name,
        { target: "svc-web" },
        ctx,
        { confirmed: true }
      );

      assert.equal(outcome.status, "success");
      assert.equal(executeCalled, true, "execute should have been called");

      const succeeded = await getAuditRows(TEST_USER_ID, confirmTool.name, "tool_call_succeeded");
      assert.ok(succeeded.length >= 1, "tool_call_succeeded row should exist");
    });
  });
});

test("happy path read tool → success + attempted + succeeded audit rows", async () => {
  await withFakeTool(READ_TOOL, async () => {
    const ctx = makeCtx(TEST_USER_ID, "viewer");
    const outcome = await executeTool(READ_TOOL.name, { q: "hello" }, ctx);

    assert.equal(outcome.status, "success");
    if (outcome.status === "success") {
      assert.equal(outcome.result.humanReadable, "read ok");
    }

    const attempted = await getAuditRows(TEST_USER_ID, READ_TOOL.name, "tool_call_attempted");
    assert.ok(attempted.length >= 1, "tool_call_attempted row should exist");

    const succeeded = await getAuditRows(TEST_USER_ID, READ_TOOL.name, "tool_call_succeeded");
    assert.ok(succeeded.length >= 1, "tool_call_succeeded row should exist");
  });
});

test("tool execute throws → error outcome + tool_call_failed audit, executeTool does NOT throw", async () => {
  const throwingTool: Tool = {
    name: `fake_throw_${process.pid}`,
    description: "Always throws",
    category: "read",
    requiredRole: "viewer",
    parameters: z.object({}),
    execute: async () => {
      throw new Error("boom from tool");
    },
  };

  await withFakeTool(throwingTool, async () => {
    const ctx = makeCtx(TEST_USER_ID);
    let outcome: Awaited<ReturnType<typeof executeTool>>;

    // Must not reject (async-safe replacement for doesNotThrow on an async fn)
    await assert.doesNotReject(async () => {
      outcome = await executeTool(throwingTool.name, {}, ctx);
    });

    assert.equal(outcome!.status, "error");
    if (outcome!.status === "error") {
      assert.ok(outcome!.reason.includes("boom from tool"));
    }

    const failed = await getAuditRows(TEST_USER_ID, throwingTool.name, "tool_call_failed");
    assert.ok(failed.length >= 1, "tool_call_failed row should exist");
    assert.equal(failed[0]?.result, "error");
  });
});

test("bad params (Zod fail) → error mentioning invalid field", async () => {
  await withFakeTool(READ_TOOL, async () => {
    const ctx = makeCtx(TEST_USER_ID);
    // READ_TOOL requires { q: string } but we pass a number
    const outcome = await executeTool(READ_TOOL.name, { q: 123 }, ctx);

    assert.equal(outcome.status, "error");
    if (outcome.status === "error") {
      // Zod message should mention the path 'q'
      assert.ok(
        outcome.reason.includes("q"),
        `Expected reason to mention field 'q', got: ${outcome.reason}`
      );
    }
  });
});

test("destroy category: 2nd call in same window → error with rate-limit reason + tool_call_failed audit", async () => {
  // Use a unique userId so this test is fully isolated from other tests.
  const rlUserId = `exec-rl-destroy-${process.pid}-${Date.now()}`;
  const rlUserEmail = `exec-rl-destroy-${process.pid}@test.local`;

  await db.insert(users).values({
    id: rlUserId,
    email: rlUserEmail,
    name: "Exec RL Destroy Test",
    emailVerified: false,
  }).onConflictDoNothing();

  const destroyRLTool: Tool = {
    name: `fake_destroy_rl_${process.pid}`,
    description: "Fake destroy tool (no confirm) for rate-limit test",
    category: "destroy",
    requiredRole: "admin",
    parameters: z.object({ id: z.string() }),
    execute: async (_p, _ctx) => ({ success: true, humanReadable: "destroyed" }),
  };

  try {
    await withFakeTool(destroyRLTool, async () => {
      const ctx = makeCtx(rlUserId, "admin");

      // 1st call: destroy limit = 1/min → must succeed
      const outcome1 = await executeTool(destroyRLTool.name, { id: "vm-1" }, ctx);
      assert.equal(outcome1.status, "success", "1st destroy call should succeed");

      // 2nd call: limit exhausted → must be rate-limited
      const outcome2 = await executeTool(destroyRLTool.name, { id: "vm-2" }, ctx);
      assert.equal(outcome2.status, "error", "2nd destroy call should return error");
      if (outcome2.status === "error") {
        assert.ok(
          outcome2.reason.includes("Limite de débit"),
          `Reason should mention rate limit in French, got: ${outcome2.reason}`
        );
      }

      // Audit: a tool_call_failed row must exist for the denied 2nd call
      const failed = await getAuditRows(rlUserId, destroyRLTool.name, "tool_call_failed");
      assert.ok(failed.length >= 1, "tool_call_failed audit row should exist for rate-limited call");
    });
  } finally {
    // Clean up: cascade via user delete (auditLog has FK on users.id)
    await db.delete(rateLimits).where(eq(rateLimits.userId, rlUserId));
    await db.delete(users).where(eq(users.id, rlUserId));
  }
});

test("destroy + CONFIRM_REQUIRED: unconfirmed consumes NO rate slot; confirmed retry succeeds", async () => {
  // This test verifies Fix 2: rate-limit runs AFTER the confirmation gate.
  // destroy limit is 1/min.  If the unconfirmed call burned the slot the
  // confirmed retry would be rate-limit-denied.
  let executeCalled = false;
  const destroyConfirmTool: Tool = {
    name: `fake_destroy_confirm_${process.pid}`,
    description: "Fake destroy tool that requires confirmation",
    category: "destroy",
    requiredRole: "admin",
    parameters: z.object({ id: z.string() }),
    execute: async (_p, _ctx) => {
      executeCalled = true;
      return { success: true, humanReadable: "destroyed" };
    },
  };

  await withFakeTool(destroyConfirmTool, async () => {
    await withConfirmRequired(destroyConfirmTool.name, async () => {
      const ctx = makeCtx(TEST_USER_ID, "admin");

      // Step 1 — unconfirmed: must return confirm_required without consuming a rate slot
      const outcome1 = await executeTool(
        destroyConfirmTool.name,
        { id: "vm-1" },
        ctx
      );
      assert.equal(
        outcome1.status,
        "confirm_required",
        "unconfirmed call should return confirm_required"
      );
      assert.equal(executeCalled, false, "execute must NOT be called on unconfirmed");

      // Step 2 — confirmed: must pass rate-limit and execute successfully.
      // destroy limit is 1/min; if step 1 burned it this would be "error".
      const outcome2 = await executeTool(
        destroyConfirmTool.name,
        { id: "vm-1" },
        ctx,
        { confirmed: true }
      );
      assert.equal(
        outcome2.status,
        "success",
        `confirmed retry should succeed — if rate-limited, the unconfirmed call illegally consumed the slot. got: ${outcome2.status}${outcome2.status === "error" ? ` (${(outcome2 as { reason: string }).reason})` : ""}`
      );
      assert.equal(executeCalled, true, "execute should be called on confirmed retry");

      // Cleanup: remove the destroy rate-limit row so subsequent test runs in
      // the same minute aren't blocked.  (User cascade handles audit rows.)
      await db
        .delete(rateLimits)
        .where(
          and(
            eq(rateLimits.userId, TEST_USER_ID),
            eq(rateLimits.action, "destroy")
          )
        );
    });
  });
});

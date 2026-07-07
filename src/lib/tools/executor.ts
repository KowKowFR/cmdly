import { canExecuteTool } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { TOOLS, CONFIRM_REQUIRED } from "./registry";
import type { ExecutionContext, ExecuteOutcome } from "@/types/tools";

/**
 * Execute a named tool through the full guardrail pipeline:
 *
 * 1. Audit tool_call_attempted
 * 2. Tool lookup
 * 3. RBAC
 * 4. Rate limit
 * 5. Zod param validation
 * 6. Confirmation gate (returns confirm_required without executing if needed)
 * 7. Execute (with error capture)
 * 8. Audit success / failure
 *
 * This function NEVER throws — all errors are returned as ExecuteOutcome.
 */
export async function executeTool(
  name: string,
  rawParams: unknown,
  ctx: ExecutionContext,
  opts?: { confirmed?: boolean }
): Promise<ExecuteOutcome> {
  // ── 1. Audit attempted ────────────────────────────────────────────────────
  await audit({
    userId: ctx.userId,
    action: "tool_call_attempted",
    toolName: name,
    params: rawParams,
    ipAddress: ctx.ipAddress,
  });

  // ── 2. Tool lookup ────────────────────────────────────────────────────────
  const tool = TOOLS[name];
  if (!tool) {
    await audit({
      userId: ctx.userId,
      action: "tool_call_failed",
      toolName: name,
      params: rawParams,
      errorMessage: "unknown tool",
      ipAddress: ctx.ipAddress,
    });
    return { status: "error", reason: "unknown tool" };
  }

  // ── 3. RBAC ───────────────────────────────────────────────────────────────
  if (!canExecuteTool(ctx.userRole as UserRole, tool.requiredRole as UserRole)) {
    await audit({
      userId: ctx.userId,
      action: "tool_call_denied",
      toolName: name,
      params: rawParams,
      errorMessage: `requires role '${tool.requiredRole}', caller is '${ctx.userRole}'`,
      ipAddress: ctx.ipAddress,
    });
    return {
      status: "denied",
      reason: `requires role '${tool.requiredRole}', you are '${ctx.userRole}'`,
    };
  }

  // ── 4. Rate limit ─────────────────────────────────────────────────────────
  const rateCheck = await checkRateLimit(ctx.userId, tool.category);
  if (!rateCheck.allowed) {
    await audit({
      userId: ctx.userId,
      action: "tool_call_failed",
      toolName: name,
      params: rawParams,
      errorMessage: `rate limit exceeded, retry after ${rateCheck.resetAt.toISOString()}`,
      ipAddress: ctx.ipAddress,
    });
    return {
      status: "error",
      reason: `rate limit exceeded, retry after ${rateCheck.resetAt.toISOString()}`,
    };
  }

  // ── 5. Zod validation ─────────────────────────────────────────────────────
  const parseResult = tool.parameters.safeParse(rawParams);
  if (!parseResult.success) {
    const message = parseResult.error.issues
      .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
      .join("; ");
    await audit({
      userId: ctx.userId,
      action: "tool_call_failed",
      toolName: name,
      params: rawParams,
      errorMessage: message,
      ipAddress: ctx.ipAddress,
    });
    return { status: "error", reason: message };
  }
  const parsed = parseResult.data;

  // ── 6. Confirmation gate ──────────────────────────────────────────────────
  // CONFIRM_REQUIRED is the source of truth; the tool's confirm.requireTyping
  // is an optional UX resolver that provides the phrase the user must type.
  if (CONFIRM_REQUIRED.has(name) && !opts?.confirmed) {
    let requireTyping: string | undefined;
    if (tool.confirm?.requireTyping) {
      requireTyping = await tool.confirm.requireTyping(parsed, ctx);
    }
    return {
      status: "confirm_required",
      confirm: {
        action: name,
        params: parsed as Record<string, unknown>,
        requireTyping,
      },
    };
  }

  // ── 7 & 8. Execute + audit outcome ───────────────────────────────────────
  try {
    const result = await tool.execute(parsed, ctx);

    if (!result.success) {
      await audit({
        userId: ctx.userId,
        action: "tool_call_failed",
        toolName: name,
        params: rawParams,
        result,
        errorMessage: result.error ?? "tool returned failure",
        ipAddress: ctx.ipAddress,
      });
      return {
        status: "error",
        result,
        reason: result.error ?? "tool returned failure",
      };
    }

    await audit({
      userId: ctx.userId,
      action: "tool_call_succeeded",
      toolName: name,
      params: rawParams,
      result,
      ipAddress: ctx.ipAddress,
    });
    return { status: "success", result };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await audit({
      userId: ctx.userId,
      action: "tool_call_failed",
      toolName: name,
      params: rawParams,
      errorMessage,
      ipAddress: ctx.ipAddress,
    });
    return { status: "error", reason: errorMessage };
  }
}

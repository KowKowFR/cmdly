import { canExecuteTool } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { TOOLS, CONFIRM_REQUIRED } from "./registry";
import type { ExecutionContext, ExecuteOutcome } from "@/types/tools";

/**
 * Execute a named tool through the full guardrail pipeline:
 *
 * 1. Audit tool_call_attempted
 * 2. Tool lookup
 * 3. RBAC
 * 4. Zod param validation           ← before confirmation gate
 * 5. Confirmation gate              ← NO rate-limit slot consumed here
 * 6. Rate limit                     ← after confirmation gate
 * 7. Execute (with error capture)
 * 8. Audit success / failure
 *
 * This function NEVER throws — all errors are returned as ExecuteOutcome.
 * The top-level try/catch is a safety net for DB failures in steps 1–6 and
 * any other unexpected errors that would otherwise propagate to callers.
 */
export async function executeTool(
  name: string,
  rawParams: unknown,
  ctx: ExecutionContext,
  opts?: { confirmed?: boolean }
): Promise<ExecuteOutcome> {
  try {
    // ── 1. Audit attempted ──────────────────────────────────────────────────
    await audit({
      userId: ctx.userId,
      action: "tool_call_attempted",
      toolName: name,
      params: rawParams,
      ipAddress: ctx.ipAddress,
    });

    // ── 2. Tool lookup ──────────────────────────────────────────────────────
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

    // ── 3. RBAC ─────────────────────────────────────────────────────────────
    // Role === UserRole (unified in Fix 4), casts are no longer needed.
    if (!canExecuteTool(ctx.userRole, tool.requiredRole)) {
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

    // ── 4. Zod validation ───────────────────────────────────────────────────
    // Validated before the confirmation gate so that parsed params are
    // available for requireTyping resolution and echoed back in the response.
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

    // ── 5. Confirmation gate ─────────────────────────────────────────────────
    // Returns early WITHOUT touching the rate-limit counter.  The confirmed
    // retry reaches step 6 and consumes the slot exactly once.
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

    // ── 6. Rate limit ────────────────────────────────────────────────────────
    // Runs AFTER the confirmation gate so an unconfirmed call never burns a slot.
    const rateCheck = await checkRateLimit(ctx.userId, tool.category);
    if (!rateCheck.allowed) {
      const resetTime = rateCheck.resetAt.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const rateLimitMsg = `Limite de débit atteinte pour cette action. Réessayez après ${resetTime}.`;
      await audit({
        userId: ctx.userId,
        action: "tool_call_failed",
        toolName: name,
        params: rawParams,
        errorMessage: rateLimitMsg,
        ipAddress: ctx.ipAddress,
      });
      return {
        status: "error",
        reason: rateLimitMsg,
      };
    }

    // ── 7 & 8. Execute + audit outcome ──────────────────────────────────────
    // Inner try/catch isolates tool.execute failures from the outer safety net.
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
  } catch (err) {
    // Top-level safety net — catches DB failures in steps 1–6, unexpected
    // errors in audit/rate-limit/RBAC/Zod, etc.  Must never propagate.
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("executeTool: unexpected internal error", {
      tool: name,
      error: errorMessage,
    });
    // Best-effort audit — if the DB is already broken this will also fail,
    // which is acceptable: we still return a valid ExecuteOutcome.
    try {
      await audit({
        userId: ctx.userId,
        action: "tool_call_failed",
        toolName: name,
        params: rawParams,
        errorMessage: "internal error",
        ipAddress: ctx.ipAddress,
      });
    } catch {
      // intentionally swallowed — audit must never surface errors to callers
    }
    return { status: "error", reason: "internal error" };
  }
}

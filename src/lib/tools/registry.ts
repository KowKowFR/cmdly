import { z } from "zod";
import type { Tool, Role } from "@/types/tools";
import type { LLMTool } from "@/types/llm";
import { canExecuteTool } from "@/lib/auth/permissions";

// ─── Tool registry ────────────────────────────────────────────────────────────
//
// TOOLS is a plain mutable object keyed by tool name.  Individual tool modules
// (Tasks 10, 12, 13) call register() at import time, e.g.:
//
//   // src/lib/tools/list-vms.ts
//   import { register } from "@/lib/tools/registry";
//   register({ name: "list_vms", ... });
//
// The barrel at src/lib/tools/index.ts imports each tool file so that
// register() side-effects execute before executeTool is called.

export const TOOLS: Record<string, Tool> = {};

export function register(tool: Tool): void {
  TOOLS[tool.name] = tool;
}

// ─── Confirmation gate ────────────────────────────────────────────────────────
//
// CONFIRM_REQUIRED is the canonical source of truth for which tools require
// user confirmation before execution.  The executor checks this set — not the
// tool's `confirm` field — to gate execution.  The `confirm.requireTyping`
// resolver on a Tool is an optional UX enhancement (e.g. "type the VM name to
// confirm") that the executor reads and passes back to the caller as
// `requireTyping` in the confirm_required outcome.
//
// Tasks 12/13 should add entries here:
//   CONFIRM_REQUIRED.add("restart_service");
//   CONFIRM_REQUIRED.add("rollback");
//   CONFIRM_REQUIRED.add("destroy_vm");
//   CONFIRM_REQUIRED.add("stop_service");

export const CONFIRM_REQUIRED = new Set<string>([
  "restart_service",
  "rollback",
  "destroy_vm",
  "stop_service",
]);

// ─── LLM catalogue ───────────────────────────────────────────────────────────

/**
 * Return the subset of registered tools that the given role may call,
 * formatted as LLMTool objects (with JSON Schema parameters) suitable for
 * passing to the LLM provider.
 */
export function toolCatalogueForLLM(role: Role): LLMTool[] {
  return Object.values(TOOLS)
    .filter((tool) => canExecuteTool(role, tool.requiredRole))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters) as Record<string, unknown>,
    }));
}

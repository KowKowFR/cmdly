import type { z } from "zod";
import type { InfrastructureConfig } from "@/lib/config";
import type { UserRole } from "@/lib/auth/permissions";

// ─── Core categories and roles ────────────────────────────────────────────────

export type ToolCategory = "read" | "modify" | "destroy";
/** Single source of truth: re-exported from permissions.  Role === UserRole. */
export type Role = UserRole;

// ─── Execution context passed to every tool ───────────────────────────────────

export interface ExecutionContext {
  userId: string;
  userRole: Role;
  ipAddress: string;
  config: InfrastructureConfig;
}

// ─── What every tool returns ──────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  humanReadable: string;
}

// ─── Tool definition ──────────────────────────────────────────────────────────
//
// The `confirm` field signals that the executor must pause before running the
// tool and ask the user for explicit confirmation.  The source of truth for
// WHICH tools require confirmation is `CONFIRM_REQUIRED` in registry.ts (a Set
// of tool names) — this keeps confirmation logic centralised and independent of
// the individual tool implementation.  The optional `requireTyping` resolver on
// `confirm` lets destroy-class tools demand that the user types a specific
// phrase (e.g. the VM name) before proceeding.

export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;
  requiredRole: Role;
  /** Zod schema; validated by the executor before execute() is called. */
  parameters: z.ZodType;
  /** Present ⇒ tool supports a requireTyping prompt.  Membership in
   *  CONFIRM_REQUIRED is what actually gates execution. */
  confirm?: {
    requireTyping?: (
      params: unknown,
      ctx: ExecutionContext
    ) => Promise<string> | string;
  };
  execute: (params: unknown, ctx: ExecutionContext) => Promise<ToolResult>;
}

// ─── Executor return shape ────────────────────────────────────────────────────

export type ExecuteOutcome =
  | { status: "success"; result: ToolResult }
  | { status: "error"; result?: ToolResult; reason: string }
  | { status: "denied"; reason: string }
  | {
      status: "confirm_required";
      confirm: {
        action: string;
        params: Record<string, unknown>;
        /** If present, the UI must make the user type this exact phrase. */
        requireTyping?: string;
      };
    };

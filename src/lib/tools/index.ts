// ─── Tool barrel ─────────────────────────────────────────────────────────────
//
// Import each tool file here so its register() call executes as a side-effect
// before executeTool() is first called.
//
// Tasks 10, 12, 13 pattern:
//   import "@/lib/tools/list-vms";
//   import "@/lib/tools/get-vm-status";
//   import "@/lib/tools/restart-service";
//   import "@/lib/tools/stop-service";
//   import "@/lib/tools/rollback";
//   import "@/lib/tools/destroy-vm";
//
// Also add the tool name to CONFIRM_REQUIRED in registry.ts for any tool
// that requires user confirmation before execution.

// (empty — tools will be added by Tasks 10, 12, 13)

export { TOOLS, register, CONFIRM_REQUIRED, toolCatalogueForLLM } from "./registry";

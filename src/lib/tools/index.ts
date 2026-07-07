// ─── Tool barrel ─────────────────────────────────────────────────────────────
//
// Import each tool file here so its register() call executes as a side-effect
// before executeTool() is first called.

// Task 10 — read-only tools
import "@/lib/tools/list_vms";
import "@/lib/tools/get_vm_status";
import "@/lib/tools/service_status";
import "@/lib/tools/search_wazuh_alerts";
import "@/lib/tools/get_zabbix_metrics";
import "@/lib/tools/analyze_log";

// Tasks 12, 13 — modify/destroy tools (added later)

export { TOOLS, register, CONFIRM_REQUIRED, toolCatalogueForLLM } from "./registry";

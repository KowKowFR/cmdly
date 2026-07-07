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

// Task 12 — modify tools
import "@/lib/tools/create_vm";
import "@/lib/tools/deploy_role";
import "@/lib/tools/run_playbook";
import "@/lib/tools/restart_service";
import "@/lib/tools/generate_role";
import "@/lib/tools/rollback";

// Task 13 — destroy tools
import "@/lib/tools/destroy_vm";
import "@/lib/tools/stop_service";

export { TOOLS, register, CONFIRM_REQUIRED, toolCatalogueForLLM } from "./registry";

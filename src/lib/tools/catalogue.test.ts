import { test } from "node:test";
import assert from "node:assert/strict";

// Import the barrel to trigger all register() side-effects
await import("./index.ts");
const { toolCatalogueForLLM } = await import("./registry.ts");

test("6 read tools registered for viewer role", () => {
  const tools = toolCatalogueForLLM("viewer");
  const names = tools.map((t) => t.name);

  assert.equal(tools.length, 6, `Expected 6 tools, got ${tools.length}: ${names.join(", ")}`);

  const expected = [
    "list_vms",
    "get_vm_status",
    "service_status",
    "search_wazuh_alerts",
    "get_zabbix_metrics",
    "analyze_log",
  ];
  for (const name of expected) {
    assert.ok(names.includes(name), `Tool "${name}" should be registered`);
  }
});

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

test("12 tools registered for operator role (6 read + 6 modify)", () => {
  const tools = toolCatalogueForLLM("operator");
  const names = tools.map((t) => t.name);

  assert.equal(tools.length, 12, `Expected 12 tools, got ${tools.length}: ${names.join(", ")}`);

  const expectedModify = [
    "create_vm",
    "deploy_role",
    "run_playbook",
    "restart_service",
    "generate_role",
    "rollback",
  ];
  for (const name of expectedModify) {
    assert.ok(names.includes(name), `Tool "${name}" should be registered for operator`);
  }
});

test("CONFIRM_REQUIRED contains restart_service and rollback", async () => {
  const { CONFIRM_REQUIRED } = await import("./registry.ts");
  assert.ok(CONFIRM_REQUIRED.has("restart_service"), "restart_service should be in CONFIRM_REQUIRED");
  assert.ok(CONFIRM_REQUIRED.has("rollback"), "rollback should be in CONFIRM_REQUIRED");
});

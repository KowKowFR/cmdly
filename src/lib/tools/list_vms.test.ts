/**
 * Unit tests for the list_vms tool.
 *
 * Uses the injectable factory (setClientFactory) to avoid any real Proxmox
 * dependency. The tool's execute() is exercised end-to-end; the ProxmoxClient
 * is replaced with a fake that returns canned data.
 *
 * TDD approach: tests were written to describe expected shape of the result;
 * the implementation was written to make them pass (RED→GREEN cycle shown by
 * running tests before and after writing list_vms.ts + proxmox.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports ensure the module-level register() side-effect has run.
const { listVms, setClientFactory } = await import("./list_vms.ts");
import type { ExecutionContext } from "@/types/tools";
import type { InfrastructureConfig } from "@/lib/config";

// ─── Minimal ctx helper ───────────────────────────────────────────────────────

const minimalConfig = {} as InfrastructureConfig;

function makeCtx(): ExecutionContext {
  return {
    userId: "test-user",
    userRole: "viewer",
    ipAddress: "127.0.0.1",
    config: minimalConfig,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("list_vms execute returns success:true with formatted humanReadable", async () => {
  setClientFactory((_cfg) => ({
    listVms: async () => [
      { vmid: 100, name: "web-01", status: "running", maxmem: 2_147_483_648, cpus: 2, uptime: 3600 },
      { vmid: 101, name: "db-01",  status: "stopped", maxmem: 4_294_967_296, cpus: 4, uptime: 0 },
    ],
  }));

  const result = await listVms.execute({}, makeCtx());

  assert.equal(result.success, true);
  assert.ok(result.humanReadable.includes("web-01"), "humanReadable should mention web-01");
  assert.ok(result.humanReadable.includes("#100"),   "humanReadable should include vmid 100");
  assert.ok(result.humanReadable.includes("running"), "humanReadable should include status");

  const data = result.data as Array<{ vmid: number; name: string }>;
  assert.equal(data.length, 2);
});

test("list_vms execute returns humanReadable 'Aucune VM' when list is empty", async () => {
  setClientFactory((_cfg) => ({ listVms: async () => [] }));

  const result = await listVms.execute({}, makeCtx());

  assert.equal(result.success, true);
  assert.ok(
    result.humanReadable.includes("Aucune"),
    `expected 'Aucune' in humanReadable, got: ${result.humanReadable}`,
  );
});

test("list_vms execute returns success:false when client throws", async () => {
  setClientFactory((_cfg) => ({
    listVms: async () => {
      throw new Error("connection refused");
    },
  }));

  const result = await listVms.execute({}, makeCtx());

  assert.equal(result.success, false);
  assert.ok(result.error?.includes("connection refused"), `error should mention cause, got: ${result.error}`);
});

test("list_vms is registered with category 'read' and requiredRole 'viewer'", () => {
  assert.equal(listVms.name, "list_vms");
  assert.equal(listVms.category, "read");
  assert.equal(listVms.requiredRole, "viewer");
});

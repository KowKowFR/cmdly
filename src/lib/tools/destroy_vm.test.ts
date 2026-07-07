/**
 * TDD tests for src/lib/tools/destroy_vm.ts — RED→GREEN cycle.
 *
 * Uses injectable factories for ProxmoxClient and terraform.destroy so no real
 * infra is touched. Exercises the executor pipeline (RBAC, confirm gate,
 * requireTyping resolution, execute path).
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports so register() side-effects run before tests.
const { destroyVm, setClientFactory, setTerraformFacade } = await import(
  "./destroy_vm.ts"
);
import type { TerraformFacade } from "./destroy_vm.ts";
import { executeTool } from "./executor.ts";
import type { ExecutionContext } from "@/types/tools";
import type { InfrastructureConfig } from "@/lib/config";
import type { ProxmoxVm } from "@/lib/proxmox";

// ─── Fake config ──────────────────────────────────────────────────────────────

const fakeConfig: InfrastructureConfig = {
  infraRepoPath: "/fake/repo",
  proxmoxHost: "proxmox.local",
  proxmoxPort: null,
  proxmoxUser: "root@pam",
  proxmoxTokenId: "cmdly",
  proxmoxTokenSecret: "secret",
  proxmoxNode: "pve",
  infraRepoType: "local",
  infraRepoGitUrl: "",
  infraRepoGitBranch: "",
  sshKeyPath: "",
  bastionHost: "",
  bastionPort: null,
  bastionUser: "",
  ansibleVaultPasswordFile: "",
  zabbixUrl: "",
  zabbixUser: "",
  zabbixPassword: "",
  wazuhUrl: "",
  wazuhUser: "",
  wazuhPassword: "",
  ldapEnabled: false,
  ldapUrl: "",
  ldapBindDn: "",
  ldapBindPassword: "",
  ldapBaseDn: "",
  defaultLlmProvider: "openai",
  openaiApiKey: "",
  openaiModel: "",
  anthropicApiKey: "",
  anthropicModel: "",
  ollamaBaseUrl: "",
  ollamaModel: "",
  onboardingCompleted: true,
};

// ─── Context helpers ──────────────────────────────────────────────────────────

function makeCtx(role: "viewer" | "operator" | "admin"): ExecutionContext {
  return {
    userId: "test-user",
    userRole: role,
    ipAddress: "127.0.0.1",
    config: fakeConfig,
  };
}

// ─── Fake VM list ─────────────────────────────────────────────────────────────

const fakeVms: ProxmoxVm[] = [
  {
    vmid: 100,
    name: "web-01",
    status: "running",
    maxmem: 2_147_483_648,
    cpus: 2,
    uptime: 3600,
  },
];

// ─── Setup: inject fakes before each test ─────────────────────────────────────

beforeEach(() => {
  // Default: successful ProxmoxClient returning the fake VM list
  setClientFactory((_cfg) => ({
    listVms: async () => fakeVms,
  }));

  // Default: successful terraform destroy
  setTerraformFacade({
    async destroy(_repoPath, _target) {
      return {
        ok: true,
        stdout: "Destroy complete! Resources: 1 destroyed.",
        stderr: "",
      };
    },
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("destroy_vm: ADMIN without confirmed → confirm_required with requireTyping=VM name", async () => {
  const outcome = await executeTool(
    "destroy_vm",
    { vmid: 100 },
    makeCtx("admin"),
    { confirmed: false }
  );

  assert.equal(outcome.status, "confirm_required");
  if (outcome.status !== "confirm_required") throw new Error("narrow guard");

  assert.equal(outcome.confirm.action, "destroy_vm");
  assert.equal(outcome.confirm.requireTyping, "web-01", "requireTyping should be the VM name");
});

test("destroy_vm: requireTyping falls back to vmid string when VM not found", async () => {
  setClientFactory((_cfg) => ({
    listVms: async () => [],
  }));

  const outcome = await executeTool(
    "destroy_vm",
    { vmid: 999 },
    makeCtx("admin"),
    { confirmed: false }
  );

  assert.equal(outcome.status, "confirm_required");
  if (outcome.status !== "confirm_required") throw new Error("narrow guard");
  assert.equal(
    outcome.confirm.requireTyping,
    "999",
    "should fall back to vmid string"
  );
});

test("destroy_vm: requireTyping falls back to vmid string when Proxmox throws", async () => {
  setClientFactory((_cfg) => ({
    listVms: async () => {
      throw new Error("connection refused");
    },
  }));

  const outcome = await executeTool(
    "destroy_vm",
    { vmid: 100 },
    makeCtx("admin"),
    { confirmed: false }
  );

  assert.equal(outcome.status, "confirm_required");
  if (outcome.status !== "confirm_required") throw new Error("narrow guard");
  assert.equal(outcome.confirm.requireTyping, "100");
});

test("destroy_vm: OPERATOR → denied (requiredRole=admin)", async () => {
  const outcome = await executeTool(
    "destroy_vm",
    { vmid: 100 },
    makeCtx("operator")
  );

  assert.equal(outcome.status, "denied");
});

test("destroy_vm: VIEWER → denied", async () => {
  const outcome = await executeTool(
    "destroy_vm",
    { vmid: 100 },
    makeCtx("viewer")
  );

  assert.equal(outcome.status, "denied");
});

// ─── Execute path tests (call tool.execute directly, bypassing rate limiter) ──

test("destroy_vm: execute calls terraform.destroy with correct target and returns success", async () => {
  let destroyCalledWith: { repoPath: string; target: string | undefined } | null =
    null;

  setTerraformFacade({
    async destroy(repoPath, target) {
      destroyCalledWith = { repoPath, target };
      return {
        ok: true,
        stdout: "Destroy complete! Resources: 1 destroyed.",
        stderr: "",
      };
    },
  });

  const result = await destroyVm.execute({ vmid: 100 }, makeCtx("admin"));

  assert.equal(result.success, true);
  assert.ok(destroyCalledWith !== null, "terraform.destroy should have been called");
  assert.equal(destroyCalledWith!.repoPath, "/fake/repo");
  assert.equal(
    destroyCalledWith!.target,
    "proxmox_vm_qemu.web-01",
    "target should be proxmox_vm_qemu.<name>"
  );
  assert.ok(
    result.humanReadable.includes("web-01"),
    `humanReadable should mention VM name: ${result.humanReadable}`
  );
});

test("destroy_vm: execute returns failure when terraform.destroy fails", async () => {
  setTerraformFacade({
    async destroy(_repoPath, _target) {
      return { ok: false, stdout: "", stderr: "Error: resource not found" };
    },
  });

  const result = await destroyVm.execute({ vmid: 100 }, makeCtx("admin"));

  assert.equal(result.success, false);
  assert.ok(
    result.humanReadable.includes("Échec"),
    `Should report failure: ${result.humanReadable}`
  );
});

test("destroy_vm: execute returns error when VM name has unsafe chars (terraform target refused)", async () => {
  setClientFactory((_cfg) => ({
    listVms: async (): Promise<ProxmoxVm[]> => [
      {
        vmid: 200,
        name: "Web Server (prod)",
        status: "running",
        maxmem: 1_000_000,
        cpus: 1,
        uptime: 0,
      },
    ],
  }));

  const result = await destroyVm.execute({ vmid: 200 }, makeCtx("admin"));

  assert.equal(result.success, false);
  assert.ok(
    result.humanReadable.includes("manuellement"),
    `Should indicate manual action needed: ${result.humanReadable}`
  );
});

test("destroy_vm: unsafe VM name at confirm time → error (not confirm_required)", async () => {
  // Stub resolveVmName to return a name with unsafe characters.
  setClientFactory((_cfg) => ({
    listVms: async (): Promise<ProxmoxVm[]> => [
      {
        vmid: 200,
        name: "Bad Name!",
        status: "running",
        maxmem: 1_000_000,
        cpus: 1,
        uptime: 0,
      },
    ],
  }));

  const outcome = await executeTool(
    "destroy_vm",
    { vmid: 200 },
    makeCtx("admin"),
    { confirmed: false }
  );

  // requireTyping throws → outer executor catch → {status:"error"}
  assert.equal(
    outcome.status,
    "error",
    `Expected 'error', got '${outcome.status}' — unsafe name should be rejected before the typing prompt`
  );
});

test("destroy_vm: SAFE_NAME_RE accepts 'web-01' and rejects '---', '-x', 'x-'", () => {
  // Access SAFE_NAME_RE indirectly via the schema test + execute behavior.
  // We test the regex semantics via the Proxmox name resolution path.
  // Direct regex tests for documentation / regression coverage:
  const re = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  assert.ok(re.test("web-01"), "web-01 should be safe");
  assert.ok(!re.test("---"), "--- should be rejected");
  assert.ok(!re.test("-x"), "-x should be rejected (leading hyphen)");
  assert.ok(!re.test("x-"), "x- should be rejected (trailing hyphen)");
  assert.ok(!re.test(""), "empty string should be rejected");
  assert.ok(re.test("a"), "single letter should be accepted");
  assert.ok(re.test("1"), "single digit should be accepted");
});

test("destroy_vm: schema rejects non-integer vmid", () => {
  const parsed = destroyVm.parameters.safeParse({ vmid: 1.5 });
  assert.equal(parsed.success, false, "Should reject non-integer vmid");
});

test("destroy_vm: schema rejects negative vmid", () => {
  const parsed = destroyVm.parameters.safeParse({ vmid: -1 });
  assert.equal(parsed.success, false, "Should reject negative vmid");
});

test("destroy_vm: is registered with category=destroy and requiredRole=admin", () => {
  assert.equal(destroyVm.name, "destroy_vm");
  assert.equal(destroyVm.category, "destroy");
  assert.equal(destroyVm.requiredRole, "admin");
});

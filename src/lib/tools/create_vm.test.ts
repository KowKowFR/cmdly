/**
 * TDD tests for src/lib/tools/create_vm.ts
 *
 * Uses the injectable TerraformFacade to stub terraform calls.
 * Tests: param validation, tfvars written from params, humanReadable output.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createVm, setTerraformFacade } from "./create_vm.ts";
import type { TerraformFacade } from "./create_vm.ts";
import type { ExecutionContext } from "@/types/tools";

// ─── Fake context ─────────────────────────────────────────────────────────────

const fakeCtx: ExecutionContext = {
  userId: "user-1",
  userRole: "operator",
  ipAddress: "127.0.0.1",
  config: {
    infraRepoPath: "/fake/repo",
    proxmoxHost: "",
    proxmoxPort: null,
    proxmoxUser: "",
    proxmoxTokenId: "",
    proxmoxTokenSecret: "",
    proxmoxNode: "",
    infraRepoType: "local",
    infraRepoGitUrl: "",
    infraRepoGitBranch: "",
    sshMode: "bastion",
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
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TfvarsCapture {
  repoPath: string;
  vars: Record<string, string | number>;
}

function makeFakeFacade(overrides?: Partial<TerraformFacade>): {
  facade: TerraformFacade;
  capture: { writeTfvars: TfvarsCapture | null };
} {
  const capture: { writeTfvars: TfvarsCapture | null } = { writeTfvars: null };

  const facade: TerraformFacade = {
    async writeTfvars(repoPath, vars) {
      capture.writeTfvars = { repoPath, vars };
    },
    async plan(_repoPath) {
      return { ok: true, stdout: "Plan: 1 to add.", stderr: "" };
    },
    async apply(_repoPath) {
      return { ok: true, stdout: "Apply complete! Resources: 1 added.", stderr: "" };
    },
    ...overrides,
  };

  return { facade, capture };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset facade to a no-op stub between tests
  setTerraformFacade(makeFakeFacade().facade);
});

test("create_vm: succeeds and returns French humanReadable", async () => {
  const { facade } = makeFakeFacade();
  setTerraformFacade(facade);

  const result = await createVm.execute(
    { name: "web-01", vlan: "srv", memory: 2048, cores: 2, disk: 20 },
    fakeCtx
  );

  assert.equal(result.success, true);
  assert.ok(
    result.humanReadable.includes("web-01"),
    `Expected VM name in humanReadable:\n${result.humanReadable}`
  );
  assert.ok(
    result.humanReadable.includes("srv"),
    `Expected VLAN in humanReadable:\n${result.humanReadable}`
  );
});

test("create_vm: writes tfvars with correct keys derived from params", async () => {
  const { facade, capture } = makeFakeFacade();
  setTerraformFacade(facade);

  await createVm.execute(
    { name: "db-01", vlan: "mgt", memory: 4096, cores: 4, disk: 50 },
    fakeCtx
  );

  assert.ok(capture.writeTfvars !== null, "writeTfvars should have been called");
  const { repoPath, vars } = capture.writeTfvars!;

  assert.equal(repoPath, "/fake/repo");
  assert.equal(vars["vm_name"], "db-01");
  assert.equal(vars["vm_vlan"], "mgt");
  assert.equal(vars["vm_memory"], 4096);
  assert.equal(vars["vm_cores"], 4);
  assert.equal(vars["vm_disk"], 50);
});

test("create_vm: returns failure when plan fails", async () => {
  const { facade } = makeFakeFacade({
    async plan(_repoPath) {
      return { ok: false, stdout: "", stderr: "Error: backend not initialized" };
    },
  });
  setTerraformFacade(facade);

  const result = await createVm.execute(
    { name: "web-01", vlan: "srv", memory: 2048, cores: 2, disk: 20 },
    fakeCtx
  );

  assert.equal(result.success, false);
  assert.ok(
    result.humanReadable.includes("plan") || result.humanReadable.includes("Échec"),
    `Expected failure message in humanReadable:\n${result.humanReadable}`
  );
});

test("create_vm: returns failure when apply fails", async () => {
  const { facade } = makeFakeFacade({
    async apply(_repoPath) {
      return { ok: false, stdout: "", stderr: "Error: timeout" };
    },
  });
  setTerraformFacade(facade);

  const result = await createVm.execute(
    { name: "web-01", vlan: "srv", memory: 2048, cores: 2, disk: 20 },
    fakeCtx
  );

  assert.equal(result.success, false);
});

test("create_vm: schema rejects invalid name with special chars", async () => {
  const parsed = createVm.parameters.safeParse({
    name: "web/../etc",
    vlan: "srv",
    memory: 512,
    cores: 1,
    disk: 10,
  });
  assert.equal(parsed.success, false, "Should reject name with path chars");
});

test("create_vm: schema rejects invalid vlan", async () => {
  const parsed = createVm.parameters.safeParse({
    name: "web-01",
    vlan: "admin",
    memory: 512,
    cores: 1,
    disk: 10,
  });
  assert.equal(parsed.success, false, "Should reject unknown VLAN");
});

test("create_vm: schema rejects memory below 256", async () => {
  const parsed = createVm.parameters.safeParse({
    name: "web-01",
    vlan: "srv",
    memory: 128,
    cores: 1,
    disk: 10,
  });
  assert.equal(parsed.success, false, "Should reject memory < 256");
});

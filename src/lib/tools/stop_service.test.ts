/**
 * Tests for src/lib/tools/stop_service.ts — exercises the executor pipeline.
 *
 * Uses the injectable setRunCommandFn seam so no real SSH connection is made.
 */

// The executor touches the audit/DB layer; provide env vars it may need.
process.env.DATABASE_URL ??= "file:./test.db";
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-stop-service-tests";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Dynamic import so register() side-effect runs before tests.
const { stopService, setRunCommandFn } = await import("./stop_service.ts");
import { executeTool } from "./executor.ts";
import type { ExecutionContext } from "@/types/tools";
import type { InfrastructureConfig } from "@/lib/config";

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

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Default: successful SSH command
  setRunCommandFn(async (_cfg, _host, _cmd, _args) => ({
    code: 0,
    stdout: "",
    stderr: "",
  }));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

test("stop_service: OPERATOR → denied (requiredRole=admin)", async () => {
  const outcome = await executeTool(
    "stop_service",
    { vmHost: "192.168.1.10", serviceName: "nginx" },
    makeCtx("operator")
  );

  assert.equal(outcome.status, "denied");
});

test("stop_service: VIEWER → denied", async () => {
  const outcome = await executeTool(
    "stop_service",
    { vmHost: "192.168.1.10", serviceName: "nginx" },
    makeCtx("viewer")
  );

  assert.equal(outcome.status, "denied");
});

test("stop_service: ADMIN without confirmed → confirm_required (SSH not invoked)", async () => {
  let sshCalled = false;
  setRunCommandFn(async (_cfg, _host, _cmd, _args) => {
    sshCalled = true;
    return { code: 0, stdout: "", stderr: "" };
  });

  const outcome = await executeTool(
    "stop_service",
    { vmHost: "192.168.1.10", serviceName: "nginx" },
    makeCtx("admin"),
    { confirmed: false }
  );

  assert.equal(outcome.status, "confirm_required");
  assert.equal(sshCalled, false, "SSH should NOT be invoked before confirmation");
});

test("stop_service: execute with stubbed SSH → success (calls systemctl stop)", async () => {
  // Mirror destroy_vm.test.ts pattern: call tool.execute() directly to bypass
  // the rate limiter (which needs a real DB). The confirm gate is already
  // tested by the confirm_required test above.
  let capturedHost: string | undefined;
  let capturedArgs: string[] | undefined;

  setRunCommandFn(async (_cfg, host, _cmd, args) => {
    capturedHost = host;
    capturedArgs = args;
    return { code: 0, stdout: "", stderr: "" };
  });

  const result = await stopService.execute(
    { vmHost: "192.168.1.10", serviceName: "nginx" },
    makeCtx("admin")
  );

  assert.equal(result.success, true);
  assert.equal(capturedHost, "192.168.1.10");
  assert.deepEqual(capturedArgs, ["stop", "nginx"]);
  assert.ok(
    result.humanReadable.includes("nginx"),
    `humanReadable should mention service name: ${result.humanReadable}`
  );
});

test("stop_service: invalid serviceName (contains space/bang) → Zod error", async () => {
  const outcome = await executeTool(
    "stop_service",
    { vmHost: "192.168.1.10", serviceName: "bad name!" },
    makeCtx("admin")
  );

  assert.equal(outcome.status, "error");
  assert.ok(
    outcome.reason?.includes("serviceName"),
    `error reason should mention 'serviceName': ${outcome.reason}`
  );
});

test("stop_service: SSH returns non-zero → tool returns failure", async () => {
  // Call execute() directly to avoid the DB-dependent rate limiter.
  setRunCommandFn(async (_cfg, _host, _cmd, _args) => ({
    code: 5,
    stdout: "",
    stderr: "Unit nginx.service not found.",
  }));

  const result = await stopService.execute(
    { vmHost: "192.168.1.10", serviceName: "nginx" },
    makeCtx("admin")
  );

  assert.equal(result.success, false);
  assert.ok(
    result.humanReadable.includes("Échec"),
    `humanReadable should report failure: ${result.humanReadable}`
  );
});

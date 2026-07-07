/**
 * Unit tests for ProxmoxClient — inject a fake fetch so no live Proxmox is needed.
 *
 * TDD approach: tests were written to describe expected behaviour;
 * the implementation in proxmox.ts was then written to make them pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { ProxmoxClient } = await import("./proxmox.ts");

// ─── Shared minimal config ────────────────────────────────────────────────────

const cfg = {
  proxmoxHost: "proxmox.test",
  proxmoxPort: 8006,
  proxmoxUser: "root@pam",
  proxmoxTokenId: "mytoken",
  proxmoxTokenSecret: "mysecret",
  proxmoxNode: "pve",
} as Parameters<typeof ProxmoxClient.prototype.constructor>[0];

// ─── listVms ──────────────────────────────────────────────────────────────────

test("ProxmoxClient.listVms maps API data[] to ProxmoxVm array", async () => {
  const fakePayload = {
    data: [
      { vmid: 100, name: "web-01", status: "running", maxmem: 2_147_483_648, cpus: 2, uptime: 3600 },
      { vmid: 101, name: "db-01",  status: "stopped", maxmem: 4_294_967_296, cpus: 4, uptime: 0 },
    ],
  };

  const fakeFetch = async (_url: string, _init: object) => ({
    ok: true,
    status: 200,
    json: async () => fakePayload,
  });

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  const vms = await client.listVms();

  assert.equal(vms.length, 2, "should return 2 VMs");

  const first = vms[0];
  assert.ok(first, "first VM should exist");
  assert.equal(first.vmid, 100);
  assert.equal(first.name, "web-01");
  assert.equal(first.status, "running");
  assert.equal(first.maxmem, 2_147_483_648);
  assert.equal(first.cpus, 2);
  assert.equal(first.uptime, 3600);

  const second = vms[1];
  assert.ok(second, "second VM should exist");
  assert.equal(second.vmid, 101);
  assert.equal(second.status, "stopped");
});

test("ProxmoxClient.listVms returns empty array when data is absent", async () => {
  const fakeFetch = async (_url: string, _init: object) => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  });

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  const vms = await client.listVms();
  assert.deepEqual(vms, []);
});

test("ProxmoxClient.listVms throws on non-ok HTTP response", async () => {
  const fakeFetch = async (_url: string, _init: object) => ({
    ok: false,
    status: 403,
    json: async () => ({}),
  });

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  await assert.rejects(() => client.listVms(), /403/);
});

// ─── Authorization header ─────────────────────────────────────────────────────

test("ProxmoxClient sends correct PVEAPIToken authorization header", async () => {
  let capturedHeaders: Record<string, string> | undefined;

  const fakeFetch = async (_url: string, init: object) => {
    const headers = (init as { headers?: Record<string, string> }).headers ?? {};
    capturedHeaders = headers;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  await client.listVms();

  assert.ok(capturedHeaders, "headers should have been captured");
  assert.equal(
    capturedHeaders["Authorization"],
    "PVEAPIToken=root@pam!mytoken=mysecret",
  );
});

// ─── getVmStatus ──────────────────────────────────────────────────────────────

test("ProxmoxClient.getVmStatus maps status/current response", async () => {
  const fakeStatus = {
    data: {
      status: "running",
      uptime: 7200,
      cpu: 0.05,
      mem: 1_073_741_824,
      maxmem: 2_147_483_648,
      disk: 10_737_418_240,
    },
  };

  const fakeFetch = async (_url: string, _init: object) => ({
    ok: true,
    status: 200,
    json: async () => fakeStatus,
  });

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  const status = await client.getVmStatus(100);

  assert.equal(status.status, "running");
  assert.equal(status.uptime, 7200);
  assert.equal(status.cpu, 0.05);
  assert.equal(status.mem, 1_073_741_824);
  assert.equal(status.maxmem, 2_147_483_648);
});

// ─── testConnection ───────────────────────────────────────────────────────────

test("ProxmoxClient.testConnection returns ok:true with version on success", async () => {
  const fakeFetch = async (_url: string, _init: object) => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { version: "8.1.0" } }),
  });

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  const result = await client.testConnection();

  assert.equal(result.ok, true);
  assert.ok(result.message.includes("8.1.0"), `message should include version, got: ${result.message}`);
});

test("ProxmoxClient.testConnection returns ok:false on HTTP error", async () => {
  const fakeFetch = async (_url: string, _init: object) => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });

  const client = new ProxmoxClient(cfg as never, fakeFetch as never);
  const result = await client.testConnection();

  assert.equal(result.ok, false);
});

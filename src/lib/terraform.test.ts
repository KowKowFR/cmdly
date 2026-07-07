/**
 * TDD tests for src/lib/terraform.ts
 *
 * RED → GREEN approach: we verify that:
 *  1. apply() calls the runner with exactly the right argv and cwd.
 *  2. writeTfvars() writes valid HCL to a temp file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply, writeTfvars, plan, destroy } from "./terraform.ts";
import type { RunFn } from "./terraform.ts";

// ─── Test 1: apply() argv assertion ──────────────────────────────────────────

test("apply() calls runner with correct argv and cwd", async () => {
  let capturedCommand = "";
  let capturedArgs: string[] = [];
  let capturedCwd = "";

  const fakeRunner: RunFn = async (command, args, opts) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedCwd = opts.cwd;
    return { stdout: "Apply complete!", stderr: "" };
  };

  const result = await apply("/fake/repo", fakeRunner);

  assert.equal(result.ok, true);
  assert.equal(capturedCommand, "terraform");
  assert.deepEqual(capturedArgs, [
    "apply",
    "-auto-approve",
    "-input=false",
    "-no-color",
  ]);
  assert.equal(capturedCwd, "/fake/repo");
  assert.equal(result.stdout, "Apply complete!");
});

// ─── Test 2: plan() argv assertion ───────────────────────────────────────────

test("plan() calls runner with correct argv", async () => {
  let capturedArgs: string[] = [];

  const fakeRunner: RunFn = async (_command, args, _opts) => {
    capturedArgs = args;
    return { stdout: "Plan: 1 to add.", stderr: "" };
  };

  const result = await plan("/fake/repo", fakeRunner);

  assert.equal(result.ok, true);
  assert.deepEqual(capturedArgs, ["plan", "-input=false", "-no-color"]);
});

// ─── Test 3: destroy() with target ───────────────────────────────────────────

test("destroy() passes -target as separate argv element", async () => {
  let capturedArgs: string[] = [];

  const fakeRunner: RunFn = async (_command, args, _opts) => {
    capturedArgs = args;
    return { stdout: "Destroy complete!", stderr: "" };
  };

  const result = await destroy("/fake/repo", "proxmox_vm_qemu.web-01", fakeRunner);

  assert.equal(result.ok, true);
  assert.deepEqual(capturedArgs, [
    "destroy",
    "-auto-approve",
    "-input=false",
    "-no-color",
    "-target",
    "proxmox_vm_qemu.web-01",
  ]);
});

test("destroy() without target omits -target", async () => {
  let capturedArgs: string[] = [];

  const fakeRunner: RunFn = async (_command, args, _opts) => {
    capturedArgs = args;
    return { stdout: "Destroy complete!", stderr: "" };
  };

  await destroy("/fake/repo", undefined, fakeRunner);

  assert.ok(!capturedArgs.includes("-target"), "should not include -target");
});

// ─── Test 4: writeTfvars() HCL rendering ─────────────────────────────────────

test("writeTfvars() renders valid HCL for {name: 'web-01', memory: 2048}", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "cmdly-tfvars-test-"));
  try {
    await writeTfvars(tmpDir, { name: "web-01", memory: 2048 });

    const content = await readFile(join(tmpDir, "cmdly.auto.tfvars"), "utf-8");

    // Must contain string key with quoted value
    assert.ok(
      content.includes('name = "web-01"'),
      `Expected 'name = "web-01"' in:\n${content}`
    );
    // Must contain numeric key without quotes
    assert.ok(
      content.includes("memory = 2048"),
      `Expected 'memory = 2048' in:\n${content}`
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("writeTfvars() escapes backslashes and quotes in string values", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "cmdly-tfvars-escape-test-"));
  try {
    await writeTfvars(tmpDir, { path: 'C:\\Users\\test', label: 'say "hi"' });

    const content = await readFile(join(tmpDir, "cmdly.auto.tfvars"), "utf-8");

    assert.ok(
      content.includes('path = "C:\\\\Users\\\\test"'),
      `Backslashes not escaped properly in:\n${content}`
    );
    assert.ok(
      content.includes('label = "say \\"hi\\""'),
      `Quotes not escaped properly in:\n${content}`
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("writeTfvars() escapes HCL template interpolation: $ becomes $$", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "cmdly-tfvars-interp-test-"));
  try {
    await writeTfvars(tmpDir, { name: "a${data.secret}b" });

    const content = await readFile(join(tmpDir, "cmdly.auto.tfvars"), "utf-8");

    // The written value must contain $${  (escaped dollar) not bare ${
    assert.ok(
      content.includes("$${"),
      `Expected escaped '$\${' in:\n${content}`
    );
    assert.ok(
      !content.includes('= "a${'),
      `Bare '\${' interpolation must not appear in:\n${content}`
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Test 5: runner failure handling ─────────────────────────────────────────

test("apply() returns ok:false when runner throws", async () => {
  const failRunner: RunFn = async () => {
    const err = Object.assign(new Error("exit 1"), {
      stdout: "",
      stderr: "Error: resource not found",
    });
    throw err;
  };

  const result = await apply("/fake/repo", failRunner);

  assert.equal(result.ok, false);
  assert.ok(result.stderr.includes("Error: resource not found"));
});

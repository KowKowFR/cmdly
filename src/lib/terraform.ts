/**
 * Terraform executor — wraps CLI calls via execFile (no shell interpolation).
 *
 * Security: all arguments are passed as separate argv elements in an array.
 * No shell:true, no template-literal command strings.
 *
 * The `run` function is injectable for unit tests via the factory pattern.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerraformResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Signature of the promisified execFile return value we use internally. */
export type RunFn = (
  command: string,
  args: string[],
  opts: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>;

// ─── Default runner ───────────────────────────────────────────────────────────

const _defaultRun: RunFn = promisify(execFile) as RunFn;

// ─── HCL rendering helpers ────────────────────────────────────────────────────

/**
 * Escape a string value for HCL: backslashes then double-quotes.
 * Result is placed between double-quotes in the .tfvars file.
 */
function escapeTfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Render a Record of vars to HCL .tfvars format.
 * Strings → key = "escaped_value"
 * Numbers → key = 123
 */
function renderTfvars(vars: Record<string, string | number>): string {
  return Object.entries(vars)
    .map(([key, value]) => {
      if (typeof value === "number") {
        return `${key} = ${value}`;
      }
      return `${key} = "${escapeTfString(value)}"`;
    })
    .join("\n") + "\n";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write a `cmdly.auto.tfvars` file in repoPath with the given vars.
 * Terraform auto-loads *.auto.tfvars files so no -var-file flag is needed.
 */
export async function writeTfvars(
  repoPath: string,
  vars: Record<string, string | number>
): Promise<void> {
  const content = renderTfvars(vars);
  const filePath = join(repoPath, "cmdly.auto.tfvars");
  await writeFile(filePath, content, "utf-8");
}

/**
 * Run `terraform plan` in repoPath.
 * Accepts an optional runner for testing.
 */
export async function plan(
  repoPath: string,
  runner: RunFn = _defaultRun
): Promise<TerraformResult> {
  try {
    const { stdout, stderr } = await runner(
      "terraform",
      ["plan", "-input=false", "-no-color"],
      { cwd: repoPath, timeout: 120_000 }
    );
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

/**
 * Run `terraform apply -auto-approve` in repoPath.
 * Accepts an optional runner for testing.
 */
export async function apply(
  repoPath: string,
  runner: RunFn = _defaultRun
): Promise<TerraformResult> {
  try {
    const { stdout, stderr } = await runner(
      "terraform",
      ["apply", "-auto-approve", "-input=false", "-no-color"],
      { cwd: repoPath, timeout: 300_000 }
    );
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

/**
 * Run `terraform destroy -auto-approve` in repoPath.
 * If targetAddress is given it is passed as a separate argv element (no interpolation).
 * Accepts an optional runner for testing.
 */
export async function destroy(
  repoPath: string,
  targetAddress?: string,
  runner: RunFn = _defaultRun
): Promise<TerraformResult> {
  const args = ["destroy", "-auto-approve", "-input=false", "-no-color"];
  if (targetAddress !== undefined) {
    args.push("-target", targetAddress);
  }
  try {
    const { stdout, stderr } = await runner("terraform", args, {
      cwd: repoPath,
      timeout: 300_000,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

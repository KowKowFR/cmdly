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
import type { InfrastructureConfig } from "@/lib/config";

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

// ─── Provider credentials ─────────────────────────────────────────────────────

/**
 * Build the environment the bpg/proxmox provider reads for authentication,
 * derived from the stored (decrypted-in-memory) infrastructure config. Passing
 * these as process env keeps the API token out of any on-disk .tf/.tfvars file.
 * Returns an empty object when Proxmox isn't configured (nothing to inject).
 */
export function proxmoxEnv(
  cfg: Pick<
    InfrastructureConfig,
    "proxmoxHost" | "proxmoxPort" | "proxmoxUser" | "proxmoxTokenId" | "proxmoxTokenSecret"
  >
): Record<string, string> {
  if (!cfg.proxmoxHost || !cfg.proxmoxTokenId || !cfg.proxmoxTokenSecret) {
    return {};
  }
  const port = cfg.proxmoxPort ?? 8006;
  return {
    PROXMOX_VE_ENDPOINT: `https://${cfg.proxmoxHost}:${port}/`,
    // Proxmox API token id form: USER@REALM!TOKENID=SECRET
    PROXMOX_VE_API_TOKEN: `${cfg.proxmoxUser}!${cfg.proxmoxTokenId}=${cfg.proxmoxTokenSecret}`,
    PROXMOX_VE_INSECURE: "true",
  };
}

/** Merge caller-supplied env over the current process env (or undefined). */
function mergedEnv(env?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  if (!env || Object.keys(env).length === 0) return undefined;
  return { ...process.env, ...env };
}

// ─── HCL rendering helpers ────────────────────────────────────────────────────

/**
 * Escape a string value for HCL: backslashes, then double-quotes, then `$`.
 * Result is placed between double-quotes in the .tfvars file.
 *
 * Order matters:
 *   1. `\` → `\\`  (must be first so we don't double-escape later additions)
 *   2. `"` → `\"`
 *   3. `$` → `$$`  (HCL2 escapes a literal dollar by doubling it, preventing
 *                   `${...}` template interpolation inside quoted strings)
 */
function escapeTfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "$$$$");
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
  env?: Record<string, string>,
  runner: RunFn = _defaultRun
): Promise<TerraformResult> {
  try {
    const { stdout, stderr } = await runner(
      "terraform",
      ["plan", "-input=false", "-no-color"],
      { cwd: repoPath, timeout: 120_000, env: mergedEnv(env) }
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
  env?: Record<string, string>,
  runner: RunFn = _defaultRun
): Promise<TerraformResult> {
  try {
    const { stdout, stderr } = await runner(
      "terraform",
      ["apply", "-auto-approve", "-input=false", "-no-color"],
      { cwd: repoPath, timeout: 300_000, env: mergedEnv(env) }
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
  env?: Record<string, string>,
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
      env: mergedEnv(env),
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

/**
 * Ansible executor — wraps ansible-playbook / git CLI calls via execFile.
 *
 * Security: all arguments are passed as separate argv elements.
 * No shell:true, no template-literal command strings.
 * playbook paths, host names, and role names are validated by calling tools
 * before reaching these functions.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "@/lib/logger";

const _execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnsibleResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Parsed from the PLAY RECAP section; undefined if recap not found. */
  recap?: {
    changed: number;
    failures: number;
    ok: number;
    unreachable: number;
  };
}

// ─── Recap parser ─────────────────────────────────────────────────────────────

/**
 * Parse the PLAY RECAP section from ansible-playbook stdout.
 * Example line:
 *   hostname : ok=5  changed=2  unreachable=0  failed=0  skipped=0  rescued=0  ignored=0
 */
function parseRecap(stdout: string): AnsibleResult["recap"] | undefined {
  // Collect all host lines after PLAY RECAP
  const recapMatch = stdout.match(/PLAY RECAP \*+\n([\s\S]*?)(?:\n\n|\n$|$)/);
  if (!recapMatch) return undefined;

  const block = recapMatch[1] ?? "";
  let totalOk = 0;
  let totalChanged = 0;
  let totalFailed = 0;
  let totalUnreachable = 0;

  for (const line of block.split("\n")) {
    const okMatch = line.match(/ok=(\d+)/);
    const changedMatch = line.match(/changed=(\d+)/);
    const failedMatch = line.match(/failed=(\d+)/);
    const unreachableMatch = line.match(/unreachable=(\d+)/);
    if (okMatch) totalOk += parseInt(okMatch[1] ?? "0", 10);
    if (changedMatch) totalChanged += parseInt(changedMatch[1] ?? "0", 10);
    if (failedMatch) totalFailed += parseInt(failedMatch[1] ?? "0", 10);
    if (unreachableMatch) totalUnreachable += parseInt(unreachableMatch[1] ?? "0", 10);
  }

  return { ok: totalOk, changed: totalChanged, failures: totalFailed, unreachable: totalUnreachable };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run an ansible-playbook.
 * playbook must be a relative path already validated by the caller.
 * hosts, extraVars, and vaultPasswordFile are optional.
 */
export async function runPlaybook(
  repoPath: string,
  playbook: string,
  opts: {
    hosts?: string[];
    extraVars?: Record<string, unknown>;
    vaultPasswordFile?: string;
  } = {}
): Promise<AnsibleResult> {
  const args: string[] = [playbook];

  if (opts.hosts && opts.hosts.length > 0) {
    // Each host is a separate comma-joined limit — passed as one argv element
    args.push("--limit", opts.hosts.join(","));
  }
  if (opts.vaultPasswordFile) {
    args.push("--vault-password-file", opts.vaultPasswordFile);
  }
  if (opts.extraVars) {
    args.push("--extra-vars", JSON.stringify(opts.extraVars));
  }

  try {
    const { stdout, stderr } = await _execFileAsync("ansible-playbook", args, {
      cwd: repoPath,
      timeout: 600_000,
    });
    const recap = parseRecap(stdout);
    return { ok: true, stdout, stderr, recap };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = e.stdout ?? "";
    const stderr = e.stderr ?? e.message ?? String(err);
    const recap = parseRecap(stdout);
    logger.warn("ansible-playbook exited with non-zero", { stderr });
    return { ok: false, stdout, stderr, recap };
  }
}

/**
 * Apply an Ansible role to a list of hosts by writing a transient playbook
 * to a temp file and running it.
 *
 * roleName must already match /^[a-z0-9_]+$/ — validated by caller.
 */
export async function applyRole(
  repoPath: string,
  role: string,
  hosts: string[],
  extraVars?: Record<string, unknown>,
  vaultPasswordFile?: string
): Promise<AnsibleResult> {
  // Build a transient playbook that applies the role to the hosts
  const limit = hosts.join(",");
  const playbookContent = [
    "---",
    `- hosts: ${limit}`,
    "  gather_facts: true",
    "  roles:",
    `    - ${role}`,
  ].join("\n") + "\n";

  const tmpFile = join(tmpdir(), `cmdly-role-${Date.now()}.yml`);
  await writeFile(tmpFile, playbookContent, "utf-8");

  try {
    return await runPlaybook(repoPath, tmpFile, { hosts, extraVars, vaultPasswordFile });
  } finally {
    await unlink(tmpFile).catch(() => {/* ignore cleanup errors */});
  }
}

/**
 * Run `git checkout <sha>` in the given repo path.
 * sha must already match /^[0-9a-fA-F]{7,40}$/ — validated by caller.
 */
export async function gitCheckout(
  repoPath: string,
  sha: string
): Promise<AnsibleResult> {
  try {
    const { stdout, stderr } = await _execFileAsync("git", ["checkout", sha], {
      cwd: repoPath,
      timeout: 60_000,
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

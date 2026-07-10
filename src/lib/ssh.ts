/**
 * SSH client — runs commands on infrastructure hosts through a bastion jump host.
 *
 * Security approach
 * -----------------
 * All user-supplied values (serviceName, logPath, pattern) are treated as
 * untrusted and passed through node-ssh's `exec(command, parameters)` API.
 * node-ssh internally shell-escapes each element via the `shell-escape` package,
 * producing a single safe command string that the SSH exec channel receives.
 * This avoids string interpolation of untrusted input entirely:
 *
 *   // Safe — node-ssh escapes each element in the args array
 *   await ssh.exec("systemctl", ["is-active", serviceName]);
 *
 * Additional constraints:
 *  - serviceName is validated against /^[A-Za-z0-9._@-]+$/ (tool schema).
 *  - logPath is required to start with "/" (tool schema) and must be
 *    non-empty with no null bytes.
 *  - grep is called with "-F" (fixed-string, no regex) so the pattern cannot
 *    inject metacharacters.
 *  - command + parameters are built as fixed strings + user arg in last slot.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NodeSSH } from "node-ssh";
import type { SSHExecCommandResponse } from "node-ssh";
import type { InfrastructureConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

// ─── Local execution (sshMode = "local") ─────────────────────────────────────

/**
 * Run a command directly on the CMDLY host via execFile — NO shell, so each
 * arg is passed literally (same injection-safety guarantee as node-ssh's
 * escaped exec). Used when sshMode is "local": there is no bastion and no
 * remote target; tools operate on this server. `vmHost` is ignored.
 *
 * execFile rejects on a non-zero exit code, but the rejection carries the
 * numeric code plus stdout/stderr — a normal outcome for e.g.
 * `systemctl is-active` on a stopped unit — so we translate it back into a
 * CommandResult rather than throwing. Spawn failures (ENOENT, …) do throw.
 */
async function runLocalCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (typeof e.code === "number") {
      return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
    // Spawn failure (command not found, timeout, …).
    throw err;
  }
}

// ─── Jump-host helper ────────────────────────────────────────────────────────

/**
 * Create a bastion→target SSH connection.
 * Returns the connected `target` NodeSSH and the `bastion` NodeSSH so the
 * caller can dispose both after use.
 *
 * Uses node-ssh's `forwardOut()` to create a direct-tcpip channel from the
 * bastion to the target host, then connects a second NodeSSH over that channel
 * using `sock`. This avoids direct ssh2 API surface and is fully typed through
 * node-ssh's type declarations.
 */
/** Subset of InfrastructureConfig that SSH functions actually read. */
type SshConfig = Pick<
  InfrastructureConfig,
  "sshMode" | "bastionHost" | "bastionPort" | "bastionUser" | "sshKeyPath"
>;

async function connectViaBastion(
  cfg: SshConfig,
  targetHost: string,
): Promise<{ bastion: NodeSSH; target: NodeSSH }> {
  const bastionPort = cfg.bastionPort ?? 22;

  // 1. Connect to bastion
  const bastion = new NodeSSH();
  await bastion.connect({
    host: cfg.bastionHost,
    port: bastionPort,
    username: cfg.bastionUser,
    privateKeyPath: cfg.sshKeyPath,
    readyTimeout: 10_000,
  });

  // 2. Open a direct-tcpip channel from bastion → targetHost:22
  //    bastion.forwardOut() is node-ssh's wrapper; it returns Promise<Channel>
  //    (typed via node-ssh's own typings). We don't reference ssh2 types directly.
  const channel = await bastion.forwardOut("127.0.0.1", 0, targetHost, 22);

  // 3. Connect to the target through the forwarded channel.
  //    node-ssh's Config extends ssh2's ConnectConfig which accepts a `sock`
  //    duplex stream — the Channel returned by forwardOut satisfies this.
  const target = new NodeSSH();
  await target.connect({
    sock: channel as unknown as import("node:stream").Duplex, // ssh2 Channel is a Duplex; no @types for ssh2
    username: cfg.bastionUser,
    privateKeyPath: cfg.sshKeyPath,
    readyTimeout: 10_000,
  });

  return { bastion, target };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a command on `host` through the configured bastion.
 *
 * `args` is an array of argument strings — each is individually shell-escaped
 * by node-ssh's `exec` before being sent to the SSH channel.
 */
export async function runCommand(
  cfg: SshConfig,
  host: string,
  command: string,
  args: string[],
): Promise<CommandResult> {
  // Local mode: execute on the CMDLY host itself, no SSH/bastion, host ignored.
  if (cfg.sshMode === "local") {
    return runLocalCommand(command, args);
  }

  const { bastion, target } = await connectViaBastion(cfg, host);
  try {
    const response: SSHExecCommandResponse = await target.exec(command, args, {
      stream: "both",
    });
    return {
      code: response.code ?? -1,
      stdout: response.stdout,
      stderr: response.stderr,
    };
  } finally {
    target.dispose();
    bastion.dispose();
  }
}

/**
 * Quick echo test through the bastion — used by the onboarding connection test.
 * Returns `{ ok, message }` and never throws.
 */
export async function testBastionConnection(
  cfg: SshConfig,
): Promise<{ ok: boolean; message: string }> {
  // Local mode: verify we can spawn a command on this host.
  if (cfg.sshMode === "local") {
    try {
      const result = await runLocalCommand("echo", ["ok"]);
      if (result.stdout.trim() === "ok") {
        logger.info("Local execution test OK");
        return { ok: true, message: "Exécution locale opérationnelle (sur le serveur CMDLY)" };
      }
      return { ok: false, message: `Réponse inattendue: ${result.stderr.trim() || "vide"}` };
    } catch (err) {
      logger.warn("Local execution test failed", { err: String(err) });
      return { ok: false, message: String(err) };
    }
  }

  if (!cfg.bastionHost) {
    return { ok: false, message: "bastionHost non configuré" };
  }

  try {
    const result = await runCommand(cfg, cfg.bastionHost, "echo", ["ok"]);
    if (result.stdout.trim() === "ok") {
      logger.info("SSH bastion test OK", { host: cfg.bastionHost });
      return { ok: true, message: `Bastion ${cfg.bastionHost} accessible` };
    }
    return {
      ok: false,
      message: `Réponse inattendue: ${result.stdout.trim() || result.stderr.trim()}`,
    };
  } catch (err) {
    logger.warn("SSH bastion test failed", { err: String(err) });
    return { ok: false, message: String(err) };
  }
}

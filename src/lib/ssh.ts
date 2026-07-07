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

import { NodeSSH } from "node-ssh";
import type { SSHExecCommandResponse } from "node-ssh";
import type { InfrastructureConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
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
async function connectViaBastion(
  cfg: InfrastructureConfig,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock: channel as any, // Channel is a Duplex; cast needed due to ssh2 lacking @types
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
  cfg: InfrastructureConfig,
  host: string,
  command: string,
  args: string[],
): Promise<CommandResult> {
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
  cfg: InfrastructureConfig,
): Promise<{ ok: boolean; message: string }> {
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

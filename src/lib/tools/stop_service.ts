/**
 * stop_service — stop a systemd service on a VM via SSH.
 *
 * Runs `systemctl stop <service>` via node-ssh exec() which shell-escapes
 * each argument — no string interpolation of untrusted input.
 *
 * CONFIRMATION REQUIRED (dialog only, no typed phrase).
 * Category: destroy — stopping a service is a destructive/disruptive action
 * and requires admin privileges.
 */

import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { runCommand } from "@/lib/ssh";
import type { CommandResult } from "@/lib/ssh";
import { vmHostSchema } from "./_shared";
import { logger } from "@/lib/logger";
import type { InfrastructureConfig } from "@/lib/config";

// ─── Injectable facade ─────────────────────────────────────────────────────────

type SshConfig = Pick<
  InfrastructureConfig,
  "sshMode" | "bastionHost" | "bastionPort" | "bastionUser" | "sshKeyPath"
>;

type RunCommandFn = (
  cfg: SshConfig,
  host: string,
  command: string,
  args: string[]
) => Promise<CommandResult>;

let _runCommand: RunCommandFn = runCommand;

/** Override the SSH runCommand function — for unit tests only. */
export function setRunCommandFn(f: RunCommandFn): void {
  _runCommand = f;
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  vmHost: vmHostSchema,
  serviceName: z
    .string()
    .regex(
      /^[A-Za-z0-9._@-]+$/,
      "serviceName must contain only letters, digits, ., _, @, -"
    ),
});

type StopServiceParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const stopService: Tool = {
  name: "stop_service",
  description:
    "Arrête un service systemd sur une VM via SSH (action destructive — nécessite une confirmation).",
  category: "destroy",
  requiredRole: "admin",
  parameters: paramsSchema,
  // Confirmation required (dialog only — no typed phrase needed).
  confirm: {},

  async execute(params, ctx) {
    const { vmHost, serviceName } = params as StopServiceParams;

    logger.info("stop_service: starting", { vmHost, serviceName });

    try {
      // node-ssh exec() shell-escapes each element in the args array.
      // serviceName regex ensures safe chars; exec() provides the escaping layer.
      const result = await _runCommand(ctx.config, vmHost, "systemctl", [
        "stop",
        serviceName,
      ]);

      if (result.code !== 0) {
        const errText = result.stderr.trim() || result.stdout.trim();
        logger.warn("stop_service: systemctl returned non-zero", {
          vmHost,
          serviceName,
          code: result.code,
          errText,
        });
        return {
          success: false,
          error: errText,
          humanReadable: `Échec de l'arrêt de "${serviceName}" sur ${vmHost} (code ${result.code}): ${errText}`,
        };
      }

      logger.info("stop_service: success", { vmHost, serviceName });

      return {
        success: true,
        data: { vmHost, serviceName, code: result.code },
        humanReadable: `Service "${serviceName}" arrêté avec succès sur ${vmHost}.`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("stop_service: SSH error", { vmHost, serviceName, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur SSH lors de l'arrêt de "${serviceName}" sur ${vmHost}: ${error}`,
      };
    }
  },
};

register(stopService);

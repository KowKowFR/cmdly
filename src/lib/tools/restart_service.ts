/**
 * restart_service — restart a systemd service on a VM via SSH.
 *
 * Runs `systemctl restart <service>` via node-ssh exec() which shell-escapes
 * each argument — no string interpolation of untrusted input.
 *
 * CONFIRMATION REQUIRED: registered in CONFIRM_REQUIRED (registry.ts).
 */

import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { runCommand } from "@/lib/ssh";
import { vmHostSchema } from "./_shared";
import { logger } from "@/lib/logger";

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

type RestartServiceParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const restartService: Tool = {
  name: "restart_service",
  description:
    "Redémarre un service systemd sur une VM via SSH (nécessite une confirmation).",
  category: "modify",
  requiredRole: "operator",
  parameters: paramsSchema,
  // Membership in CONFIRM_REQUIRED (registry.ts) is what gates execution.
  // No requireTyping needed for restart — confirmation dialog only.
  confirm: {},

  async execute(params, ctx) {
    const { vmHost, serviceName } = params as RestartServiceParams;

    logger.info("restart_service: starting", { vmHost, serviceName });

    try {
      // node-ssh exec() shell-escapes each element in the args array.
      // serviceName regex ensures safe chars; exec() provides the escaping layer.
      const result = await runCommand(ctx.config, vmHost, "systemctl", [
        "restart",
        serviceName,
      ]);

      if (result.code !== 0) {
        const errText = result.stderr.trim() || result.stdout.trim();
        logger.warn("restart_service: systemctl returned non-zero", {
          vmHost,
          serviceName,
          code: result.code,
          errText,
        });
        return {
          success: false,
          error: errText,
          humanReadable: `Échec du redémarrage de "${serviceName}" sur ${vmHost} (code ${result.code}): ${errText}`,
        };
      }

      logger.info("restart_service: success", { vmHost, serviceName });

      return {
        success: true,
        data: { vmHost, serviceName, code: result.code },
        humanReadable: `Service "${serviceName}" redémarré avec succès sur ${vmHost}.`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("restart_service: SSH error", { vmHost, serviceName, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur SSH lors du redémarrage de "${serviceName}" sur ${vmHost}: ${error}`,
      };
    }
  },
};

register(restartService);

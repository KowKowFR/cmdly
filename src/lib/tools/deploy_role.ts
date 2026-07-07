/**
 * deploy_role — apply an Ansible role to a list of hosts.
 *
 * Uses ansible.applyRole which writes a transient playbook and runs
 * ansible-playbook via execFile (no shell interpolation).
 */

import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { applyRole } from "@/lib/ansible";
import { vmHostSchema } from "./_shared";
import { logger } from "@/lib/logger";

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  role: z
    .string()
    .regex(/^[a-z0-9_]+$/, "role must contain only lowercase letters, digits, or underscores"),
  hosts: z.array(vmHostSchema).min(1, "at least one host is required"),
  extraVars: z.record(z.string(), z.unknown()).nullable().optional(),
});

type DeployRoleParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const deployRole: Tool = {
  name: "deploy_role",
  description:
    "Applique un rôle Ansible à une liste d'hôtes de l'infrastructure.",
  category: "modify",
  requiredRole: "operator",
  parameters: paramsSchema,

  async execute(params, ctx) {
    const { role, hosts, extraVars } = params as DeployRoleParams;
    const repoPath = ctx.config.infraRepoPath;
    const vaultPasswordFile = ctx.config.ansibleVaultPasswordFile || undefined;

    logger.info("deploy_role: starting", { role, hosts, repoPath });

    try {
      const result = await applyRole(
        repoPath,
        role,
        hosts,
        extraVars ?? undefined,
        vaultPasswordFile
      );

      const recapText = result.recap
        ? `ok=${result.recap.ok} changed=${result.recap.changed} failed=${result.recap.failures} unreachable=${result.recap.unreachable}`
        : "récapitulatif non disponible";

      if (!result.ok) {
        const summary = (result.stderr || result.stdout).slice(0, 500);
        logger.warn("deploy_role: ansible failed", { role, hosts, stderr: summary });
        return {
          success: false,
          error: result.stderr,
          humanReadable: `Échec du déploiement du rôle "${role}" sur ${hosts.join(", ")}.\nRécap: ${recapText}\n${summary}`,
        };
      }

      logger.info("deploy_role: success", { role, hosts });

      return {
        success: true,
        data: { role, hosts, recap: result.recap },
        humanReadable:
          `Rôle "${role}" appliqué avec succès sur: ${hosts.join(", ")}.\n` +
          `Récapitulatif: ${recapText}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("deploy_role: unexpected error", { role, hosts, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur inattendue lors du déploiement du rôle "${role}": ${error}`,
      };
    }
  },
};

register(deployRole);

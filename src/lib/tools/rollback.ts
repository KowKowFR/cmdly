/**
 * rollback — git checkout to a specific commit SHA then re-run site.yml.
 *
 * CONFIRMATION REQUIRED: registered in CONFIRM_REQUIRED (registry.ts).
 *
 * Uses gitCheckout() and runPlaybook() from ansible.ts — both use execFile
 * with argv arrays (no shell interpolation).
 */

import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { gitCheckout, runPlaybook } from "@/lib/ansible";
import { logger } from "@/lib/logger";

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  commitSha: z
    .string()
    .regex(
      /^[0-9a-fA-F]{7,40}$/,
      "commitSha must be a hex string of 7–40 characters"
    ),
});

type RollbackParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const rollback: Tool = {
  name: "rollback",
  description:
    "Revient à un commit git spécifique puis ré-exécute site.yml (nécessite une confirmation).",
  category: "modify",
  requiredRole: "operator",
  parameters: paramsSchema,
  // Membership in CONFIRM_REQUIRED (registry.ts) is what gates execution.
  // No requireTyping needed — confirmation dialog only.
  confirm: {},

  async execute(params, ctx) {
    const { commitSha } = params as RollbackParams;
    const repoPath = ctx.config.infraRepoPath;
    const vaultPasswordFile = ctx.config.ansibleVaultPasswordFile || undefined;

    logger.info("rollback: starting", { commitSha, repoPath });

    try {
      // 1. git checkout <sha> — sha validated by Zod schema
      const checkoutResult = await gitCheckout(repoPath, commitSha);
      if (!checkoutResult.ok) {
        const summary = checkoutResult.stderr.slice(0, 400);
        logger.warn("rollback: git checkout failed", { commitSha, stderr: summary });
        return {
          success: false,
          error: checkoutResult.stderr,
          humanReadable: `Échec du checkout vers "${commitSha}":\n${summary}`,
        };
      }

      logger.info("rollback: git checkout done", { commitSha });

      // 2. Re-run site.yml
      const playbookResult = await runPlaybook(repoPath, "site.yml", {
        vaultPasswordFile,
      });

      const recapText = playbookResult.recap
        ? `ok=${playbookResult.recap.ok} changed=${playbookResult.recap.changed} failed=${playbookResult.recap.failures} unreachable=${playbookResult.recap.unreachable}`
        : "récapitulatif non disponible";

      if (!playbookResult.ok) {
        const summary = (playbookResult.stderr || playbookResult.stdout).slice(0, 500);
        logger.warn("rollback: site.yml failed", { commitSha, stderr: summary });
        return {
          success: false,
          error: playbookResult.stderr,
          humanReadable:
            `Checkout vers "${commitSha}" réussi, mais site.yml a échoué.\n` +
            `Récap: ${recapText}\n${summary}`,
        };
      }

      logger.info("rollback: success", { commitSha });

      return {
        success: true,
        data: { commitSha, recap: playbookResult.recap },
        humanReadable:
          `Rollback vers "${commitSha}" effectué avec succès.\n` +
          `site.yml exécuté — Récapitulatif: ${recapText}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("rollback: unexpected error", { commitSha, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur inattendue lors du rollback vers "${commitSha}": ${error}`,
      };
    }
  },
};

register(rollback);

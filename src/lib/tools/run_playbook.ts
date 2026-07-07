/**
 * run_playbook — execute an Ansible playbook from the infra repo.
 *
 * playbookPath must be a relative path within the repo (no leading '/', no '..').
 * The path is resolved against infraRepoPath and validated for traversal.
 */

import { z } from "zod";
import { resolve, join, relative } from "node:path";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { runPlaybook as ansibleRunPlaybook } from "@/lib/ansible";
import { logger } from "@/lib/logger";

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  playbookPath: z
    .string()
    .min(1)
    .refine(
      (p) => !p.startsWith("/") && !p.includes(".."),
      "playbookPath must be a relative path within the repo (no leading /, no ..)"
    ),
});

type RunPlaybookParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const runPlaybookTool: Tool = {
  name: "run_playbook",
  description:
    "Exécute un playbook Ansible depuis le dépôt d'infrastructure.",
  category: "modify",
  requiredRole: "operator",
  parameters: paramsSchema,

  async execute(params, ctx) {
    const { playbookPath } = params as RunPlaybookParams;
    const repoPath = ctx.config.infraRepoPath;
    const vaultPasswordFile = ctx.config.ansibleVaultPasswordFile || undefined;

    // Resolve and verify the path stays inside repoPath (path traversal guard)
    const resolvedRepo = resolve(repoPath);
    const resolvedPlaybook = resolve(join(resolvedRepo, playbookPath));
    const rel = relative(resolvedRepo, resolvedPlaybook);

    // After resolve+relative normalization, startsWith("..") is sufficient to
    // detect any attempt to escape the repo dir — resolve() always returns an
    // absolute path so `resolve(rel) === rel` was always false and is removed.
    if (rel.startsWith("..")) {
      logger.warn("run_playbook: path traversal attempt", { playbookPath });
      return {
        success: false,
        error: "path traversal detected",
        humanReadable: `Chemin de playbook invalide: "${playbookPath}" est hors du dépôt.`,
      };
    }

    logger.info("run_playbook: starting", { playbookPath, repoPath });

    try {
      const result = await ansibleRunPlaybook(repoPath, playbookPath, {
        vaultPasswordFile,
      });

      const recapText = result.recap
        ? `ok=${result.recap.ok} changed=${result.recap.changed} failed=${result.recap.failures} unreachable=${result.recap.unreachable}`
        : "récapitulatif non disponible";

      if (!result.ok) {
        const summary = (result.stderr || result.stdout).slice(0, 500);
        logger.warn("run_playbook: failed", { playbookPath, stderr: summary });
        return {
          success: false,
          error: result.stderr,
          humanReadable: `Échec du playbook "${playbookPath}".\nRécap: ${recapText}\n${summary}`,
        };
      }

      logger.info("run_playbook: success", { playbookPath });

      return {
        success: true,
        data: { playbookPath, recap: result.recap },
        humanReadable:
          `Playbook "${playbookPath}" exécuté avec succès.\n` +
          `Récapitulatif: ${recapText}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("run_playbook: unexpected error", { playbookPath, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur inattendue lors de l'exécution du playbook "${playbookPath}": ${error}`,
      };
    }
  },
};

register(runPlaybookTool);

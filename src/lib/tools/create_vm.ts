/**
 * create_vm — provision a new VM via Terraform.
 *
 * Writes a cmdly.auto.tfvars file from the validated params, then runs
 * terraform plan + apply. All CLI calls go through the terraform module
 * (which uses execFile with argv arrays — no shell interpolation).
 *
 * The terraform facade is injectable for unit tests.
 */

import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { logger } from "@/lib/logger";
import * as tf from "@/lib/terraform";

// ─── Injectable facade ────────────────────────────────────────────────────────

export interface TerraformFacade {
  writeTfvars: typeof tf.writeTfvars;
  plan: typeof tf.plan;
  apply: typeof tf.apply;
}

let _facade: TerraformFacade = tf;

/** Override the terraform facade — for unit tests only. */
export function setTerraformFacade(f: TerraformFacade): void {
  _facade = f;
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, "name must contain only lowercase letters, digits, or hyphens"),
  vlan: z.enum(["mgt", "srv", "dmz"]),
  memory: z.number().int().min(256),
  cores: z.number().int().min(1),
  disk: z.number().int().min(1),
});

type CreateVmParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const createVm: Tool = {
  name: "create_vm",
  description:
    "Provisionne une nouvelle VM dans l'infrastructure via Terraform (écrit les tfvars, lance plan + apply).",
  category: "modify",
  requiredRole: "operator",
  parameters: paramsSchema,

  async execute(params, ctx) {
    const { name, vlan, memory, cores, disk } = params as CreateVmParams;
    const repoPath = ctx.config.infraRepoPath;

    logger.info("create_vm: starting", { name, vlan, memory, cores, disk, repoPath });

    try {
      // 1. Write tfvars
      await _facade.writeTfvars(repoPath, {
        vm_name: name,
        vm_vlan: vlan,
        vm_memory: memory,
        vm_cores: cores,
        vm_disk: disk,
      });

      // Proxmox provider credentials, injected via env (never written to disk).
      const env = tf.proxmoxEnv(ctx.config);

      // 2. Plan
      const planResult = await _facade.plan(repoPath, env);
      if (!planResult.ok) {
        const summary = planResult.stderr.slice(0, 500);
        logger.warn("create_vm: terraform plan failed", { name, stderr: summary });
        return {
          success: false,
          error: planResult.stderr,
          humanReadable: `Échec du plan Terraform pour la VM "${name}":\n${summary}`,
        };
      }

      // 3. Apply
      const applyResult = await _facade.apply(repoPath, env);
      if (!applyResult.ok) {
        const summary = applyResult.stderr.slice(0, 500);
        logger.warn("create_vm: terraform apply failed", { name, stderr: summary });
        return {
          success: false,
          error: applyResult.stderr,
          humanReadable: `Échec de l'application Terraform pour la VM "${name}":\n${summary}`,
        };
      }

      const outputSummary = applyResult.stdout.slice(0, 800);
      logger.info("create_vm: success", { name });

      return {
        success: true,
        data: { name, vlan, memory, cores, disk },
        humanReadable:
          `VM "${name}" créée avec succès (VLAN: ${vlan}, RAM: ${memory} MB, ` +
          `CPU: ${cores} cœurs, Disque: ${disk} GB).\n` +
          `Résultat Terraform:\n${outputSummary}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("create_vm: unexpected error", { name, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur inattendue lors de la création de la VM "${name}": ${error}`,
      };
    }
  },
};

register(createVm);

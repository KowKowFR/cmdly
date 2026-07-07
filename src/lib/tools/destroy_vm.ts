/**
 * destroy_vm — destroy a VM via Terraform.
 *
 * CONFIRMATION REQUIRED with TYPED confirmation (user must type the VM name).
 *
 * Target address limitation: the terraform resource address is constructed as
 * `proxmox_vm_qemu.<name>` where <name> is the VM's name from Proxmox. This
 * assumes the infra repo names its resources `proxmox_vm_qemu.<vmname>`. If the
 * VM name contains characters outside [a-z0-9-] the tool refuses to construct
 * the target and returns an error asking the admin to destroy via the repo
 * directly. If VM name cannot be resolved, vmid (as string) is used as fallback
 * for the typed confirmation — but the terraform target will also be refused in
 * that case unless the fallback happens to be a safe identifier.
 *
 * Security: all terraform args are passed as separate argv elements (no shell
 * interpolation). VM name used in the target is validated against /^[a-z0-9-]+$/.
 */

import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { logger } from "@/lib/logger";
import { ProxmoxClient } from "@/lib/proxmox";
import type { ProxmoxVm, FetchFn } from "@/lib/proxmox";
import type { InfrastructureConfig } from "@/lib/config";
import * as tf from "@/lib/terraform";

// ─── Injectable facades ────────────────────────────────────────────────────────

interface VmLister {
  listVms(): Promise<ProxmoxVm[]>;
}

type ClientFactory = (cfg: InfrastructureConfig, fetchFn?: FetchFn) => VmLister;

let _clientFactory: ClientFactory = (cfg) => new ProxmoxClient(cfg);

/** Override the ProxmoxClient factory — for unit tests only. */
export function setClientFactory(f: ClientFactory): void {
  _clientFactory = f;
}

export interface TerraformFacade {
  destroy: typeof tf.destroy;
}

let _terraform: TerraformFacade = tf;

/** Override the terraform facade — for unit tests only. */
export function setTerraformFacade(f: TerraformFacade): void {
  _terraform = f;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safe terraform identifier: only lowercase letters, digits, and hyphens. */
const SAFE_NAME_RE = /^[a-z0-9-]+$/;

async function resolveVmName(
  vmid: number,
  cfg: InfrastructureConfig
): Promise<string> {
  try {
    const client = _clientFactory(cfg);
    const vms = await client.listVms();
    const vm = vms.find((v) => v.vmid === vmid);
    if (vm?.name) {
      return vm.name;
    }
  } catch (err) {
    logger.warn("destroy_vm: could not resolve VM name from Proxmox", {
      vmid,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  // Fallback: use the vmid string so typing confirmation still works.
  return String(vmid);
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  vmid: z.number().int().positive(),
});

type DestroyVmParams = z.infer<typeof paramsSchema>;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const destroyVm: Tool = {
  name: "destroy_vm",
  description:
    "Détruit une VM Proxmox via Terraform (irréversible — nécessite de saisir le nom de la VM).",
  category: "destroy",
  requiredRole: "admin",
  parameters: paramsSchema,

  confirm: {
    async requireTyping(params, ctx) {
      const { vmid } = params as DestroyVmParams;
      const name = await resolveVmName(vmid, ctx.config);
      return name;
    },
  },

  async execute(params, ctx) {
    const { vmid } = params as DestroyVmParams;
    const repoPath = ctx.config.infraRepoPath;

    logger.info("destroy_vm: starting", { vmid, repoPath });

    // Resolve VM name for the terraform target
    const name = await resolveVmName(vmid, ctx.config);

    if (!SAFE_NAME_RE.test(name)) {
      logger.warn("destroy_vm: VM name not safe for terraform target", {
        vmid,
        name,
      });
      return {
        success: false,
        error: `Le nom de la VM "${name}" contient des caractères non autorisés dans une adresse Terraform.`,
        humanReadable:
          `Impossible de construire une cible Terraform pour la VM #${vmid} (nom: "${name}"). ` +
          `Le nom doit correspondre à [a-z0-9-]. Veuillez détruire cette VM manuellement depuis le dépôt Terraform.`,
      };
    }

    const targetAddress = `proxmox_vm_qemu.${name}`;
    logger.info("destroy_vm: terraform destroy", { vmid, name, targetAddress });

    try {
      const result = await _terraform.destroy(repoPath, targetAddress);

      if (!result.ok) {
        const summary = result.stderr.slice(0, 500);
        logger.warn("destroy_vm: terraform destroy failed", {
          vmid,
          name,
          stderr: summary,
        });
        return {
          success: false,
          error: result.stderr,
          humanReadable:
            `Échec de la destruction de la VM "${name}" (#${vmid}):\n${summary}`,
        };
      }

      const outputSummary = result.stdout.slice(0, 800);
      logger.info("destroy_vm: success", { vmid, name });

      return {
        success: true,
        data: { vmid, name, targetAddress },
        humanReadable:
          `VM "${name}" (#${vmid}) détruite avec succès.\n` +
          `Résultat Terraform:\n${outputSummary}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("destroy_vm: unexpected error", { vmid, name, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur inattendue lors de la destruction de la VM "${name}" (#${vmid}): ${error}`,
      };
    }
  },
};

register(destroyVm);

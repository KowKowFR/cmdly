import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { runCommand } from "@/lib/ssh";

export const serviceStatus: Tool = {
  name: "service_status",
  description:
    "Vérifie si un service systemd est actif sur une VM de l'infrastructure via le bastion SSH.",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({
    vmHost: z.string().min(1),
    // Restrict serviceName to safe characters only (validated here + Zod schema).
    // This prevents shell injection via the systemctl arg.
    serviceName: z
      .string()
      .regex(
        /^[A-Za-z0-9._@-]+$/,
        "serviceName must contain only letters, digits, ., _, @, -",
      ),
  }),

  async execute(params, ctx) {
    const { vmHost, serviceName } = params as {
      vmHost: string;
      serviceName: string;
    };

    try {
      // node-ssh exec() shell-escapes each element in the args array via
      // shell-escape, so serviceName is never interpolated into a raw string.
      const result = await runCommand(ctx.config, vmHost, "systemctl", [
        "is-active",
        serviceName,
      ]);

      const active = result.stdout.trim() === "active";
      const stateText = result.stdout.trim() || result.stderr.trim() || "unknown";

      return {
        success: true,
        data: { serviceName, vmHost, state: stateText, active },
        humanReadable: `Service "${serviceName}" sur ${vmHost}: ${stateText}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, humanReadable: `Erreur SSH: ${error}` };
    }
  },
};

register(serviceStatus);

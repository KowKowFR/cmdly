import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { runCommand } from "@/lib/ssh";
import { vmHostSchema } from "./_shared";

export const analyzeLog: Tool = {
  name: "analyze_log",
  description:
    "Recherche un motif dans un fichier de log sur une VM via SSH (grep en mode texte fixe, sans regex).",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({
    vmHost: vmHostSchema,
    /** Must be an absolute path — enforced by Zod and rejected on empty/null-byte. */
    logPath: z.string().startsWith("/").min(2),
    /** Searched as a literal fixed string (grep -F), not a regex. */
    pattern: z.string().min(1),
  }),

  async execute(params, ctx) {
    const { vmHost, logPath, pattern } = params as {
      vmHost: string;
      logPath: string;
      pattern: string;
    };

    // Guard: reject logPath with null bytes or path traversal components
    if (logPath.includes("\0") || logPath.split("/").includes("..")) {
      return {
        success: false,
        error: "logPath invalide",
        humanReadable: "Erreur: logPath contient des composants non autorisés.",
      };
    }

    try {
      // Count matches first (-c flag).
      // Using exec(command, args) ensures the pattern is shell-escaped by
      // node-ssh and passed as a separate argv slot — never string-interpolated.
      // -F disables regex interpretation so pattern metacharacters are harmless.
      const countResult = await runCommand(ctx.config, vmHost, "grep", [
        "-F",
        "-c",
        pattern,
        logPath,
      ]);

      const matchCount = parseInt(countResult.stdout.trim(), 10) || 0;

      // Retrieve a sample of matching lines (up to 20).
      const sampleResult = await runCommand(ctx.config, vmHost, "grep", [
        "-F",
        "-m",
        "20",
        pattern,
        logPath,
      ]);

      const sampleLines = sampleResult.stdout
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);

      const humanReadable = [
        `Fichier: ${logPath} sur ${vmHost}`,
        `Motif "${pattern}": ${matchCount} occurrence(s)`,
        sampleLines.length > 0
          ? `\nExtraits (max 20 lignes):\n${sampleLines.map((l) => `  ${l}`).join("\n")}`
          : "  (aucune ligne correspondante)",
      ].join("\n");

      return {
        success: true,
        data: { matchCount, sampleLines },
        humanReadable,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, humanReadable: `Erreur SSH/grep: ${error}` };
    }
  },
};

register(analyzeLog);

/**
 * generate_role — generate an Ansible role skeleton using the configured LLM.
 *
 * Calls the LLM provider (chatStream) to generate role files, writes them to
 * <repoPath>/roles/<roleName>/, and returns a summary. Does NOT auto-commit.
 *
 * roleName is validated against /^[a-z0-9_]+$/ to prevent path traversal.
 */

import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { getProvider } from "@/lib/llm";
import type { LLMProvider } from "@/types/llm";
import { logger } from "@/lib/logger";

// ─── Parameter schema ─────────────────────────────────────────────────────────

const paramsSchema = z.object({
  roleName: z
    .string()
    .regex(
      /^[a-z0-9_]+$/,
      "roleName must contain only lowercase letters, digits, or underscores"
    ),
  description: z.string().min(1, "description is required"),
});

type GenerateRoleParams = z.infer<typeof paramsSchema>;

// ─── LLM prompt ───────────────────────────────────────────────────────────────

function buildPrompt(roleName: string, description: string): string {
  return `Generate a minimal Ansible role skeleton for a role named "${roleName}".
Description: ${description}

Output exactly 4 files with their content, in this format:
=== tasks/main.yml ===
<content>
=== defaults/main.yml ===
<content>
=== handlers/main.yml ===
<content>
=== README.md ===
<content>

Keep each file concise and functional. Use best practices.`;
}

// ─── File parser ──────────────────────────────────────────────────────────────

interface RoleFile {
  path: string;
  content: string;
}

function parseRoleFiles(text: string): RoleFile[] {
  const files: RoleFile[] = [];
  const sections = text.split(/^=== (.+?) ===$\n?/m);

  // sections is: ["preamble", "filename1", "content1", "filename2", "content2", ...]
  for (let i = 1; i < sections.length - 1; i += 2) {
    const path = (sections[i] ?? "").trim();
    const content = (sections[i + 1] ?? "").trim();
    if (path) {
      files.push({ path, content });
    }
  }

  return files;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const generateRole: Tool = {
  name: "generate_role",
  description:
    "Génère un squelette de rôle Ansible via le LLM et écrit les fichiers dans le dépôt infra (ne commit pas automatiquement).",
  category: "modify",
  requiredRole: "operator",
  parameters: paramsSchema,

  async execute(params, ctx) {
    const { roleName, description } = params as GenerateRoleParams;
    const repoPath = ctx.config.infraRepoPath;

    // Guard against path traversal: roleName must be alphanumeric+underscore only
    // (already enforced by regex), but double-check the resolved path stays inside roles/
    const rolesBase = resolve(join(repoPath, "roles"));
    const roleDir = resolve(join(rolesBase, roleName));
    const rel = relative(rolesBase, roleDir);
    if (rel.startsWith("..") || rel.includes("/")) {
      return {
        success: false,
        error: "path traversal detected in roleName",
        humanReadable: `Nom de rôle invalide: "${roleName}".`,
      };
    }

    logger.info("generate_role: calling LLM", { roleName });

    const providerName = (ctx.config.defaultLlmProvider || "openai") as
      | "openai"
      | "anthropic"
      | "ollama";

    let provider: LLMProvider;
    try {
      provider = getProvider(providerName, ctx.config);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error,
        humanReadable: `Fournisseur LLM non disponible: ${error}`,
      };
    }

    const model =
      providerName === "openai"
        ? ctx.config.openaiModel || "gpt-4o-mini"
        : providerName === "anthropic"
          ? ctx.config.anthropicModel || "claude-3-haiku-20240307"
          : ctx.config.ollamaModel || "llama3";

    let fullText = "";
    try {
      const stream = provider.chatStream({
        model,
        messages: [
          {
            role: "user",
            content: buildPrompt(roleName, description),
          },
        ],
        tools: [],
      });

      for await (const event of stream) {
        if (event.type === "token") {
          fullText += event.content;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("generate_role: LLM error", { roleName, error });
      return {
        success: false,
        error,
        humanReadable: `Erreur LLM lors de la génération du rôle "${roleName}": ${error}`,
      };
    }

    // Parse and write the files
    const roleFiles = parseRoleFiles(fullText);

    if (roleFiles.length === 0) {
      logger.warn("generate_role: no files parsed from LLM response", { roleName });
      return {
        success: false,
        error: "no files parsed from LLM response",
        humanReadable:
          `Le LLM n'a pas retourné de fichiers reconnaissables pour le rôle "${roleName}".`,
      };
    }

    const writtenPaths: string[] = [];

    for (const file of roleFiles) {
      // Validate each sub-path: no absolute paths, no traversal
      if (file.path.startsWith("/") || file.path.includes("..")) {
        logger.warn("generate_role: skipping suspicious file path", { path: file.path });
        continue;
      }
      const targetPath = join(roleDir, file.path);
      const parentDir = join(targetPath, "..");
      await mkdir(parentDir, { recursive: true });
      await writeFile(targetPath, file.content + "\n", "utf-8");
      writtenPaths.push(`roles/${roleName}/${file.path}`);
    }

    logger.info("generate_role: files written", { roleName, writtenPaths });

    return {
      success: true,
      data: { roleName, files: writtenPaths },
      humanReadable:
        `Rôle Ansible "${roleName}" généré avec succès.\n` +
        `Fichiers créés:\n` +
        writtenPaths.map((p) => `  - ${p}`).join("\n") +
        `\n\nPour valider, exécutez:\n  git add roles/${roleName}\n  git commit -m "feat: add role ${roleName}"`,
    };
  },
};

register(generateRole);

import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nonempty = (msg: string) => z.string().min(1, msg);
const passthrough = z.object({}).passthrough();

// ─── Step 1 — Welcome (no inputs) ────────────────────────────────────────────

const step1Schema = passthrough;

// ─── Step 2 — Admin account ───────────────────────────────────────────────────

const step2Schema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  password: z
    .string()
    .min(12, "Minimum 12 caractères")
    .regex(/[A-Z]/, "Au moins une majuscule requise")
    .regex(/[a-z]/, "Au moins une minuscule requise")
    .regex(/[0-9]/, "Au moins un chiffre requis"),
  name: nonempty("Nom requis"),
});

// ─── Step 3 — Proxmox ─────────────────────────────────────────────────────────

const step3Schema = z.object({
  proxmoxHost: nonempty("Hôte Proxmox requis"),
  proxmoxPort: z.coerce.number().int().min(1).max(65535).default(8006),
  proxmoxUser: nonempty("Utilisateur Proxmox requis (ex: root@pam)"),
  proxmoxTokenId: nonempty("Token ID requis"),
  proxmoxTokenSecret: nonempty("Token secret requis"),
  proxmoxNode: nonempty("Nœud Proxmox requis"),
});

// ─── Step 4 — Infra repo (discriminated union) ────────────────────────────────

const step4Schema = z.discriminatedUnion("infraRepoType", [
  z.object({
    infraRepoType: z.literal("local"),
    infraRepoPath: nonempty("Chemin requis"),
  }),
  z.object({
    infraRepoType: z.literal("git"),
    infraRepoGitUrl: z.string().url("URL Git invalide"),
    infraRepoGitBranch: z.string().min(1).default("main"),
  }),
]);

// ─── Step 5 — SSH / Bastion ───────────────────────────────────────────────────

const step5Schema = z.object({
  bastionHost: nonempty("Hôte bastion requis"),
  bastionPort: z.coerce.number().int().min(1).max(65535).default(22),
  bastionUser: nonempty("Utilisateur SSH requis"),
  sshKeyPath: nonempty("Chemin de la clé SSH requis"),
});

// ─── Step 6 — Ansible Vault ───────────────────────────────────────────────────

const step6Schema = z.object({
  ansibleVaultPasswordFile: nonempty("Chemin du fichier de mot de passe vault requis"),
});

// ─── Step 7 — LLM provider ───────────────────────────────────────────────────

const step7Schema = z.discriminatedUnion("defaultLlmProvider", [
  z.object({
    defaultLlmProvider: z.literal("openai"),
    openaiApiKey: nonempty("Clé API OpenAI requise"),
    openaiModel: z.string().min(1).default("gpt-4o"),
  }),
  z.object({
    defaultLlmProvider: z.literal("anthropic"),
    anthropicApiKey: nonempty("Clé API Anthropic requise"),
    anthropicModel: z.string().min(1).default("claude-opus-4-5"),
  }),
  z.object({
    defaultLlmProvider: z.literal("ollama"),
    ollamaBaseUrl: nonempty("URL Ollama requise"),
    ollamaModel: z.string().min(1).default("llama3"),
  }),
]);

// ─── Step 8 — Zabbix (optional) ───────────────────────────────────────────────

const step8Schema = z.object({
  zabbixUrl: z.string().optional(),
  zabbixUser: z.string().optional(),
  zabbixPassword: z.string().optional(),
});

// ─── Step 9 — Wazuh (optional) ────────────────────────────────────────────────

const step9Schema = z.object({
  wazuhUrl: z.string().optional(),
  wazuhUser: z.string().optional(),
  wazuhPassword: z.string().optional(),
});

// ─── Step 10 — LDAP ──────────────────────────────────────────────────────────

const step10Schema = z
  .object({
    ldapEnabled: z.boolean(),
    ldapUrl: z.string().optional(),
    ldapBindDn: z.string().optional(),
    ldapBindPassword: z.string().optional(),
    ldapBaseDn: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ldapEnabled) {
      if (!data.ldapUrl) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL LDAP requise", path: ["ldapUrl"] });
      }
      if (!data.ldapBindDn) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Bind DN requis", path: ["ldapBindDn"] });
      }
      if (!data.ldapBindPassword) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mot de passe Bind requis", path: ["ldapBindPassword"] });
      }
      if (!data.ldapBaseDn) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Base DN requis", path: ["ldapBaseDn"] });
      }
    }
  });

// ─── Step 11 — Summary (no input validation) ──────────────────────────────────

const step11Schema = passthrough;

// ─── Step 12 — Done (no input validation) ────────────────────────────────────

const step12Schema = passthrough;

// ─── Export ───────────────────────────────────────────────────────────────────

export const onboardingSchemas: Record<number, z.ZodTypeAny> = {
  1: step1Schema,
  2: step2Schema,
  3: step3Schema,
  4: step4Schema,
  5: step5Schema,
  6: step6Schema,
  7: step7Schema,
  8: step8Schema,
  9: step9Schema,
  10: step10Schema,
  11: step11Schema,
  12: step12Schema,
};

export type Step2Data = z.infer<typeof step2Schema>;
export type Step3Data = z.infer<typeof step3Schema>;
export type Step4Data = z.infer<typeof step4Schema>;
export type Step5Data = z.infer<typeof step5Schema>;
export type Step7Data = z.infer<typeof step7Schema>;

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { infrastructureConfig } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

// ─── Decrypted shape exposed to the rest of the app ──────────────────────────

export interface InfrastructureConfig {
  // Proxmox
  proxmoxHost: string;
  proxmoxPort: number | null;
  proxmoxUser: string;
  proxmoxTokenId: string;
  proxmoxTokenSecret: string; // decrypted; stored as proxmoxTokenSecretEncrypted
  proxmoxNode: string;
  // Infra repo
  infraRepoType: string;
  infraRepoPath: string;
  infraRepoGitUrl: string;
  infraRepoGitBranch: string;
  // SSH / bastion
  sshMode: "bastion" | "local"; // "local" runs tool commands on the CMDLY host
  sshKeyPath: string;
  bastionHost: string;
  bastionPort: number | null;
  bastionUser: string;
  ansibleVaultPasswordFile: string;
  // Zabbix
  zabbixUrl: string;
  zabbixUser: string;
  zabbixPassword: string; // decrypted; stored as zabbixPasswordEncrypted
  // Wazuh
  wazuhUrl: string;
  wazuhUser: string;
  wazuhPassword: string; // decrypted; stored as wazuhPasswordEncrypted
  // LDAP
  ldapEnabled: boolean;
  ldapUrl: string;
  ldapBindDn: string;
  ldapBindPassword: string; // decrypted; stored as ldapBindPasswordEncrypted
  ldapBaseDn: string;
  // LLM
  defaultLlmProvider: string;
  openaiApiKey: string; // decrypted; stored as openaiApiKeyEncrypted
  openaiModel: string;
  anthropicApiKey: string; // decrypted; stored as anthropicApiKeyEncrypted
  anthropicModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  // Meta
  onboardingCompleted: boolean;
}

// ─── Secret field map: plain name → encrypted column name (Drizzle camelCase) ─

export const SECRET_FIELDS = {
  proxmoxTokenSecret: "proxmoxTokenSecretEncrypted",
  zabbixPassword: "zabbixPasswordEncrypted",
  wazuhPassword: "wazuhPasswordEncrypted",
  ldapBindPassword: "ldapBindPasswordEncrypted",
  openaiApiKey: "openaiApiKeyEncrypted",
  anthropicApiKey: "anthropicApiKeyEncrypted",
} as const satisfies Record<string, keyof typeof infrastructureConfig.$inferSelect>;

type SecretPlainKey = keyof typeof SECRET_FIELDS;
type SecretEncKey = (typeof SECRET_FIELDS)[SecretPlainKey];

// ─── Default config when row is absent ───────────────────────────────────────

const DEFAULT_CONFIG: InfrastructureConfig = {
  proxmoxHost: "",
  proxmoxPort: null,
  proxmoxUser: "",
  proxmoxTokenId: "",
  proxmoxTokenSecret: "",
  proxmoxNode: "",
  infraRepoType: "",
  infraRepoPath: "",
  infraRepoGitUrl: "",
  infraRepoGitBranch: "",
  sshMode: "bastion",
  sshKeyPath: "",
  bastionHost: "",
  bastionPort: null,
  bastionUser: "",
  ansibleVaultPasswordFile: "",
  zabbixUrl: "",
  zabbixUser: "",
  zabbixPassword: "",
  wazuhUrl: "",
  wazuhUser: "",
  wazuhPassword: "",
  ldapEnabled: false,
  ldapUrl: "",
  ldapBindDn: "",
  ldapBindPassword: "",
  ldapBaseDn: "",
  defaultLlmProvider: "",
  openaiApiKey: "",
  openaiModel: "",
  anthropicApiKey: "",
  anthropicModel: "",
  ollamaBaseUrl: "",
  ollamaModel: "",
  onboardingCompleted: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeDecrypt(ciphertext: string | null, field: string): string {
  if (!ciphertext) return "";
  try {
    return decrypt(ciphertext);
  } catch (err) {
    logger.error("Failed to decrypt field", { field, err: String(err) });
    return "";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the singleton row (id=1) and return a fully-decrypted InfrastructureConfig.
 * Returns sane defaults if the row does not yet exist.
 */
export async function getConfig(): Promise<InfrastructureConfig> {
  const rows = await db
    .select()
    .from(infrastructureConfig)
    .where(eq(infrastructureConfig.id, 1));

  if (rows.length === 0) return { ...DEFAULT_CONFIG };

  const row = rows[0]!;

  return {
    proxmoxHost: row.proxmoxHost ?? "",
    proxmoxPort: row.proxmoxPort ?? null,
    proxmoxUser: row.proxmoxUser ?? "",
    proxmoxTokenId: row.proxmoxTokenId ?? "",
    proxmoxTokenSecret: safeDecrypt(row.proxmoxTokenSecretEncrypted, "proxmoxTokenSecret"),
    proxmoxNode: row.proxmoxNode ?? "",
    infraRepoType: row.infraRepoType ?? "",
    infraRepoPath: row.infraRepoPath ?? "",
    infraRepoGitUrl: row.infraRepoGitUrl ?? "",
    infraRepoGitBranch: row.infraRepoGitBranch ?? "",
    sshMode: row.sshMode === "local" ? "local" : "bastion",
    sshKeyPath: row.sshKeyPath ?? "",
    bastionHost: row.bastionHost ?? "",
    bastionPort: row.bastionPort ?? null,
    bastionUser: row.bastionUser ?? "",
    ansibleVaultPasswordFile: row.ansibleVaultPasswordFile ?? "",
    zabbixUrl: row.zabbixUrl ?? "",
    zabbixUser: row.zabbixUser ?? "",
    zabbixPassword: safeDecrypt(row.zabbixPasswordEncrypted, "zabbixPassword"),
    wazuhUrl: row.wazuhUrl ?? "",
    wazuhUser: row.wazuhUser ?? "",
    wazuhPassword: safeDecrypt(row.wazuhPasswordEncrypted, "wazuhPassword"),
    ldapEnabled: row.ldapEnabled ?? false,
    ldapUrl: row.ldapUrl ?? "",
    ldapBindDn: row.ldapBindDn ?? "",
    ldapBindPassword: safeDecrypt(row.ldapBindPasswordEncrypted, "ldapBindPassword"),
    ldapBaseDn: row.ldapBaseDn ?? "",
    defaultLlmProvider: row.defaultLlmProvider ?? "",
    openaiApiKey: safeDecrypt(row.openaiApiKeyEncrypted, "openaiApiKey"),
    openaiModel: row.openaiModel ?? "",
    anthropicApiKey: safeDecrypt(row.anthropicApiKeyEncrypted, "anthropicApiKey"),
    anthropicModel: row.anthropicModel ?? "",
    ollamaBaseUrl: row.ollamaBaseUrl ?? "",
    ollamaModel: row.ollamaModel ?? "",
    onboardingCompleted: row.onboardingCompleted ?? false,
  };
}

/**
 * Upsert a partial InfrastructureConfig into the singleton row (id=1).
 * Secret plain fields are encrypted before storage.
 */
export async function saveConfig(
  patch: Partial<InfrastructureConfig>
): Promise<void> {
  // Build the DB value set
  const dbSet: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch) as [string, unknown][]) {
    if (key in SECRET_FIELDS) {
      // Encrypt this secret into its *Encrypted column
      const encKey = SECRET_FIELDS[key as SecretPlainKey] as SecretEncKey;
      dbSet[encKey] = encrypt(value as string);
    } else {
      dbSet[key] = value;
    }
  }

  dbSet.updatedAt = new Date();

  // Insert with defaults; on PK conflict, update only the patched columns
  await db
    .insert(infrastructureConfig)
    .values({
      id: 1,
      onboardingCompleted: false,
      updatedAt: new Date(),
      ...(dbSet as Partial<typeof infrastructureConfig.$inferInsert>),
    })
    .onConflictDoUpdate({
      target: infrastructureConfig.id,
      set: dbSet as Partial<typeof infrastructureConfig.$inferInsert>,
    });
}

/**
 * Convenience: returns true iff onboarding has been completed.
 */
export async function isOnboardingCompleted(): Promise<boolean> {
  const rows = await db
    .select({ onboardingCompleted: infrastructureConfig.onboardingCompleted })
    .from(infrastructureConfig)
    .where(eq(infrastructureConfig.id, 1));

  return (rows[0]?.onboardingCompleted) ?? false;
}

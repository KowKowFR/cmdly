import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  integer,
  varchar,
  jsonb,
  serial,
  index,
} from "drizzle-orm/pg-core";

// ─── Enums ─────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["viewer", "operator", "admin"]);
export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "tool",
]);
export const auditResultEnum = pgEnum("audit_result", [
  "success",
  "error",
  "denied",
]);

// ─── better-auth core tables ────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  // CMDLY extensions
  role: roleEnum("role").notNull().default("viewer"),
  passwordHash: text("password_hash"),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ─── Conversations & messages ────────────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  model: text("model"),
  provider: text("provider"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  toolCallId: text("tool_call_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Audit log ───────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 255 }).notNull(),
  toolName: text("tool_name"),
  params: jsonb("params"),
  result: auditResultEnum("result").notNull(),
  errorMessage: text("error_message"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Infrastructure config (singleton, id always 1) ──────────────────────────

export const infrastructureConfig = pgTable("infrastructure_config", {
  id: integer("id").primaryKey().default(1),
  // Proxmox
  proxmoxHost: text("proxmox_host"),
  proxmoxPort: integer("proxmox_port"),
  proxmoxUser: text("proxmox_user"),
  proxmoxTokenId: text("proxmox_token_id"),
  proxmoxTokenSecretEncrypted: text("proxmox_token_secret_encrypted"),
  proxmoxNode: text("proxmox_node"),
  // Infra repo
  infraRepoType: text("infra_repo_type"),
  infraRepoPath: text("infra_repo_path"),
  infraRepoGitUrl: text("infra_repo_git_url"),
  infraRepoGitBranch: text("infra_repo_git_branch"),
  // SSH / bastion
  sshKeyPath: text("ssh_key_path"),
  bastionHost: text("bastion_host"),
  bastionPort: integer("bastion_port"),
  bastionUser: text("bastion_user"),
  ansibleVaultPasswordFile: text("ansible_vault_password_file"),
  // Zabbix
  zabbixUrl: text("zabbix_url"),
  zabbixUser: text("zabbix_user"),
  zabbixPasswordEncrypted: text("zabbix_password_encrypted"),
  // Wazuh
  wazuhUrl: text("wazuh_url"),
  wazuhUser: text("wazuh_user"),
  wazuhPasswordEncrypted: text("wazuh_password_encrypted"),
  // LDAP
  ldapEnabled: boolean("ldap_enabled").default(false),
  ldapUrl: text("ldap_url"),
  ldapBindDn: text("ldap_bind_dn"),
  ldapBindPasswordEncrypted: text("ldap_bind_password_encrypted"),
  ldapBaseDn: text("ldap_base_dn"),
  // LLM
  defaultLlmProvider: text("default_llm_provider"),
  openaiApiKeyEncrypted: text("openai_api_key_encrypted"),
  openaiModel: text("openai_model"),
  anthropicApiKeyEncrypted: text("anthropic_api_key_encrypted"),
  anthropicModel: text("anthropic_model"),
  ollamaBaseUrl: text("ollama_base_url"),
  ollamaModel: text("ollama_model"),
  // Meta
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Rate limits ─────────────────────────────────────────────────────────────

export const rateLimits = pgTable("rate_limits", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 255 }).notNull(),
  count: integer("count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at").notNull(),
});

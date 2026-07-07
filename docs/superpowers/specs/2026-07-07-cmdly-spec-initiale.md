# CMDLY — Spécification initiale (fournie par l'utilisateur, 2026-07-07)

> Référence fonctionnelle complète du projet. Le document `2026-07-07-cmdly-design.md` consigne les décisions et écarts validés ; en cas de silence là-bas, ce document fait foi.

---

# CMDLY — Command Line for Everyone

Construis-moi **CMDLY**, un dashboard d'administration d'infrastructure piloté par intelligence artificielle. Le produit permet à un utilisateur de piloter une infrastructure informatique via un chat en langage naturel, avec exécution d'actions concrètes (Terraform, Ansible, SSH, API Proxmox/Wazuh/Zabbix) via function calling.

Le projet doit être **production-ready**, **installable via un script `curl | bash`**, et démontrable en soutenance devant un jury cybersécurité.

## Contexte du projet

CMDLY est développé comme extension d'un projet PRA (Plan de Reprise d'Activité) réalisé dans le cadre d'un Bac+4 Architecte en Cybersécurité au CFA INSTA. L'infrastructure cible existante comporte 10 machines virtuelles sur Proxmox VE, 15 rôles Ansible, PostgreSQL, OpenLDAP, Nextcloud, Wazuh SIEM, Zabbix, PBS. CMDLY se connecte à cette infrastructure existante pour permettre son administration en langage naturel.

Le mémoire de fin d'études du projet consacre un chapitre entier à CMDLY (Chapitre 24 du mémoire). Ce que tu construis doit être conforme à ce chapitre : produit installable, onboarding 10-15 écrans, garde-fous multi-couches, multi-provider LLM.

## Stack technique imposée

- **Next.js 15+** (App Router, Server Components, Server Actions)
- **TypeScript strict** (aucun `any` implicite)
- **Tailwind CSS 4** avec palette sombre premium type Vercel/Linear
- **shadcn/ui** pour les composants de base (bouton, card, dialog, toast, dropdown, tabs, select, avatar, switch)
- **Drizzle ORM** avec PostgreSQL (jamais Prisma)
- **Better-auth** pour l'authentification (jamais NextAuth)
- **Framer Motion** pour les animations
- **Lucide React** pour les icônes
- **Zod** pour la validation
- **Recharts** pour les graphiques dashboard

## Palette et design

- Fond principal : `#0A0A0B` (quasi-noir)
- Cards : `#111113` avec bordure `#27272A`
- Texte principal : `#EDEDED`
- Texte secondaire : `#A1A1AA`
- **Bleu marine PRA** : `#1A365D` (couleur primaire, dominante)
- **Orange PRA** : `#DD6B20` (accent, hover, call-to-action)
- Success : `#22C55E`, Warning : `#F59E0B`, Danger : `#EF4444`

Design premium : coins arrondis subtils (rounded-lg/xl), ombres douces, transitions 200-300ms, focus rings orange, gradients occasionnels bleu marine → orange, jamais de couleurs neon vives. Inspiration : Vercel dashboard, Linear, Cursor.

## Architecture cible

```
cmdly/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx           # sidebar + topbar
│   │   │   ├── page.tsx             # dashboard home (stats + VMs)
│   │   │   ├── chat/page.tsx        # chat IA plein écran
│   │   │   ├── vms/page.tsx         # inventaire VMs
│   │   │   ├── alerts/page.tsx      # alertes Wazuh
│   │   │   ├── metrics/page.tsx     # métriques Zabbix
│   │   │   ├── audit/page.tsx       # audit log
│   │   │   └── settings/page.tsx    # préférences user
│   │   ├── onboarding/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx             # wizard 12 étapes
│   │   ├── api/
│   │   │   ├── auth/[...all]/route.ts
│   │   │   ├── chat/route.ts        # POST : streaming SSE
│   │   │   ├── tools/route.ts       # exécution tools
│   │   │   ├── onboarding/route.ts
│   │   │   └── health/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx               # root layout
│   │   └── page.tsx                 # landing (redirige selon auth/onboarding)
│   ├── components/
│   │   ├── ui/                      # shadcn/ui
│   │   ├── chat/
│   │   │   ├── ChatContainer.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallBadge.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   └── ChatInput.tsx
│   │   ├── dashboard/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   ├── StatsGrid.tsx
│   │   │   ├── VMCard.tsx
│   │   │   ├── AlertBadge.tsx
│   │   │   └── MetricChart.tsx
│   │   └── onboarding/
│   │       ├── Wizard.tsx
│   │       ├── StepIndicator.tsx
│   │       └── steps/               # 12 étapes séparées
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── config.ts            # better-auth config
│   │   │   ├── permissions.ts       # RBAC (viewer/operator/admin)
│   │   │   └── ldap.ts              # bind LDAP optionnel
│   │   ├── db/
│   │   │   ├── index.ts             # drizzle client
│   │   │   ├── schema.ts            # tables Drizzle
│   │   │   └── migrations/
│   │   ├── llm/
│   │   │   ├── index.ts             # provider abstraction
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── ollama.ts
│   │   │   └── streaming.ts         # SSE helpers
│   │   ├── tools/
│   │   │   ├── registry.ts          # catalogue des 14 tools
│   │   │   ├── executor.ts          # dispatcher + guardrails
│   │   │   ├── list_vms.ts
│   │   │   ├── get_vm_status.ts
│   │   │   ├── create_vm.ts
│   │   │   ├── destroy_vm.ts
│   │   │   ├── deploy_role.ts
│   │   │   ├── run_playbook.ts
│   │   │   ├── service_status.ts
│   │   │   ├── restart_service.ts
│   │   │   ├── stop_service.ts
│   │   │   ├── search_wazuh_alerts.ts
│   │   │   ├── get_zabbix_metrics.ts
│   │   │   ├── analyze_log.ts
│   │   │   ├── generate_role.ts
│   │   │   └── rollback.ts
│   │   ├── proxmox.ts               # client API Proxmox
│   │   ├── wazuh.ts
│   │   ├── zabbix.ts
│   │   ├── ssh.ts                   # wrapper node-ssh
│   │   ├── terraform.ts             # exec terraform CLI
│   │   ├── ansible.ts               # exec ansible-playbook CLI
│   │   ├── rateLimit.ts
│   │   ├── audit.ts                 # helper insert audit_log
│   │   └── utils.ts
│   ├── hooks/
│   │   ├── useChat.ts
│   │   ├── useConfirm.ts
│   │   └── useToast.ts
│   ├── types/
│   │   ├── tools.ts
│   │   ├── llm.ts
│   │   └── auth.ts
│   └── middleware.ts                # protection routes
├── drizzle/
│   ├── schema.ts
│   └── migrations/
├── scripts/
│   ├── install.sh                   # curl | bash pour Debian
│   ├── seed.ts                      # user admin par défaut
│   └── check-config.ts
├── public/
│   └── logo.svg
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── TOOLS.md
│   ├── DEPLOYMENT.md
│   └── SECURITY.md
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json                  # shadcn/ui
└── package.json
```

## Schéma de base de données (Drizzle)

Crée `src/lib/db/schema.ts` avec ces tables :

**users** : id, email (unique), passwordHash (nullable si LDAP), name, role (`viewer` | `operator` | `admin`), createdAt, updatedAt

**sessions** : id, userId (fk), token, expiresAt, ipAddress, userAgent, createdAt (better-auth)

**accounts** : better-auth accounts table (providerId, accountId, userId...)

**verifications** : better-auth verifications table

**conversations** : id, userId (fk), title, model, provider, createdAt, updatedAt

**messages** : id, conversationId (fk), role (`user` | `assistant` | `tool`), content (text), toolCalls (json nullable), toolCallId (nullable), createdAt

**auditLog** : id, userId (fk), action (varchar), toolName (nullable), params (json), result (`success` | `error` | `denied`), errorMessage (nullable), ipAddress, createdAt

**infrastructureConfig** : id (singleton, always 1), proxmoxHost, proxmoxPort, proxmoxUser, proxmoxTokenId, proxmoxTokenSecretEncrypted, proxmoxNode, infraRepoType, infraRepoPath, infraRepoGitUrl, infraRepoGitBranch, sshKeyPath, bastionHost, bastionPort, bastionUser, ansibleVaultPasswordFile, zabbixUrl, zabbixUser, zabbixPasswordEncrypted, wazuhUrl, wazuhUser, wazuhPasswordEncrypted, ldapEnabled, ldapUrl, ldapBindDn, ldapBindPasswordEncrypted, ldapBaseDn, defaultLlmProvider, openaiApiKeyEncrypted, openaiModel, anthropicApiKeyEncrypted, anthropicModel, ollamaBaseUrl, ollamaModel, onboardingCompleted, updatedAt

**rateLimits** : id, userId, action, count, windowStartedAt

Tous les mots de passe et secrets stockés en base doivent être **chiffrés AES-256-GCM** avec une clé maître dérivée de `BETTER_AUTH_SECRET`. Fournis `src/lib/crypto.ts` avec `encrypt(plain)` / `decrypt(cipher)`.

## Les 14 tools à implémenter

Chaque tool est un fichier séparé dans `src/lib/tools/` qui exporte un objet respectant l'interface :

```typescript
export interface Tool {
  name: string;
  description: string;         // pour le LLM function calling
  category: "read" | "modify" | "destroy";
  requiredRole: "viewer" | "operator" | "admin";
  parameters: z.ZodSchema;     // validation Zod
  execute: (params: unknown, ctx: ExecutionContext) => Promise<ToolResult>;
}

export interface ExecutionContext {
  userId: string;
  userRole: "viewer" | "operator" | "admin";
  ipAddress: string;
  config: InfrastructureConfig;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  humanReadable: string;       // rendu naturel pour le chat
}
```

### Tools en lecture (category: "read", requiredRole: "viewer")

1. **list_vms** : Liste toutes les VMs Proxmox avec leur statut (running/stopped), IP, VLAN, RAM, CPU. Utilise l'API Proxmox `/api2/json/nodes/{node}/qemu`.

2. **get_vm_status** : Détails d'une VM spécifique (params: `vmid`). Retourne status détaillé, uptime, load, disk usage.

3. **service_status** : Statut d'un service systemd sur une VM (params: `vmHost`, `serviceName`). Utilise SSH.

4. **search_wazuh_alerts** : Recherche dans les alertes Wazuh (params: `query`, `severity`, `limit`). API Wazuh Indexer.

5. **get_zabbix_metrics** : Métriques Zabbix pour un host (params: `hostName`, `metricName`, `period`). API JSON-RPC Zabbix.

6. **analyze_log** : Analyse un log via SSH (params: `vmHost`, `logPath`, `pattern`). Retourne matches + occurrences.

### Tools de modification (category: "modify", requiredRole: "operator")

7. **create_vm** : Crée une nouvelle VM via Terraform. Params : `name`, `vlan` (mgt/srv/dmz), `memory`, `cores`, `disk`. Écrit dans terraform.tfvars, exécute `terraform plan` puis `terraform apply -auto-approve` en background, streame la sortie.

8. **deploy_role** : Applique un rôle Ansible sur un ou plusieurs hôtes. Params : `role`, `hosts` (array), `extraVars` (object nullable). Exécute `ansible-playbook` avec le vault.

9. **run_playbook** : Exécute un playbook complet (params : `playbookPath`). Retourne récap changed/ok/failed.

10. **restart_service** : Redémarre un service systemd (params : `vmHost`, `serviceName`). Confirmation utilisateur requise.

11. **generate_role** : Génère un squelette de rôle Ansible via LLM (params : `roleName`, `description`). Crée les fichiers dans le repo local et propose un commit.

12. **rollback** : Rollback vers un commit Git antérieur du repo infra (params : `commitSha`). Fait git checkout + relance ansible-playbook site.yml.

### Tools destructeurs (category: "destroy", requiredRole: "admin")

13. **destroy_vm** : Détruit une VM via Terraform (params : `vmid`). Confirmation utilisateur obligatoire avec typing du nom de VM.

14. **stop_service** : Arrête un service systemd (params : `vmHost`, `serviceName`). Confirmation requise.

Chaque tool doit :
- Valider ses paramètres avec Zod
- Vérifier le rôle de l'utilisateur (denied si insuffisant)
- Passer par rateLimit (5/min pour modify, 1/min pour destroy)
- Écrire dans auditLog systématiquement (avant + après exécution)
- Retourner un `humanReadable` bien formaté pour le chat

## Function calling multi-provider

Crée `src/lib/llm/index.ts` avec une abstraction commune :

```typescript
export interface LLMProvider {
  name: "openai" | "anthropic" | "ollama";
  chatStream(params: {
    messages: LLMMessage[];
    tools: LLMTool[];
    onToken: (token: string) => void;
    onToolCall: (toolCall: LLMToolCall) => Promise<LLMToolResult>;
  }): AsyncGenerator<LLMEvent>;
}
```

Implémentations :
- `openai.ts` : utilise `openai` SDK, GPT-4o par défaut, format tools OpenAI
- `anthropic.ts` : utilise `@anthropic-ai/sdk`, Claude 3.5 Sonnet, format tools Anthropic
- `ollama.ts` : utilise `ollama` SDK, Llama 3.1 par défaut

Le catalogue des 14 tools est traduit dans le format de chaque provider dynamiquement.

## API routes

### `POST /api/chat`

Reçoit `{ conversationId, message }`. Charge l'historique de la conversation depuis Drizzle, appelle le provider LLM en streaming SSE, exécute les tool calls proposés (avec guardrails), sauvegarde chaque message dans la base au fur et à mesure.

Format SSE :
```
event: token
data: {"content": "Voici les VMs..."}

event: tool_call
data: {"id": "call_123", "name": "list_vms", "status": "pending"}

event: tool_result
data: {"id": "call_123", "result": {...}, "humanReadable": "..."}

event: confirm_required
data: {"toolCallId": "call_123", "action": "destroy_vm", "params": {...}}

event: done
data: {"messageId": "msg_456"}
```

### `POST /api/tools`

Exécute un tool spécifique (utilisé après confirmation utilisateur). Body : `{ toolCallId, confirmed: true }`.

### `POST /api/onboarding`

Sauvegarde chaque étape de l'onboarding wizard. Body : `{ step, data }`. Chiffre les secrets avant insertion.

## Onboarding wizard (12 étapes)

Composant `Wizard.tsx` avec navigation avant/arrière, barre de progression, sauvegarde après chaque étape.

**Étape 1** : Bienvenue. Présente CMDLY, ses fonctionnalités, prérequis (Node.js 20+, Terraform, Ansible, accès Proxmox).

**Étape 2** : Compte administrateur. Email + mot de passe pour le premier admin CMDLY. Validation Zod stricte.

**Étape 3** : Connexion Proxmox VE. Host, port (8006), user (root@pam), API Token ID + Secret, nœud cible. Bouton "Tester la connexion" qui appelle l'API Proxmox.

**Étape 4** : Repository Terraform/Ansible. Radio : Local (path) ou Git (URL + branche). Si git, clone dans `/opt/cmdly/infra`.

**Étape 5** : SSH bastion. Host, port, user, chemin clé SSH. Bouton "Tester SSH".

**Étape 6** : Ansible Vault. Path du fichier vault password.

**Étape 7** : Provider LLM. Radio : OpenAI (défaut) / Anthropic / Ollama. Champ API key (masqué) selon le choix. Bouton "Tester".

**Étape 8** : Zabbix (optionnel). URL, user, password. Bouton "Tester".

**Étape 9** : Wazuh (optionnel). URL, user, password.

**Étape 10** : LDAP (optionnel). Switch on/off. Si on : URL, bind DN, password, base DN.

**Étape 11** : Résumé. Affiche toutes les configurations, permet d'éditer chaque section.

**Étape 12** : Terminé. Récapitulatif, bouton "Accéder au dashboard".

Une fois complété : `infrastructureConfig.onboardingCompleted = true`. Ensuite, `middleware.ts` empêche l'accès à `/onboarding` si déjà fait, et redirige vers `/onboarding` si pas encore fait.

## Chat UI

Chat en plein écran type Vercel v0. Sidebar gauche : liste des conversations. Zone centrale : messages avec bulles, Tool Call badges animés (spinner pendant exécution, checkmark vert à la fin, croix rouge si échec).

Composant `ToolCallBadge` : petite card cliquable qui déplie les paramètres et le résultat. Design inspiré des badges de Cursor.

Composant `ConfirmDialog` : dialog shadcn/ui qui apparaît pour les actions destructrices. Affiche : action, paramètres, warning rouge, champ "Tapez le nom pour confirmer" (pour destroy_vm). Boutons "Annuler" (secondaire) et "Confirmer" (rouge).

Streaming SSE avec `EventSource`. Hook `useChat.ts` qui expose `sendMessage`, `messages`, `isStreaming`, `pendingConfirmation`.

## Dashboard home

Vue d'ensemble type Vercel :
- **Stats grid** (4 cards) : VMs actives, Alertes Wazuh 24h, Uptime moyen, Actions CMDLY 24h
- **VM Grid** : cards des 10 VMs avec statut coloré (vert running, rouge stopped, orange dégradé)
- **Recent alerts** : dernières alertes Wazuh (severity + description + timestamp)
- **Metrics chart** : Recharts area chart CPU moyen 24h

## Authentification et RBAC

`src/lib/auth/permissions.ts` :

```typescript
export const ROLE_HIERARCHY = { viewer: 0, operator: 1, admin: 2 } as const;

export function canExecuteTool(
  userRole: keyof typeof ROLE_HIERARCHY,
  requiredRole: keyof typeof ROLE_HIERARCHY
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
```

Middleware `src/middleware.ts` : protège toutes les routes sauf `/login`, `/onboarding` (si non complété) et `/api/health`. Redirige vers `/login` si pas de session.

## Audit log

Chaque appel de tool (avant et après) est loggé. Table `auditLog` avec :
- `userId` : qui
- `action` : "tool_call_attempted" | "tool_call_succeeded" | "tool_call_failed" | "tool_call_denied"
- `toolName`
- `params` (json)
- `result` (json ou message)
- `ipAddress`
- `createdAt`

Page `/audit` accessible admin uniquement, avec filtres et export CSV.

## Rate limiting

`src/lib/rateLimit.ts` : compteurs en base (table `rateLimits`) avec fenêtre glissante d'1 minute. Retourne `{ allowed: boolean, remaining: number, resetAt: Date }`.

Limites :
- Tools "read" : illimité
- Tools "modify" : 5 par minute par user
- Tools "destroy" : 1 par minute par user

## Script d'installation

`scripts/install.sh` : script bash Debian idempotent qui :

1. Vérifie Debian 12+ / Ubuntu 22+
2. Installe Node.js 20 via NodeSource
3. Installe Terraform via HashiCorp APT repo
4. Installe Ansible via APT
5. Installe PostgreSQL 15+ et crée base + user `cmdly`
6. Clone CMDLY dans `/opt/cmdly`
7. `npm install`, `npm run build`
8. Crée `/etc/systemd/system/cmdly.service`
9. Génère `BETTER_AUTH_SECRET` aléatoire
10. Démarre le service
11. Affiche l'URL d'accès et le mot de passe généré pour l'onboarding

Publication : usage `curl -sSL https://install.cmdly.io | bash`. Le script contient tout, aucun autre fichier requis.

## Sécurité (à respecter absolument)

1. **Jamais** de secret en clair en base : tous les secrets (API keys, passwords) chiffrés AES-256-GCM
2. **Jamais** de tool call sans validation Zod des paramètres
3. **Jamais** d'exécution shell avec interpolation directe : utiliser toujours `execFile` avec array d'arguments
4. **Jamais** de bypass RBAC : chaque tool vérifie `canExecuteTool`
5. Confirmation utilisateur obligatoire pour `destroy_vm`, `stop_service`, `rollback`
6. Rate limits stricts
7. Audit log complet immuable (append-only, pas de UPDATE ni DELETE)
8. Headers de sécurité HTTP (CSP strict, X-Frame-Options DENY, etc.)
9. Sessions courtes (24h) avec refresh
10. Lockout après 5 échecs de login (15 min)

## Documentation à produire

### `docs/README.md`
Vue d'ensemble produit : à quoi sert CMDLY, quickstart, capture d'écran chat + dashboard + onboarding.

### `docs/ARCHITECTURE.md`
Diagrammes ASCII/mermaid de l'architecture : frontend → API → executor → tools → infrastructure. Détail du flux d'un message (user input → LLM → tool call → guardrails → exécution → audit → réponse).

### `docs/TOOLS.md`
Documentation des 14 tools : nom, catégorie, rôle requis, paramètres, exemple d'appel, exemple de réponse, points de sécurité.

### `docs/DEPLOYMENT.md`
Guide d'installation manuelle + via script + via Docker. Configuration PostgreSQL, systemd, reverse proxy nginx suggéré, HTTPS via Let's Encrypt.

### `docs/SECURITY.md`
Modèle de menaces, mesures mises en place, procédures de rotation des secrets, audit trail, considérations sur les LLM (data leakage, injection prompts, hallucinations).

## Ordre de construction attendu

Fais dans cet ordre exactement, en committant à chaque étape :

1. `npx create-next-app@latest cmdly --typescript --tailwind --app --no-src-dir` puis restructure vers `src/`
2. Installe drizzle, better-auth, shadcn/ui init, dépendances
3. Schéma Drizzle + migrations
4. Better-auth config + login/register + middleware
5. Crypto util pour chiffrement secrets
6. UI shell : layout dashboard avec sidebar + topbar
7. Onboarding wizard (12 étapes)
8. Provider LLM abstraction + OpenAI
9. Registry tools + interface Tool
10. Les 6 tools "read" avec Proxmox/Wazuh/Zabbix clients
11. Chat UI + streaming SSE + hook useChat
12. Les 5 tools "modify" avec Terraform/Ansible executors
13. Les 3 tools "destroy" + ConfirmDialog
14. Audit log + page `/audit`
15. Rate limiting
16. Dashboard home avec stats + graphiques
17. Providers Anthropic + Ollama
18. Documentation dans `docs/`
19. Script d'installation `scripts/install.sh`
20. Tests manuels bout-en-bout

## Contraintes finales

- TypeScript strict, zéro `any` implicite, zéro `@ts-ignore`
- Composants server par défaut (App Router), client uniquement si interactivité
- Zod pour toute validation d'input (API routes, tool params, formulaires)
- Gestion d'erreurs typée avec discriminated unions plutôt qu'exceptions
- Toast de succès/erreur systématique après action utilisateur
- Animations Framer Motion subtiles (fade + slide 200ms) sur les entrées de composants
- Responsive mobile (sidebar collapse, chat plein écran)
- Accessibilité : focus visible, aria-labels, contrast AA minimum
- Aucun `console.log` en production : utilise un logger structuré
- Commit par étape avec Conventional Commits

# CMDLY — Design validé

Date : 2026-07-07
Statut : validé par l'utilisateur (kowkow), prêt pour plan d'implémentation.

## Résumé

CMDLY est un dashboard d'administration d'infrastructure piloté par IA : un chat en langage naturel exécute des actions concrètes (Terraform, Ansible, SSH, API Proxmox/Wazuh/Zabbix) via function calling, avec garde-fous multi-couches (RBAC, validation Zod, confirmations, rate limiting, audit append-only). Le produit est développé comme extension d'un projet PRA (Bac+4 Architecte Cybersécurité, CFA INSTA) et doit être production-ready, installable via `curl | bash`, et démontrable en soutenance.

La spécification détaillée fournie par l'utilisateur (prompt initial de la session) est la référence fonctionnelle complète : arborescence, schéma de base, les 14 tools, l'onboarding 12 étapes, le chat UI, le dashboard, la sécurité, la documentation et le script d'installation y sont décrits exhaustivement. Ce document consigne les décisions prises et les écarts validés par rapport à cette spec — en cas de silence ici, la spec initiale fait foi.

## Décisions validées

### Contexte d'exécution
- **Infrastructure réelle accessible** pendant le développement : les clients Proxmox, Wazuh, Zabbix et SSH sont codés contre les vrais endpoints (credentials fournis via l'onboarding / `.env`). Pas de mode démo/mock intégré au produit ; les tests unitaires mockent les clients au niveau des interfaces.
- **Provider LLM de développement : OpenAI** (clé disponible). L'abstraction multi-provider est construite dès le départ ; OpenAI est implémenté et testé en premier, Anthropic et Ollama suivent (étape 17 de l'ordre de construction).
- **Périmètre : la spec complète**, construite dans l'ordre des 20 étapes définies dans la spec, avec un commit Conventional Commits par étape.

### Écarts techniques par rapport à la spec (validés)

1. **Streaming SSE avec `EventSource` (exigence utilisateur), pattern POST-puis-GET** : `EventSource` ne supporte que GET. Le flux est donc :
   - `POST /api/chat` — body `{ conversationId, message }` — persiste le message user, prépare le run, retourne `{ streamId }`.
   - `GET /api/chat/stream?streamId=...` — consommé par `EventSource`, émet les événements SSE définis dans la spec (`token`, `tool_call`, `tool_result`, `confirm_required`, `done`, plus `error`).
   - Le hook `useChat` orchestre les deux appels.
2. **Tailwind CSS 4.3.x (dernière version publiée — il n'existe pas de v5)** : configuration par `@theme` dans `globals.css` (la v4 n'utilise plus `tailwind.config.ts`). La palette PRA y est déclarée en design tokens. shadcn/ui en mode Tailwind v4.
3. **Versions actuelles vérifiées sur npm (07/07/2026)** : Next.js 16.2 (satisfait « 15+ »), better-auth 1.6.x, drizzle-orm 0.45.x, tailwindcss 4.3.x. La documentation officielle (via context7) est consultée pendant l'implémentation pour les APIs de ces versions.
4. **Schéma auth conforme better-auth** : les tables `users`, `sessions`, `accounts`, `verifications` suivent le schéma exigé par better-auth (généré par son CLI/adapter Drizzle), avec le champ additionnel `role` (`viewer` | `operator` | `admin`) sur `users` via le plugin/additionalFields. Les autres tables (`conversations`, `messages`, `auditLog`, `infrastructureConfig`, `rateLimits`) sont exactement celles de la spec.
5. **Modèles LLM par défaut** : configurables dans l'onboarding ; défauts à jour au moment de l'implémentation (OpenAI `gpt-4o` ou plus récent, Anthropic modèle Claude courant, Ollama `llama3.1`).

## Architecture (rappel synthétique)

```
Navigateur (Next.js App Router, RSC + client components)
   │  EventSource SSE / Server Actions / fetch
   ▼
API routes (/api/chat, /api/chat/stream, /api/tools, /api/onboarding, /api/health)
   │
   ├─ better-auth (sessions 24h, lockout 5 échecs/15min, LDAP optionnel)
   ├─ LLM abstraction (openai | anthropic | ollama) — function calling, streaming
   ▼
Tool executor (dispatcher + guardrails)
   ├─ Zod validation des params
   ├─ RBAC canExecuteTool (viewer 0 < operator 1 < admin 2)
   ├─ Rate limit (read: ∞, modify: 5/min, destroy: 1/min — table rateLimits)
   ├─ Confirmation utilisateur (destroy_vm avec re-typage du nom, stop_service, rollback, restart_service)
   └─ Audit log append-only (avant + après chaque exécution)
   ▼
14 tools → clients infra : Proxmox API, Wazuh Indexer, Zabbix JSON-RPC,
node-ssh (bastion), terraform CLI (execFile), ansible-playbook CLI (execFile)
   ▼
PostgreSQL (Drizzle ORM) — secrets chiffrés AES-256-GCM,
clé maître dérivée de BETTER_AUTH_SECRET (src/lib/crypto.ts)
```

Les 14 tools, leurs catégories (read/modify/destroy), rôles requis, paramètres et comportements sont ceux de la spec initiale, interface `Tool` incluse (name, description, category, requiredRole, parameters Zod, execute → ToolResult avec humanReadable).

## Sécurité (engagements non négociables, repris de la spec)

Secrets chiffrés AES-256-GCM en base ; validation Zod systématique ; `execFile` avec arguments en tableau (jamais d'interpolation shell) ; RBAC vérifié dans l'executor pour chaque tool ; confirmations obligatoires pour les actions destructrices ; rate limits stricts ; audit log immuable (INSERT only) ; headers HTTP durcis (CSP strict, X-Frame-Options DENY…) ; sessions 24h avec refresh ; lockout login. La page `/audit` (admin only) offre filtres + export CSV.

## Livrables

- Application Next.js complète (arborescence de la spec), onboarding 12 étapes, chat SSE avec ToolCallBadge/ConfirmDialog, dashboard home (stats, VM grid, alertes, Recharts), pages vms/alerts/metrics/audit/settings.
- `scripts/install.sh` idempotent (Debian 12+/Ubuntu 22+ : Node 20, Terraform, Ansible, PostgreSQL, systemd, secret généré).
- Docs : README, ARCHITECTURE, TOOLS, DEPLOYMENT, SECURITY dans `docs/`.
- TypeScript strict, zéro `any`/`@ts-ignore`, erreurs typées en unions discriminées, logger structuré (pas de `console.log`), accessibilité AA, responsive.

## Ordre de construction

Les 20 étapes de la spec initiale, dans l'ordre, un commit par étape. Le plan d'implémentation détaillé (fichier séparé) découpe chaque étape en tâches vérifiables.

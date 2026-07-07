# CMDLY — Tableau de bord infra piloté par IA

> Extension du projet PRA (Plan de Reprise d'Activité) — Bac+4 Architecte Cybersécurité (CFA INSTA)

CMDLY est une interface de gestion d'infrastructure en langage naturel. L'administrateur système formule ses demandes en français ; un modèle de langage les traduit en appels d'outils sécurisés — chaque action passant par un pipeline de garde-fous (RBAC, validation Zod, confirmation, limite de débit, journal d'audit) avant toute exécution.

---

## Problème résolu

Les outils d'administration classiques (CLI Proxmox, Ansible en ligne de commande, dashboards Zabbix/Wazuh) nécessitent une expertise pointue et une connaissance des commandes exactes. CMDLY expose ces mêmes opérations via une interface de chat, tout en garantissant qu'aucune action destructive ne peut être exécutée sans confirmation explicite et traçabilité complète.

---

## Fonctionnalités clés

| Domaine | Détail |
|---|---|
| **Chat IA** | Interface conversationnelle SSE en temps réel, multi-tours (max 5 rounds d'outils par message) |
| **14 outils** | 6 lecture (viewer), 6 modification (operator), 2 destruction (admin) — voir [TOOLS.md](./TOOLS.md) |
| **Multi-provider LLM** | OpenAI, Anthropic Claude, Ollama (modèle local) — configurable sans redéploiement |
| **Pipeline de garde-fous** | Audit → RBAC → Zod → confirmation → limite de débit → exécution — voir [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **RBAC 3 niveaux** | `viewer` / `operator` / `admin` avec hiérarchie cumulative |
| **Journal d'audit** | Append-only en base PostgreSQL, export CSV, accessible aux admins |
| **Onboarding guidé** | Wizard 12 étapes : admin bootstrap, Proxmox, dépôt infra, SSH, Vault Ansible, LLM, Zabbix, Wazuh, LDAP |
| **Auth flexible** | better-auth email/password + LDAP optionnel, sessions 24 h, verrouillage 5 échecs / 15 min |
| **Chiffrement secrets** | AES-256-GCM (clé dérivée de `BETTER_AUTH_SECRET`), secrets stockés chiffrés en base |
| **Sécurité HTTP** | CSP, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy |

---

## Captures d'écran (emplacements prévus)

![Interface de chat](./images/chat.png)
![Tableau de bord](./images/dashboard.png)
![Assistant d'onboarding](./images/onboarding.png)

---

## Prérequis

- **Node.js** 20+ (LTS)
- **PostgreSQL** 14+
- **Terraform** installé sur le serveur (pour les outils `create_vm` / `destroy_vm`)
- **Ansible** installé sur le serveur (pour les outils `deploy_role`, `run_playbook`, `rollback`, `generate_role`)
- Accès réseau aux services gérés (Proxmox, Zabbix, Wazuh, bastion SSH)

---

## Quickstart

```bash
# 1. Cloner le dépôt
git clone <url-du-depot> cmdly
cd cmdly

# 2. Créer le fichier d'environnement
cp .env.example .env
# Renseigner au minimum :
#   DATABASE_URL=postgresql://user:pass@localhost:5432/cmdly
#   BETTER_AUTH_SECRET=<chaîne-aléatoire-32+-caractères>
#   BETTER_AUTH_URL=https://votre-domaine.example.com

# 3. Installer les dépendances
npm install

# 4. Appliquer les migrations de base de données
npx drizzle-kit migrate

# 5. Lancer en développement
npm run dev
# → http://localhost:3000
```

Au premier accès, le wizard d'onboarding s'ouvre automatiquement (12 étapes).  
L'étape 2 crée le premier compte administrateur (garde-fou zéro-admin).

---

## Variables d'environnement essentielles

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | Oui | URL PostgreSQL (`postgresql://...`) |
| `BETTER_AUTH_SECRET` | Oui | Clé de signature de session **et** clé de chiffrement AES des secrets infra |
| `BETTER_AUTH_URL` | Oui | URL publique de l'application (ex. `https://cmdly.example.com`) |

> **Attention** : la valeur de `BETTER_AUTH_SECRET` déchiffre tous les secrets stockés en base (clés API, mots de passe Proxmox/Zabbix/Wazuh/LDAP). Voir [SECURITY.md](./SECURITY.md) pour la procédure de rotation.

---

## Documentation

| Fichier | Contenu |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Schémas de l'architecture et du flux de messages |
| [TOOLS.md](./TOOLS.md) | Référence complète des 14 outils (paramètres, rôles, sécurité) |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Guide d'installation (manuel, Docker, systemd, Nginx) |
| [SECURITY.md](./SECURITY.md) | Modèle de menace, contrôles, rotation des secrets, risques LLM |

---

## Stack technique

| Couche | Technologies |
|---|---|
| Framework | Next.js 16.2 (App Router, React 19) |
| Langage | TypeScript strict |
| UI | Tailwind CSS v4 (`@theme`), shadcn/ui, Framer Motion, Recharts |
| Auth | better-auth 1.6.23 (email/password + LDAP optionnel) |
| ORM | Drizzle ORM + PostgreSQL (`pg`) |
| Validation | Zod 4 |
| LLM | openai, @anthropic-ai/sdk, ollama |
| SSH | node-ssh |
| IaC | Terraform (via `execFile`) + Ansible (via `execFile`) |
| Monitoring | Proxmox API, Zabbix API, Wazuh API |

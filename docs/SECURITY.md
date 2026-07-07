# Modèle de sécurité CMDLY

---

## 1. Modèle de menace

CMDLY expose des opérations d'infrastructure à travers un LLM. Les menaces prioritaires identifiées :

| Menace | Description |
|---|---|
| **Sortie LLM non fiable** | Le LLM peut générer des appels d'outils avec des paramètres malveillants ou inattendus (hallucination, manipulation). |
| **Injection de prompt** | Un utilisateur ou une réponse d'outil compromise peut tenter d'altérer le comportement du LLM pour contourner les gardes. |
| **Vol de secrets** | Les clés API (Proxmox, Zabbix, Wazuh, LDAP, LLM) stockées en base pourraient être exfiltrées en cas de compromission DB. |
| **Escalade de privilèges** | Un utilisateur de rôle `viewer` pourrait tenter d'appeler des outils `operator`/`admin`. |
| **SSRF** | Un paramètre `vmHost` forgé pourrait rediriger les connexions SSH vers des cibles internes non prévues. |
| **Injection via paramètres** | Des paramètres (`serviceName`, `logPath`, `roleName`, etc.) pourraient contenir des séquences d'injection (shell, LDAP, HCL, chemin). |
| **Actions destructives accidentelles** | Une destruction de VM ou un arrêt de service lancé sans intention claire. |

---

## 2. Contrôles implémentés

### 2.1 Chiffrement des secrets (AES-256-GCM)

Toutes les données sensibles stockées dans la table `infrastructure_config` (clés API Proxmox, mots de passe Zabbix/Wazuh, clé de liaison LDAP, clés API LLM) sont chiffrées avec AES-256-GCM (`src/lib/crypto.ts`).

- **Clé de chiffrement** : dérivée de `BETTER_AUTH_SECRET` via `scryptSync` avec un sel fixe (`cmdly-secret-salt`) — la sécurité dépend de la robustesse de `BETTER_AUTH_SECRET`.
- **IV** : 12 octets aléatoires par opération (`randomBytes(12)`).
- **Authentification** : tag GCM de 16 octets — toute altération du ciphertext est détectée au déchiffrement.

### 2.2 RBAC + pipeline de garde-fous de l'exécuteur

Chaque appel d'outil passe par 8 étapes séquentielles dans `src/lib/tools/executor.ts` :

1. **Audit** de la tentative (avant tout traitement)
2. **Lookup** de l'outil dans le registre
3. **RBAC** (`canExecuteTool`) — vérifie que le rôle de l'appelant ≥ rôle requis de l'outil
4. **Validation Zod** des paramètres — rejet strict avant la gate de confirmation
5. **Gate de confirmation** — stoppe pour les outils `CONFIRM_REQUIRED` sans consommer de débit
6. **Limite de débit** — `modify` : 5/min, `destroy` : 1/min, `read` : illimité
7. **Exécution** de l'outil
8. **Audit** du résultat (succès ou échec)

La fonction `executeTool` ne lève jamais d'exception : toutes les erreurs sont retournées sous forme de `ExecuteOutcome`.

### 2.3 Validation Zod sur tous les paramètres d'outils

Chaque outil déclare un schéma Zod strict. La validation se fait **avant** toute exécution, garantissant que les valeurs atteignant le code d'exécution sont typées et contraintes :

- Types corrects (entier, string)
- Valeurs dans les bornes (min/max)
- Formats validés (regex, enum)

### 2.4 `execFile` argv — aucune interpolation shell

Tous les appels aux processus externes (Terraform, Ansible, SSH via `node-ssh`) passent par `execFile` avec des tableaux d'arguments. Aucun paramètre utilisateur n'est jamais interpolé dans une chaîne shell.

```typescript
// Exemple : systemctl stop <serviceName>
await runCommand(ctx.config, vmHost, "systemctl", ["stop", serviceName]);
// serviceName est un argument séparé — jamais concaténé dans une commande shell
```

### 2.5 Validation `vmHost` (anti-SSRF)

Le schéma `vmHostSchema` (`src/lib/tools/_shared.ts`) accepte uniquement une adresse IPv4 valide ou un nom d'hôte DNS conforme à la RFC. Il rejette explicitement :

- Les schémas URL (`http://`, `file://`)
- Les ports (`:8080`)
- Les chemins (`/admin`)
- Les espaces et autres caractères non-hôtes

Cette validation est appliquée à tous les outils qui acceptent un paramètre `vmHost` (`service_status`, `analyze_log`, `restart_service`, `stop_service`, `deploy_role`).

### 2.6 Échappement LDAP (RFC 4515)

La fonction `escapeLdapFilter` (`src/lib/auth/ldap.ts`) échappe les caractères spéciaux LDAP (`NUL`, `(`, `)`, `*`, `\`) selon la RFC 4515 avant leur insertion dans un filtre de recherche, prévenant les injections LDAP.

### 2.7 Validation HCL et chemins Terraform/Ansible

- **`create_vm`** : `name` validé contre `[a-z0-9-]+` avant construction des `tfvars`.
- **`destroy_vm`** : nom de la VM résolu depuis Proxmox et validé contre `[a-z0-9]([a-z0-9-]*[a-z0-9])?` avant construction de la cible Terraform. Un nom non conforme déclenche un refus immédiat.
- **`run_playbook`** : chemin résolu via `path.resolve()` + `path.relative()` pour détecter toute traversée hors du dépôt.
- **`generate_role`** : `roleName` et chaque fichier parsé sont vérifiés (pas de chemin absolu, pas de `..`).

### 2.8 Gate de confirmation + confirmation typée

Les outils `CONFIRM_REQUIRED` nécessitent une validation explicite de l'utilisateur avant exécution :

- `restart_service`, `rollback`, `stop_service` : dialogue de confirmation.
- `destroy_vm` : **confirmation typée** — l'utilisateur doit saisir le nom exact de la VM résolue depuis Proxmox.

Un appel non confirmé retourne `{ status: "confirm_required" }` sans consommer de slot de débit.

### 2.9 Limite de débit (DB-backed)

Les compteurs de débit sont persistés dans la table PostgreSQL `rate_limits` (fenêtre glissante de 60 secondes). Contrairement à une implémentation en mémoire, ce mécanisme résiste aux redémarrages de l'application.

> **Risque résiduel documenté** : une condition de concurrence est possible si deux requêtes simultanées lisent le même compteur avant incrémentation. Cela peut permettre un léger dépassement de limite en cas de forte concurrence par utilisateur (commenté dans `src/lib/rateLimit.ts`).

### 2.10 Journal d'audit append-only

Chaque tentative d'appel d'outil génère au minimum une ligne dans la table `audit_log` :

- `tool_call_attempted` — enregistrée avant tout traitement
- `tool_call_succeeded` / `tool_call_failed` / `tool_call_denied` — résultat final

L'insertion est un `INSERT` sans `UPDATE`/`DELETE`. Les échecs d'audit sont loggés mais ne propagent jamais d'erreur à l'appelant. L'interface d'audit est accessible uniquement aux `admin` avec export CSV.

### 2.11 Verrouillage de session

better-auth applique un verrouillage de compte après **5 échecs de connexion en 15 minutes** sur la route `/sign-in/email`. Les sessions expirent après **24 heures**.

### 2.12 Route LDAP : throttling IP + CSRF

La route `/api/auth/ldap` est protégée par :

- **Throttling par adresse IP** : limite le nombre de tentatives d'authentification LDAP par IP.
- **Vérification CSRF** : les requêtes doivent porter le header/cookie anti-CSRF de better-auth.

### 2.13 En-têtes de sécurité HTTP

Configurés dans `next.config.ts` et appliqués à toutes les routes :

| En-tête | Valeur |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'` |

---

## 3. Rotation de `BETTER_AUTH_SECRET`

`BETTER_AUTH_SECRET` remplit deux rôles distincts :

1. **Signature des cookies de session** (better-auth)
2. **Clé de dérivation AES-256-GCM** pour le chiffrement de tous les secrets d'infrastructure en base

**Implication** : modifier `BETTER_AUTH_SECRET` invalide **immédiatement** tous les ciphertextes stockés — les secrets d'infrastructure ne peuvent plus être déchiffrés.

### Procédure de rotation

```
1. Planifier une fenêtre de maintenance (l'application sera indisponible brièvement).
2. Exporter les valeurs déchiffrées actuelles (depuis l'interface d'administration ou
   en déchiffrant manuellement avec l'ancienne clé avant la rotation).
3. Arrêter l'application.
4. Mettre à jour BETTER_AUTH_SECRET dans .env avec la nouvelle valeur.
5. Redémarrer l'application.
6. Accéder au wizard de configuration (ou à l'interface admin) et re-saisir tous
   les secrets d'infrastructure — ils seront chiffrés avec la nouvelle clé.
7. Vérifier le bon fonctionnement de chaque connexion (Proxmox, Zabbix, Wazuh, etc.).
```

> Une étape de re-chiffrement automatisée (lire avec l'ancienne clé, réécrire avec la nouvelle) n'est pas encore implémentée — la re-saisie manuelle est requise.

---

## 4. Journal d'audit

Le journal d'audit (`audit_log`) enregistre toutes les tentatives d'exécution d'outils :

| Champ | Description |
|---|---|
| `userId` | Identifiant de l'utilisateur appelant |
| `action` | `tool_call_attempted` / `tool_call_succeeded` / `tool_call_failed` / `tool_call_denied` |
| `toolName` | Nom de l'outil |
| `params` | Paramètres reçus (JSONB) |
| `result` | Enum : `success` / `error` / `denied` |
| `errorMessage` | Message d'erreur si applicable |
| `ipAddress` | Adresse IP de la requête |
| `createdAt` | Horodatage |

**Garanties** :
- Append-only : aucun `UPDATE`/`DELETE` n'est émis par le code applicatif.
- Toute tentative est auditée, même si elle échoue à l'étape RBAC ou Zod.
- L'interface `/audit` et l'export CSV sont réservés aux utilisateurs `admin`.

---

## 5. Risques LLM spécifiques

### 5.1 Fuite de données vers le provider LLM

Les données d'infrastructure (liste des VMs, résultats des métriques, alertes Wazuh, extraits de logs) sont incluses dans le contexte envoyé au provider LLM configuré (OpenAI, Anthropic, ou Ollama). Pour OpenAI et Anthropic, ces données transitent par leurs API cloud.

**Mitigation** : utiliser Ollama (modèle local) pour les environnements nécessitant que les données restent sur site.

**Risque résiduel** : même avec Ollama, les métadonnées d'infrastructure (noms de VMs, hostnames, niveaux d'alertes) sont exposées au modèle. Ne pas inclure de données classifiées dans les conversations CMDLY si le provider est externe.

### 5.2 Injection de prompt

Un utilisateur malveillant pourrait tenter d'insérer des instructions dans son message pour manipuler le LLM et déclencher des appels d'outils non prévus.

**Containment par les garde-fous** : même si un prompt injection aboutit à un appel d'outil non voulu, le pipeline de garde-fous garantit que :
- L'outil ne peut être exécuté que si le rôle de l'utilisateur le permet (RBAC).
- Les paramètres sont validés par Zod.
- Les actions destructives nécessitent une confirmation explicite de l'utilisateur dans l'interface.

Un utilisateur `viewer` compromis par injection ne peut pas exécuter un outil `operator`/`admin`. Un utilisateur `operator` ne peut pas détruire une VM sans passer par la confirmation typée (ce que le LLM ne peut pas simuler à la place de l'humain).

**Risque résiduel** : un utilisateur `admin` compromis par injection pourrait théoriquement déclencher une confirmation d'action destructive. La confirmation typée (saisie du nom de la VM) constitue le dernier rempart humain.

### 5.3 Hallucination du LLM

Le LLM peut suggérer des opérations incorrectes ou identifier de faux problèmes.

**Mitigation** : les confirmations (dialogue et typées) pour toutes les actions modifiant/détruisant l'infrastructure imposent un regard humain avant exécution. Les résultats des outils sont retournés tels quels (données brutes de Proxmox, Zabbix, Wazuh) — le LLM les commente mais ne les falsifie pas.

---

## 6. Synthèse des risques résiduels

| Risque | Niveau | Mitigation existante | Résiduel |
|---|---|---|---|
| Fuite données vers LLM externe | Moyen | Ollama disponible | Données transitent vers API cloud si OpenAI/Anthropic |
| Race condition rate-limit | Faible | DB-backed (résiste aux redémarrages) | Légère surestimation possible sous forte concurrence |
| BETTER_AUTH_SECRET = double rôle | Moyen | Procédure de rotation documentée | Rotation requiert re-saisie manuelle des secrets |
| Injection de prompt → action admin | Faible | RBAC + confirmation typée | Admin doit taper nom VM (action humaine non simulable) |
| CSP `style-src 'unsafe-inline'` | Faible | Pragmatique à ce stade | Durcissement possible via nonces une fois les besoins CSS stabilisés |

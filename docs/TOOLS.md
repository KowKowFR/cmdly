# Référence des outils CMDLY

CMDLY expose **14 outils** organisés en trois catégories selon leur impact. Chaque outil passe par le pipeline de garde-fous de l'exécuteur avant toute exécution.

---

## Table RBAC

| Rôle | Outils accessibles | Total |
|---|---|---|
| `viewer` | list_vms, get_vm_status, service_status, search_wazuh_alerts, analyze_log, get_zabbix_metrics | 6 |
| `operator` | tout ce que viewer peut faire + create_vm, restart_service, rollback, deploy_role, run_playbook, generate_role | 12 |
| `admin` | tout ce que operator peut faire + destroy_vm, stop_service | 14 |

La hiérarchie est cumulative : `admin > operator > viewer` (définie dans `src/lib/auth/permissions.ts`).

### Actions nécessitant une confirmation explicite (`CONFIRM_REQUIRED`)

| Outil | Type de confirmation |
|---|---|
| `restart_service` | Dialogue de confirmation |
| `rollback` | Dialogue de confirmation |
| `stop_service` | Dialogue de confirmation |
| `destroy_vm` | **Confirmation typée** : l'utilisateur doit saisir le nom exact de la VM |

---

## Limites de débit

| Catégorie | Limite | Fenêtre |
|---|---|---|
| `read` | Illimitée | — |
| `modify` | 5 appels | 60 secondes par utilisateur |
| `destroy` | 1 appel | 60 secondes par utilisateur |

Les compteurs sont persistés en base PostgreSQL (table `rate_limits`). Un slot de débit n'est consommé qu'**après** la confirmation.

---

## Outils de lecture (`read`) — Rôle minimum : `viewer`

### 1. `list_vms`

**Description** : Liste toutes les VMs Proxmox avec leur statut, RAM, CPU et uptime.

| Champ | Valeur |
|---|---|
| Catégorie | `read` |
| Rôle requis | `viewer` |
| Paramètres | aucun |
| Confirmation | non |

**Exemple de demande** : *"Montre-moi toutes les VMs de l'infrastructure."*

**Exemple de résultat** :
```
- web-prod (#100) — running | CPU: 2 | RAM: 4096 MB
- db-01 (#101) — stopped | CPU: 4 | RAM: 8192 MB
```

**Notes de sécurité** : Appel en lecture seule à l'API Proxmox. Aucune donnée sensible exposée.

---

### 2. `get_vm_status`

**Description** : Retourne le statut détaillé d'une VM Proxmox (CPU, mémoire, uptime) à partir de son `vmid`.

| Champ | Valeur |
|---|---|
| Catégorie | `read` |
| Rôle requis | `viewer` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `vmid` | `number` | entier positif | Identifiant numérique de la VM |

**Exemple de demande** : *"Quel est l'état de la VM 100 ?"*

**Exemple de résultat** :
```
VM #100 — running
  CPU: 12.3%
  RAM: 1024 MB / 4096 MB (25.0%)
  Uptime: 3h 42m
```

**Notes de sécurité** : Validation Zod : `vmid` doit être un entier positif.

---

### 3. `service_status`

**Description** : Vérifie si un service systemd est actif sur une VM via le bastion SSH.

| Champ | Valeur |
|---|---|
| Catégorie | `read` |
| Rôle requis | `viewer` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `vmHost` | `string` | IPv4 ou hostname DNS valide | Adresse de la VM cible |
| `serviceName` | `string` | `[A-Za-z0-9._@-]+` | Nom du service systemd |

**Exemple de demande** : *"Est-ce que nginx tourne sur 192.168.10.5 ?"*

**Exemple de résultat** : `Service "nginx" sur 192.168.10.5: active`

**Notes de sécurité** : `vmHost` est validé par `vmHostSchema` (regex stricte IPv4/DNS, bloque les schémas URL et ports — protection SSRF). `serviceName` est passé comme argument `execFile` séparé (pas d'interpolation shell).

---

### 4. `search_wazuh_alerts`

**Description** : Recherche des alertes de sécurité dans Wazuh par mot-clé et niveau de sévérité.

| Champ | Valeur |
|---|---|
| Catégorie | `read` |
| Rôle requis | `viewer` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `query` | `string` | min 1 caractère | Mot-clé de recherche |
| `severity` | `string` | optionnel | Niveau de sévérité (ex. `"12"`) |
| `limit` | `number` | entier 1–100, optionnel | Nombre maximum de résultats |

**Exemple de demande** : *"Y a-t-il des alertes critiques Wazuh concernant SSH ?"*

**Exemple de résultat** :
```
[L12] 2025-01-15T03:22:01Z — agent-web01: Multiple failed SSH logins
[L10] 2025-01-15T03:21:45Z — agent-web01: SSH brute force attempt
```

**Notes de sécurité** : Les paramètres sont validés par Zod avant transmission à `WazuhClient`.

---

### 5. `analyze_log`

**Description** : Recherche un motif en texte fixe dans un fichier de log sur une VM via SSH (grep `-F`, sans regex).

| Champ | Valeur |
|---|---|
| Catégorie | `read` |
| Rôle requis | `viewer` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `vmHost` | `string` | IPv4 ou hostname DNS valide | Adresse de la VM |
| `logPath` | `string` | chemin absolu (commence par `/`), min 2 chars | Chemin du fichier de log |
| `pattern` | `string` | min 1 caractère | Motif à rechercher (texte fixe) |

**Exemple de demande** : *"Cherche 'OOM' dans /var/log/syslog sur 192.168.10.5."*

**Exemple de résultat** :
```
Fichier: /var/log/syslog sur 192.168.10.5
Motif "OOM": 3 occurrence(s)

Extraits (max 20 lignes):
  Jan 15 02:14:33 kernel: OOM killer invoked...
```

**Notes de sécurité** : `logPath` est validé (doit commencer par `/`, sans composant `..`, sans octet nul). `pattern` passé avec `grep -F` (texte fixe, pas de regex). Tous les args via `execFile` sans interpolation shell.

---

### 6. `get_zabbix_metrics`

**Description** : Récupère les métriques de monitoring Zabbix pour un hôte, un indicateur et une période donnés.

| Champ | Valeur |
|---|---|
| Catégorie | `read` |
| Rôle requis | `viewer` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `hostName` | `string` | min 1 caractère | Nom de l'hôte dans Zabbix |
| `metricName` | `string` | min 1 caractère | Clé de la métrique (ex. `system.cpu.load`) |
| `period` | `string` | min 1 caractère | Période (ex. `1h`, `24h`, `7d`) |

**Exemple de demande** : *"Montre la charge CPU de web-prod sur les dernières 24 heures."*

**Exemple de résultat** :
```
Métrique "system.cpu.load" sur "web-prod" — 144 points (24h):
  2025-01-15T08:00:00.000Z: 0.42
  2025-01-15T09:00:00.000Z: 0.38
  ...
```

**Notes de sécurité** : Paramètres validés par Zod.

---

## Outils de modification (`modify`) — Rôle minimum : `operator`

### 7. `create_vm`

**Description** : Provisionne une nouvelle VM dans l'infrastructure via Terraform (écrit les `tfvars`, lance `plan` puis `apply`).

| Champ | Valeur |
|---|---|
| Catégorie | `modify` |
| Rôle requis | `operator` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `name` | `string` | `[a-z0-9-]+` | Nom de la VM (identifiant Terraform) |
| `vlan` | `"mgt"` \| `"srv"` \| `"dmz"` | enum strict | Segment réseau cible |
| `memory` | `number` | entier ≥ 256 | RAM en Mo |
| `cores` | `number` | entier ≥ 1 | Nombre de cœurs CPU |
| `disk` | `number` | entier ≥ 1 | Taille disque en Go |

**Exemple de demande** : *"Crée une VM 'web-staging' sur le VLAN srv avec 2 Go de RAM et 2 cœurs."*

**Notes de sécurité** : `name` est validé par regex (évite les injections HCL). Tous les args Terraform passés via `execFile` (pas d'interpolation shell).

---

### 8. `restart_service`

**Description** : Redémarre un service systemd sur une VM via SSH.

| Champ | Valeur |
|---|---|
| Catégorie | `modify` |
| Rôle requis | `operator` |
| Confirmation | **Oui** — dialogue de confirmation |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `vmHost` | `string` | IPv4 ou hostname DNS valide | Adresse de la VM |
| `serviceName` | `string` | `[A-Za-z0-9._@-]+` | Nom du service systemd |

**Exemple de demande** : *"Redémarre nginx sur 192.168.10.5."*

**Notes de sécurité** : Même protections que `stop_service`. La confirmation est requise avant exécution.

---

### 9. `rollback`

**Description** : Revient à un commit git spécifique (`git checkout <sha>`) puis ré-exécute le playbook `site.yml` via Ansible.

| Champ | Valeur |
|---|---|
| Catégorie | `modify` |
| Rôle requis | `operator` |
| Confirmation | **Oui** — dialogue de confirmation |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `commitSha` | `string` | hex 7–40 caractères (`[0-9a-fA-F]{7,40}`) | SHA du commit cible |

**Exemple de demande** : *"Reviens au commit a1b2c3d sur l'infra."*

**Notes de sécurité** : `commitSha` validé par regex (aucun caractère non-hex). Exécution via `execFile` (pas de shell).

---

### 10. `deploy_role`

**Description** : Applique un rôle Ansible à une liste d'hôtes de l'infrastructure.

| Champ | Valeur |
|---|---|
| Catégorie | `modify` |
| Rôle requis | `operator` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `role` | `string` | `[a-z0-9_]+` | Nom du rôle Ansible |
| `hosts` | `string[]` | min 1 élément, chaque élément : IPv4 ou hostname valide | Hôtes cibles |
| `extraVars` | `object` | optionnel, nullable | Variables Ansible supplémentaires |

**Exemple de demande** : *"Déploie le rôle 'hardening' sur 192.168.10.5 et 192.168.10.6."*

**Notes de sécurité** : `role` validé par regex (évite la traversée de chemin dans le répertoire `roles/`). `hosts` validés par `vmHostSchema`.

---

### 11. `run_playbook`

**Description** : Exécute un playbook Ansible depuis le dépôt d'infrastructure.

| Champ | Valeur |
|---|---|
| Catégorie | `modify` |
| Rôle requis | `operator` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `playbookPath` | `string` | chemin relatif, sans `/` initial, sans `..` | Chemin du playbook dans le dépôt |

**Exemple de demande** : *"Lance le playbook update-packages.yml."*

**Notes de sécurité** : Le chemin est résolu via `path.resolve()` + `path.relative()` pour détecter toute tentative de traversée de chemin hors du dépôt.

---

### 12. `generate_role`

**Description** : Génère un squelette de rôle Ansible (tasks, defaults, handlers, README) via le LLM configuré et écrit les fichiers dans le dépôt infra. Ne commit pas automatiquement.

| Champ | Valeur |
|---|---|
| Catégorie | `modify` |
| Rôle requis | `operator` |
| Confirmation | non |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `roleName` | `string` | `[a-z0-9_]+` | Nom du rôle (identifiant Ansible) |
| `description` | `string` | min 1 caractère | Description fonctionnelle du rôle |

**Exemple de demande** : *"Génère un rôle Ansible 'fail2ban' pour protéger SSH."*

**Notes de sécurité** : `roleName` validé par regex (évite la traversée de chemin). Chaque fichier parsé est vérifié (pas de chemin absolu, pas de `..`). Les données du LLM sont considérées non fiables : seule la structure de fichiers attendue est acceptée.

---

## Outils de destruction (`destroy`) — Rôle minimum : `admin`

### 13. `destroy_vm`

**Description** : Détruit une VM Proxmox via Terraform (`terraform destroy -target proxmox_vm_qemu.<name>`). Action irréversible.

| Champ | Valeur |
|---|---|
| Catégorie | `destroy` |
| Rôle requis | `admin` |
| Confirmation | **Oui — confirmation typée** : saisir le nom exact de la VM |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `vmid` | `number` | entier positif | Identifiant numérique de la VM à détruire |

**Exemple de demande** : *"Détruis la VM 105."* → L'interface demande : *"Tapez le nom de la VM pour confirmer : `web-old`"*

**Notes de sécurité** :
- Le nom de la VM est résolu depuis Proxmox via `list_vms`, puis validé contre `[a-z0-9]([a-z0-9-]*[a-z0-9])?` avant construction de la cible Terraform.
- Un nom non conforme (caractères non autorisés) déclenche une erreur immédiate — l'outil refuse de construire la cible.
- Limite de débit : 1 appel / 60 secondes.
- L'admin doit taper le nom exact de la VM (confirmation typée) pour prévenir les destructions accidentelles.

---

### 14. `stop_service`

**Description** : Arrête un service systemd sur une VM via SSH. Action destructive/perturbatrice.

| Champ | Valeur |
|---|---|
| Catégorie | `destroy` |
| Rôle requis | `admin` |
| Confirmation | **Oui** — dialogue de confirmation |

**Paramètres** :

| Nom | Type | Contrainte | Description |
|---|---|---|---|
| `vmHost` | `string` | IPv4 ou hostname DNS valide | Adresse de la VM |
| `serviceName` | `string` | `[A-Za-z0-9._@-]+` | Nom du service systemd |

**Exemple de demande** : *"Arrête le service mysql sur 192.168.10.10."*

**Notes de sécurité** : `vmHost` validé par `vmHostSchema` (anti-SSRF). `serviceName` passé comme argument `execFile` séparé (pas d'interpolation shell). Limite de débit : 1 appel / 60 secondes.

---

## Récapitulatif de sécurité par outil

| Outil | Validation | Confirmation | Débit |
|---|---|---|---|
| list_vms | — | — | ∞ |
| get_vm_status | vmid entier positif | — | ∞ |
| service_status | vmHostSchema + serviceName regex | — | ∞ |
| search_wazuh_alerts | Zod string/int | — | ∞ |
| analyze_log | logPath absolu, no `..`, no NUL ; grep -F | — | ∞ |
| get_zabbix_metrics | Zod string | — | ∞ |
| create_vm | name regex + vlan enum + int min | — | 5/min |
| restart_service | vmHostSchema + serviceName regex | Dialogue | 5/min |
| rollback | commitSha hex regex | Dialogue | 5/min |
| deploy_role | role regex + vmHostSchema | — | 5/min |
| run_playbook | chemin relatif + vérif. traversée | — | 5/min |
| generate_role | roleName regex + vérif. fichiers | — | 5/min |
| destroy_vm | vmid entier + name regex | **Typée (nom VM)** | 1/min |
| stop_service | vmHostSchema + serviceName regex | Dialogue | 1/min |

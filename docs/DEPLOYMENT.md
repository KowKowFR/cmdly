# Guide de déploiement CMDLY

---

## Prérequis système (toutes méthodes)

| Composant | Version minimale | Obligatoire |
|---|---|---|
| Node.js | 20 LTS | Oui |
| PostgreSQL | 14 | Oui |
| Terraform | Dernière version stable | Pour create_vm / destroy_vm |
| Ansible | Dernière version stable | Pour deploy_role, run_playbook, rollback, generate_role |
| Git | 2.x | Pour le dépôt infra (rollback) |

> **Important** : Terraform et Ansible doivent être installés sur le **serveur hébergeant CMDLY** (l'application les appelle via `execFile`).

---

## 1. Installation manuelle

### 1.1 Cloner et installer les dépendances

```bash
git clone <url-du-depot> /opt/cmdly
cd /opt/cmdly
npm install
```

### 1.2 Configurer les variables d'environnement

```bash
cp .env.example .env
# Éditer .env avec les valeurs réelles
```

Contenu minimal du fichier `.env` :

```env
# Base de données PostgreSQL
DATABASE_URL=postgresql://cmdly:motdepasse@localhost:5432/cmdly

# Clé de session (better-auth) ET clé de chiffrement AES des secrets infra
# Utiliser une chaîne aléatoire d'au moins 32 caractères
BETTER_AUTH_SECRET=remplacer-par-une-valeur-aleatoire-longue

# URL publique de l'application (sans slash final)
BETTER_AUTH_URL=https://cmdly.example.com
```

### 1.3 Créer la base de données

```bash
sudo -u postgres psql -c "CREATE USER cmdly WITH PASSWORD 'motdepasse';"
sudo -u postgres psql -c "CREATE DATABASE cmdly OWNER cmdly;"
```

### 1.4 Appliquer les migrations

```bash
npx drizzle-kit migrate
```

### 1.5 Construire et démarrer

```bash
npm run build
npm start
# → écoute sur le port 3000 par défaut
```

---

## 2. Script d'installation automatisé

Un script d'installation Bash est prévu pour les distributions Debian/Ubuntu (Task 20 du projet).

```bash
# Installation via curl (Debian/Ubuntu)
curl -fsSL https://cmdly.example.com/install.sh | bash
```

Le script installe les dépendances système (Node.js, PostgreSQL), clone le dépôt, configure le fichier `.env` de façon interactive, applique les migrations et configure le service systemd.

> Le script `scripts/install.sh` sera disponible dans une prochaine version. Utiliser l'installation manuelle en attendant.

---

## 3. Déploiement Docker (suggestion)

Les fichiers ci-dessous sont fournis à titre indicatif et peuvent être adaptés selon l'environnement cible.

### `Dockerfile` (suggéré)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### `docker-compose.yml` (suggéré)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: cmdly
      POSTGRES_USER: cmdly
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cmdly"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://cmdly:${POSTGRES_PASSWORD}@db:5432/cmdly
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL}
    ports:
      - "3000:3000"
    # Si Terraform/Ansible sont requis, monter les binaires hôte :
    volumes:
      - /usr/bin/terraform:/usr/bin/terraform:ro
      - /usr/bin/ansible-playbook:/usr/bin/ansible-playbook:ro
      - /path/to/infra-repo:/infra:rw

volumes:
  pgdata:
```

### Appliquer les migrations avec Docker

```bash
docker compose run --rm app npx drizzle-kit migrate
docker compose up -d
```

---

## 4. Service systemd

Créer le fichier `/etc/systemd/system/cmdly.service` :

```ini
[Unit]
Description=CMDLY — Tableau de bord infra piloté par IA
After=network.target postgresql.service

[Service]
Type=simple
User=cmdly
WorkingDirectory=/opt/cmdly
EnvironmentFile=/opt/cmdly/.env
ExecStart=/usr/bin/node /opt/cmdly/.next/standalone/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
# Durcissement
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable cmdly
sudo systemctl start cmdly
sudo journalctl -u cmdly -f
```

---

## 5. Reverse proxy Nginx + HTTPS (Let's Encrypt)

### Configuration Nginx

Créer `/etc/nginx/sites-available/cmdly` :

```nginx
server {
    listen 80;
    server_name cmdly.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name cmdly.example.com;

    ssl_certificate /etc/letsencrypt/live/cmdly.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cmdly.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # SSE : désactiver le buffering pour les événements en temps réel
    location /api/chat/stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cmdly /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Certificat Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d cmdly.example.com
# Renouvellement automatique via cron/systemd timer (installé par certbot)
```

---

## 6. Post-installation

1. Accéder à `https://cmdly.example.com` — le wizard d'onboarding s'ouvre automatiquement.
2. Compléter les 12 étapes : création du compte admin, configuration Proxmox, dépôt infra, SSH, Vault Ansible, LLM, Zabbix, Wazuh, LDAP (optionnel).
3. Vérifier la santé de l'application : `GET /api/health` doit retourner `{ "status": "ok" }`.

---

## 7. Variables d'environnement complètes

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | Oui | URL de connexion PostgreSQL |
| `BETTER_AUTH_SECRET` | Oui | Clé de session et clé de chiffrement AES (≥ 32 caractères) |
| `BETTER_AUTH_URL` | Oui | URL publique de l'application |
| `NODE_ENV` | Recommandé | Mettre `production` en production |
| `PORT` | Non | Port d'écoute (défaut : 3000) |

Les secrets d'infrastructure (clés API Proxmox, Zabbix, Wazuh, LDAP, LLM) sont configurés via le wizard d'onboarding et stockés **chiffrés en base** — ils ne sont pas dans le fichier `.env`.

#!/usr/bin/env bash
# CMDLY — idempotent installer for Debian 12+ / Ubuntu 22+
# Usage: sudo bash install.sh
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
CMDLY_REPO_URL="https://github.com/PLACEHOLDER/cmdly.git"   # set at publish time
CMDLY_DIR="/opt/cmdly"
CMDLY_USER="cmdly"
CMDLY_PORT="3000"
PG_DB="cmdly"
PG_USER="cmdly"
NODE_MIN_VERSION=20
PG_MIN_VERSION=15

# ─── Helpers ──────────────────────────────────────────────────────────────────
log()  { printf '\e[32m[CMDLY]\e[0m %s\n' "$*"; }
warn() { printf '\e[33m[WARN]\e[0m %s\n' "$*" >&2; }
die()  { printf '\e[31m[ERROR]\e[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  if [[ "$EUID" -ne 0 ]]; then
    die "This installer must be run as root. Try: sudo bash install.sh"
  fi
}

# ─── Step 0: Require root ─────────────────────────────────────────────────────
require_root

# ─── Step 1: Verify OS ────────────────────────────────────────────────────────
log "Checking OS compatibility..."

if [[ ! -f /etc/os-release ]]; then
  die "Cannot detect OS — /etc/os-release not found. Debian 12+ or Ubuntu 22+ required."
fi

# shellcheck source=/dev/null
. /etc/os-release

case "${ID:-}" in
  debian)
    VERSION_NUM="${VERSION_ID:-0}"
    if [[ "${VERSION_NUM%%.*}" -lt 12 ]]; then
      die "Debian ${VERSION_ID:-unknown} is not supported. Debian 12 (Bookworm) or newer is required."
    fi
    log "Detected Debian ${VERSION_ID}. OK."
    ;;
  ubuntu)
    VERSION_NUM="${VERSION_ID:-0}"
    MAJOR="${VERSION_NUM%%.*}"
    if [[ "$MAJOR" -lt 22 ]]; then
      die "Ubuntu ${VERSION_ID:-unknown} is not supported. Ubuntu 22.04 LTS or newer is required."
    fi
    log "Detected Ubuntu ${VERSION_ID}. OK."
    ;;
  *)
    die "Unsupported OS: '${ID:-unknown}'. Debian 12+ or Ubuntu 22+ required."
    ;;
esac

apt-get update -qq

# ─── Step 2: Install Node.js 20 ───────────────────────────────────────────────
log "Checking Node.js..."

install_nodejs=true
if command -v node &>/dev/null; then
  node_raw="$(node -v)"              # e.g. v20.11.0
  node_major="${node_raw#v}"
  node_major="${node_major%%.*}"
  if [[ "$node_major" -ge "$NODE_MIN_VERSION" ]]; then
    log "Node.js ${node_raw} already installed. Skipping."
    install_nodejs=false
  else
    log "Node.js ${node_raw} is too old (need >= ${NODE_MIN_VERSION})."
  fi
fi

if [[ "$install_nodejs" == true ]]; then
  log "Installing Node.js ${NODE_MIN_VERSION} via NodeSource..."
  apt-get install -y -qq ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MIN_VERSION}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
  log "Node.js $(node -v) installed."
fi

# ─── Step 3: Install Terraform ────────────────────────────────────────────────
log "Checking Terraform..."

if command -v terraform &>/dev/null; then
  log "Terraform $(terraform version -json | grep -oP '"terraform_version":"\K[^"]+' || terraform version | head -1) already installed. Skipping."
else
  log "Installing Terraform via HashiCorp APT repo..."
  apt-get install -y -qq gnupg software-properties-common lsb-release
  curl -fsSL https://apt.releases.hashicorp.com/gpg \
    | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/hashicorp.list
  apt-get update -qq
  apt-get install -y -qq terraform
  log "Terraform $(terraform version | head -1) installed."
fi

# ─── Step 4: Install Ansible ──────────────────────────────────────────────────
log "Checking Ansible..."

if command -v ansible &>/dev/null; then
  log "Ansible $(ansible --version | head -1) already installed. Skipping."
else
  log "Installing Ansible..."
  apt-get install -y -qq ansible
  log "Ansible $(ansible --version | head -1) installed."
fi

# ─── Step 5: Install PostgreSQL + create DB/user ──────────────────────────────
log "Checking PostgreSQL..."

pg_installed=false
if command -v psql &>/dev/null; then
  pg_ver="$(psql --version | grep -oP '\d+' | head -1)"
  if [[ "$pg_ver" -ge "$PG_MIN_VERSION" ]]; then
    log "PostgreSQL ${pg_ver} already installed. Skipping installation."
    pg_installed=true
  fi
fi

if [[ "$pg_installed" == false ]]; then
  log "Installing PostgreSQL..."
  apt-get install -y -qq postgresql
  systemctl enable postgresql
  systemctl start postgresql
  log "PostgreSQL installed."
fi

# Generate PG password only once (stored in a temp var; written to .env later)
PG_PASSWORD_FILE="/root/.cmdly_pgpass"
if [[ -f "$PG_PASSWORD_FILE" ]]; then
  PG_PASSWORD="$(cat "$PG_PASSWORD_FILE")"
  log "Using existing generated PostgreSQL password."
else
  PG_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  printf '%s' "$PG_PASSWORD" > "$PG_PASSWORD_FILE"
  chmod 600 "$PG_PASSWORD_FILE"
  log "Generated new PostgreSQL password (saved to ${PG_PASSWORD_FILE})."
fi

# Create DB role + database (idempotent)
log "Ensuring PostgreSQL role '${PG_USER}' and database '${PG_DB}' exist..."

su -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'\" | grep -q 1 \
  || psql -c \"CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}'\"" postgres

su -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${PG_DB}'\" | grep -q 1 \
  || psql -c \"CREATE DATABASE ${PG_DB} OWNER ${PG_USER}\"" postgres

log "PostgreSQL role and database ready."

# ─── Step 6: Clone / update CMDLY repo ───────────────────────────────────────
log "Setting up CMDLY application..."

if [[ -d "${CMDLY_DIR}/.git" ]]; then
  log "CMDLY already cloned at ${CMDLY_DIR}. Running git pull..."
  git -C "$CMDLY_DIR" pull --ff-only
else
  log "Cloning CMDLY into ${CMDLY_DIR}..."
  git clone "$CMDLY_REPO_URL" "$CMDLY_DIR"
fi

# ─── Step 7: npm install + build ─────────────────────────────────────────────
log "Installing npm dependencies and building..."
cd "$CMDLY_DIR"

if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

npm run build
log "Build complete."

# ─── Step 8: Write .env if absent ────────────────────────────────────────────
log "Checking .env configuration..."

ENV_FILE="${CMDLY_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  log ".env already exists at ${ENV_FILE}. Skipping generation."
else
  log "Generating .env..."
  BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
  HOST_IP="$(hostname -I | awk '{print $1}')"

  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${PG_DB}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=http://${HOST_IP}:${CMDLY_PORT}
NEXT_PUBLIC_APP_URL=http://${HOST_IP}:${CMDLY_PORT}
EOF
  chmod 640 "$ENV_FILE"
  log ".env written to ${ENV_FILE} (secrets NOT echoed to this log)."
fi

# ─── Step 9: Run DB migrations ───────────────────────────────────────────────
log "Running database migrations..."
cd "$CMDLY_DIR"
# Load env so drizzle-kit can connect
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
npx drizzle-kit migrate
log "Migrations complete."

# ─── Step 10: systemd service ────────────────────────────────────────────────
log "Configuring systemd service..."

# Create system user if needed
if ! id "$CMDLY_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$CMDLY_USER"
  log "System user '${CMDLY_USER}' created."
fi

# Ensure the app directory is owned by the cmdly user
chown -R "${CMDLY_USER}:${CMDLY_USER}" "$CMDLY_DIR"

SERVICE_FILE="/etc/systemd/system/cmdly.service"

if [[ -f "$SERVICE_FILE" ]]; then
  log "systemd unit already exists at ${SERVICE_FILE}. Skipping creation."
else
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=CMDLY AI Infrastructure Dashboard
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${CMDLY_USER}
WorkingDirectory=${CMDLY_DIR}
EnvironmentFile=${CMDLY_DIR}/.env
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cmdly

[Install]
WantedBy=multi-user.target
EOF
  log "systemd unit written to ${SERVICE_FILE}."
fi

systemctl daemon-reload
systemctl enable cmdly
systemctl restart cmdly
log "CMDLY service enabled and started."

# ─── Step 11: Print access info ──────────────────────────────────────────────
HOST_IP="$(hostname -I | awk '{print $1}')"

printf '\n'
printf '╔══════════════════════════════════════════════════════╗\n'
printf '║            CMDLY installation complete!              ║\n'
printf '╠══════════════════════════════════════════════════════╣\n'
printf '║  Access URL : http://%-31s║\n' "${HOST_IP}:${CMDLY_PORT}"
printf '║  .env path  : %-37s║\n' "${ENV_FILE}"
printf '╠══════════════════════════════════════════════════════╣\n'
printf '║  Next steps:                                         ║\n'
printf '║  1. Open the URL above in your browser.              ║\n'
printf '║  2. Complete the onboarding wizard to create the     ║\n'
printf '║     first admin account and configure your infra.    ║\n'
printf '║  3. (Optional) Run: npx tsx scripts/seed.ts          ║\n'
printf '║     to pre-create an admin user non-interactively.   ║\n'
printf '╚══════════════════════════════════════════════════════╝\n'
printf '\n'

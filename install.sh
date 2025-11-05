#!/bin/bash

# Interactive install script for n8n-daemon on Ubuntu

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Welcome to n8n-daemon Interactive Installer${NC}"
echo "This script will guide you through the installation on Ubuntu."
echo "It will install prerequisites, set up the daemon, generate an API key, and configure the service."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run this script as root (use sudo)${NC}"
  exit 1
fi

# Function to prompt yes/no
prompt_yes_no() {
  while true; do
    read -p "$1 (y/n): " yn
    case $yn in
      [Yy]* ) return 0;;
      [Nn]* ) return 1;;
      * ) echo "Please answer y or n.";;
    esac
  done
}

# Safely set or update a key=value in an .env file
set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  # Escape sed replacement special chars: & and the chosen delimiter |
  local escaped_value
  escaped_value=$(printf '%s' "$value" | sed 's/[&|]/\\&/g')
  if grep -q "^${key}=" "$file"; then
    sed -i -E "s|^${key}=.*$|${key}=${escaped_value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# Read a value from .env; outputs empty string if not present
get_env_var() {
  local key="$1"
  local file="$2"
  if [ -f "$file" ]; then
    grep -E "^${key}=" "$file" | head -n1 | cut -d'=' -f2-
  else
    echo ""
  fi
}

# Detect placeholder-like API key values from the example file
is_placeholder_api_key() {
  local value="$1"
  if echo "$value" | grep -q "^your-secure-api-key-here"; then
    return 0
  else
    return 1
  fi
}

# Step 1: Update system and install basics
echo -e "${GREEN}Updating system packages...${NC}"
apt update && apt upgrade -y
apt install -y curl git

# Step 2: Install Node.js if not present
if ! command -v node &> /dev/null; then
  if prompt_yes_no "Node.js is not installed. Install Node.js 18?"; then
    echo -e "${GREEN}Installing Node.js 18...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
  else
    echo -e "${RED}Node.js is required. Exiting.${NC}"
    exit 1
  fi
else
  NODE_VERSION=$(node -v | cut -d. -f1 | sed 's/v//')
  if [ "$NODE_VERSION" -lt 18 ]; then
    if prompt_yes_no "Node.js version is $NODE_VERSION (needs 18+). Upgrade?"; then
      curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
      apt-get install -y nodejs
    else
      echo -e "${RED}Node.js 18+ is required. Exiting.${NC}"
      exit 1
    fi
  else
    echo -e "${GREEN}Node.js $(node -v) is already installed.${NC}"
  fi
fi

# Ensure npm is available system-wide (handles NVM-only setups)
if ! command -v npm &> /dev/null; then
  echo -e "${YELLOW}npm not found in PATH. Installing Node.js with npm (NodeSource 20.x)...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Step 3: Install Docker if not present
if ! command -v docker &> /dev/null; then
  if prompt_yes_no "Docker is not installed. Install Docker?"; then
    echo -e "${GREEN}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $USER
  else
    echo -e "${RED}Docker is required. Exiting.${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}Docker is already installed.${NC}"
fi

# Optional: Install and configure HAProxy for database proxying
if prompt_yes_no "Install and configure HAProxy for database proxying?"; then
  echo -e "${GREEN}Installing HAProxy...${NC}"
  apt install -y haproxy

  # Offer to generate a minimal TCP pass-through config
  if prompt_yes_no "Generate HAProxy config for database proxying now?"; then
    read -p "Database type (postgres/mysql) [postgres]: " DB_TYPE
    DB_TYPE=${DB_TYPE:-postgres}
    if [ "$DB_TYPE" = "mysql" ]; then DEFAULT_PORT=3306; else DEFAULT_PORT=5432; fi

    read -p "Frontend bind address [0.0.0.0]: " BIND_ADDR
    BIND_ADDR=${BIND_ADDR:-0.0.0.0}
    read -p "Frontend port [${DEFAULT_PORT}]: " FRONT_PORT
    FRONT_PORT=${FRONT_PORT:-$DEFAULT_PORT}
    read -p "Allowed CIDR (e.g., 10.0.0.0/8, leave blank to allow all): " ALLOWED_CIDR
    read -p "Backend servers (comma-separated host:port): " BACKENDS

    IFS=',' read -ra ADDR <<< "$BACKENDS"
    BACKEND_LINES=""
    for s in "${ADDR[@]}"; do
      s_trim=$(echo "$s" | xargs)
      if [ -n "$s_trim" ]; then
        BACKEND_LINES="${BACKEND_LINES}    server $(echo "$s_trim" | sed 's/[^A-Za-z0-9]/_/g') $s_trim check inter 2s rise 3 fall 3 maxconn 200\n"
      fi
    done

    if [ -z "$BACKEND_LINES" ]; then
      echo -e "${YELLOW}No backend servers provided. Skipping HAProxy config generation.${NC}"
    else
      echo -e "${GREEN}Writing HAProxy config to /etc/haproxy/haproxy.cfg...${NC}"
      cat >/etc/haproxy/haproxy.cfg <<EOF
global
  log /dev/log local0
  log /dev/log local1 notice
  maxconn 4096
  daemon

defaults
  log     global
  mode    tcp
  option  tcplog
  timeout connect 5s
  timeout client  1m
  timeout server  1m
  option  tcp-check

frontend db_frontend
  bind ${BIND_ADDR}:${FRONT_PORT}
  default_backend db_backends
EOF
      if [ -n "$ALLOWED_CIDR" ]; then
        echo "  acl allowed_net src ${ALLOWED_CIDR}" >> /etc/haproxy/haproxy.cfg
        echo "  tcp-request connection reject if !allowed_net" >> /etc/haproxy/haproxy.cfg
      fi
      cat >>/etc/haproxy/haproxy.cfg <<EOF

backend db_backends
  balance roundrobin
  option tcp-check
$(echo -e "$BACKEND_LINES")
EOF

      if haproxy -c -f /etc/haproxy/haproxy.cfg; then
        systemctl enable haproxy
        systemctl restart haproxy
        echo -e "${GREEN}HAProxy configured and restarted on ${BIND_ADDR}:${FRONT_PORT}.${NC}"
      else
        echo -e "${RED}HAProxy config validation failed. File left in /etc/haproxy/haproxy.cfg.${NC}"
      fi
    fi
  else
    echo -e "${YELLOW}Skipping HAProxy config generation. You can edit /etc/haproxy/haproxy.cfg later.${NC}"
  fi
fi

# Step 4: Create dedicated user
if ! id "n8n-daemon" &> /dev/null; then
  if prompt_yes_no "Create dedicated user 'n8n-daemon'?"; then
    useradd -r -s /bin/false -d /opt/n8n-daemon -c "N8N Daemon User" n8n-daemon
    mkdir -p /opt/n8n-daemon
    chown n8n-daemon:n8n-daemon /opt/n8n-daemon
  else
    echo -e "${RED}Dedicated user is recommended. Exiting.${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}User 'n8n-daemon' already exists.${NC}"
fi

# Step 5: Clone repository
REPO_DIR="/opt/n8n-daemon/daemon"
if [ ! -d "$REPO_DIR" ]; then
  if prompt_yes_no "Clone repository to $REPO_DIR?"; then
    git clone https://github.com/eskemo-hub/instance-daemon.git $REPO_DIR
    chown -R n8n-daemon:n8n-daemon $REPO_DIR
  else
    echo -e "${RED}Repository is required. Exiting.${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}Repository already cloned at $REPO_DIR.${NC}"
  echo -e "${GREEN}Pulling latest changes...${NC}"
  # Pull latest code as daemon user; fast-forward only to avoid unintended merges
  if ! su -s /bin/bash n8n-daemon -c "git -C $REPO_DIR pull --ff-only"; then
    echo -e "${YELLOW}Fast-forward pull failed. Attempting hard reset to origin/main...${NC}"
    su -s /bin/bash n8n-daemon -c "git -C $REPO_DIR fetch --all --tags"
    su -s /bin/bash n8n-daemon -c "git -C $REPO_DIR reset --hard origin/main"
  fi
fi

# Configure Git safe.directory to prevent 'dubious ownership' errors when the service runs as root
if command -v git >/dev/null 2>&1; then
  echo -e "${GREEN}Configuring Git safe.directory for $REPO_DIR...${NC}"
  git config --system --add safe.directory "$REPO_DIR" || true
fi

# Step 6: Install dependencies and build
cd $REPO_DIR
NPM_BIN=$(command -v npm || true)
if [ -z "$NPM_BIN" ]; then
  # Try common npm path as fallback
  if [ -x "/usr/bin/npm" ]; then
    NPM_BIN="/usr/bin/npm"
  else
    echo -e "${RED}npm is still not available. Ensure Node.js (with npm) is installed system-wide.${NC}"
    echo -e "${YELLOW}You can re-run the installer after: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs${NC}"
    exit 1
  fi
fi

su -s /bin/bash n8n-daemon -c "$NPM_BIN install"
su -s /bin/bash n8n-daemon -c "$NPM_BIN run build"

# Restart service if already installed
if [ -f "/etc/systemd/system/n8n-daemon.service" ]; then
  echo -e "${GREEN}Restarting n8n-daemon service...${NC}"
  systemctl restart n8n-daemon || true
fi

# Step 7: Configure .env (preserve existing values; add only missing keys)
ENV_FILE="$REPO_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  su -s /bin/bash n8n-daemon -c "cp .env.example .env"
fi

CURRENT_API_KEY=$(get_env_var "API_KEY" "$ENV_FILE")
CURRENT_PORT=$(get_env_var "PORT" "$ENV_FILE")
CURRENT_NODE_ENV=$(get_env_var "NODE_ENV" "$ENV_FILE")

# API_KEY: generate only if missing
if [ -z "$CURRENT_API_KEY" ] || is_placeholder_api_key "$CURRENT_API_KEY"; then
  API_KEY=$(openssl rand -base64 32)
  echo -e "${GREEN}Generated API Key: $API_KEY${NC}"
  echo "Adding API_KEY to .env. Save it securely."
  set_env_var "API_KEY" "$API_KEY" "$ENV_FILE"
else
  echo -e "${GREEN}Preserving existing API_KEY in .env${NC}"
fi

# PORT: set only if missing
if [ -z "$CURRENT_PORT" ]; then
  read -p "Enter PORT (default 3001): " PORT
  PORT=${PORT:-3001}
  set_env_var "PORT" "$PORT" "$ENV_FILE"
else
  echo -e "${GREEN}Preserving existing PORT=$CURRENT_PORT in .env${NC}"
fi

# NODE_ENV: set only if missing
if [ -z "$CURRENT_NODE_ENV" ]; then
  read -p "Enter NODE_ENV (default production): " NODE_ENV
  NODE_ENV=${NODE_ENV:-production}
  set_env_var "NODE_ENV" "$NODE_ENV" "$ENV_FILE"
else
  echo -e "${GREEN}Preserving existing NODE_ENV=$CURRENT_NODE_ENV in .env${NC}"
fi

echo -e "${YELLOW}.env updated without overwriting existing values. Edit $ENV_FILE anytime.${NC}"

# Final summary
FINAL_PORT=$(get_env_var "PORT" "$ENV_FILE")
FINAL_API_KEY=$(get_env_var "API_KEY" "$ENV_FILE")
FINAL_NODE_ENV=$(get_env_var "NODE_ENV" "$ENV_FILE")

echo -e "${GREEN}Installation complete!${NC}"
echo "API Key: ${FINAL_API_KEY:-<not set>}"
echo "Daemon is running on port ${FINAL_PORT:-<not set>}"
echo "Environment: ${FINAL_NODE_ENV:-<not set>}"
echo "For troubleshooting, see the README."

# Step 8: Set up systemd service
if [ ! -f "/etc/systemd/system/n8n-daemon.service" ]; then
  if prompt_yes_no "Install systemd service?"; then
    cp $REPO_DIR/n8n-daemon.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable n8n-daemon
    systemctl start n8n-daemon
    echo -e "${GREEN}Service installed and started. Check status with: systemctl status n8n-daemon${NC}"
  else
    echo -e "${YELLOW}Skipping systemd setup.${NC}"
  fi
else
  echo -e "${GREEN}Systemd service already installed.${NC}"
  # Ensure unit file is up-to-date with repo version
  if cmp -s "$REPO_DIR/n8n-daemon.service" "/etc/systemd/system/n8n-daemon.service"; then
    echo -e "${GREEN}Service unit is up to date.${NC}"
  else
    echo -e "${YELLOW}Service unit has changed. Updating and restarting...${NC}"
    cp "$REPO_DIR/n8n-daemon.service" "/etc/systemd/system/n8n-daemon.service"
    systemctl daemon-reload
    systemctl restart n8n-daemon || true
    echo -e "${GREEN}Service unit updated and daemon restarted.${NC}"
  fi
fi

# Install or update systemd update service (runs update script on demand)
if [ ! -f "/etc/systemd/system/n8n-daemon-update.service" ]; then
  echo -e "${GREEN}Installing n8n-daemon-update service...${NC}"
  cp "$REPO_DIR/n8n-daemon-update.service" "/etc/systemd/system/"
  systemctl daemon-reload
  echo -e "${GREEN}Update service installed. It will be triggered by the API when needed.${NC}"
else
  echo -e "${GREEN}Update service already installed.${NC}"
  if ! cmp -s "$REPO_DIR/n8n-daemon-update.service" "/etc/systemd/system/n8n-daemon-update.service"; then
    echo -e "${YELLOW}Update service unit has changed. Updating...${NC}"
    cp "$REPO_DIR/n8n-daemon-update.service" "/etc/systemd/system/n8n-daemon-update.service"
    systemctl daemon-reload
    echo -e "${GREEN}Update service unit updated.${NC}"
  fi
fi

# Ensure the update script is executable
chmod +x "$REPO_DIR/update-from-github.sh"

echo -e "${GREEN}Installation complete!${NC}"
echo "API Key: $API_KEY"
echo "Daemon is running on port $PORT."
echo "For troubleshooting, see the README."
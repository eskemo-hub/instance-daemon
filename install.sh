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

# Step 7: Configure .env
ENV_FILE="$REPO_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  su -s /bin/bash n8n-daemon -c "cp .env.example .env"
fi

# Generate API key
API_KEY=$(openssl rand -base64 32)
echo -e "${GREEN}Generated API Key: $API_KEY${NC}"
echo "Please save this securely. It will be added to .env."

# Prompt for other configs
read -p "Enter PORT (default 3001): " PORT
PORT=${PORT:-3001}

read -p "Enter NODE_ENV (default production): " NODE_ENV
NODE_ENV=${NODE_ENV:-production}

# Update .env
set_env_var "PORT" "$PORT" "$ENV_FILE"
set_env_var "API_KEY" "$API_KEY" "$ENV_FILE"
set_env_var "NODE_ENV" "$NODE_ENV" "$ENV_FILE"

echo -e "${YELLOW}.env file configured. You can edit $ENV_FILE later if needed.${NC}"

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

echo -e "${GREEN}Installation complete!${NC}"
echo "API Key: $API_KEY"
echo "Daemon is running on port $PORT."
echo "For troubleshooting, see the README."
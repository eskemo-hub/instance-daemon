#!/bin/bash

# n8n Daemon - Install from Private GitHub Repository
# This script installs the daemon directly from GitHub

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   n8n Daemon GitHub Installation      ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo ""

# Configuration
GITHUB_REPO="${GITHUB_REPO:-eskemo-hub/n8n-daemon}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
INSTALL_DIR="/opt/n8n-daemon"
DAEMON_USER="n8n-daemon"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Error: Please run as root (use sudo)${NC}"
    exit 1
fi

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}GitHub Personal Access Token required for private repository${NC}"
    echo ""
    echo "Please set GITHUB_TOKEN environment variable:"
    echo "  export GITHUB_TOKEN=your_github_token_here"
    echo ""
    echo "To create a token:"
    echo "  1. Go to https://github.com/settings/tokens"
    echo "  2. Click 'Generate new token (classic)'"
    echo "  3. Select 'repo' scope"
    echo "  4. Generate and copy the token"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ GitHub token found${NC}"
echo ""

# Install prerequisites
echo -e "${BLUE}[1/9] Installing prerequisites...${NC}"
apt-get update -qq
apt-get install -y -qq git curl at haproxy socat > /dev/null 2>&1
echo -e "${GREEN}✓ Prerequisites installed (including HAProxy)${NC}"

# Configure HAProxy (initial setup)
echo -e "${BLUE}[2/9] Installing HAProxy...${NC}"
systemctl enable haproxy
echo -e "${GREEN}✓ HAProxy installed${NC}"

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo -e "${BLUE}[3/9] Installing Node.js 18...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
    echo -e "${GREEN}✓ Node.js installed: $(node --version)${NC}"
else
    echo -e "${BLUE}[3/9] Node.js already installed${NC}"
    echo -e "${GREEN}✓ Node.js version: $(node --version)${NC}"
fi

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo -e "${BLUE}[4/9] Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
    systemctl start docker
    systemctl enable docker
    echo -e "${GREEN}✓ Docker installed: $(docker --version)${NC}"
else
    echo -e "${BLUE}[4/9] Docker already installed${NC}"
    echo -e "${GREEN}✓ Docker version: $(docker --version)${NC}"
fi

# Create daemon user if not exists
if ! id "$DAEMON_USER" &>/dev/null; then
    echo -e "${BLUE}[5/9] Creating daemon user...${NC}"
    useradd -r -s /bin/bash -d "$INSTALL_DIR" -m "$DAEMON_USER"
    usermod -aG docker "$DAEMON_USER"
    # Add daemon user to haproxy group for config management
    usermod -aG haproxy "$DAEMON_USER"
    echo -e "${GREEN}✓ User created: $DAEMON_USER${NC}"
else
    echo -e "${BLUE}[5/9] Daemon user already exists${NC}"
    usermod -aG haproxy "$DAEMON_USER" 2>/dev/null || true
    echo -e "${GREEN}✓ User: $DAEMON_USER${NC}"
fi

# Backup existing installation
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "${BLUE}[6/9] Backing up existing installation...${NC}"
    BACKUP_DIR="$INSTALL_DIR.backup.$(date +%Y%m%d_%H%M%S)"
    cp -r "$INSTALL_DIR" "$BACKUP_DIR"
    echo -e "${GREEN}✓ Backup created: $BACKUP_DIR${NC}"
else
    echo -e "${BLUE}[6/9] No existing installation found${NC}"
fi

# Clone or update repository
echo -e "${BLUE}[7/9] Downloading daemon from GitHub...${NC}"
if [ -d "$INSTALL_DIR/.git" ]; then
    # Update existing repository
    cd "$INSTALL_DIR"
    sudo -u "$DAEMON_USER" git fetch origin
    sudo -u "$DAEMON_USER" git reset --hard "origin/$GITHUB_BRANCH"
    echo -e "${GREEN}✓ Repository updated${NC}"
else
    # Fresh clone
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    
    # Clone using token
    git clone -b "$GITHUB_BRANCH" \
        "https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" \
        "$INSTALL_DIR" > /dev/null 2>&1
    
    # Initialize git in daemon directory for future updates
    cd "$INSTALL_DIR"
    
    echo -e "${GREEN}✓ Repository cloned${NC}"
fi

# Set ownership
chown -R "$DAEMON_USER:$DAEMON_USER" "$INSTALL_DIR"

# Install dependencies
echo -e "${BLUE}[8/9] Installing dependencies...${NC}"
cd "$INSTALL_DIR"
sudo -u "$DAEMON_USER" npm install --production > /dev/null 2>&1
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Build application
echo -e "${BLUE}[9/9] Building application...${NC}"
sudo -u "$DAEMON_USER" npm run build > /dev/null 2>&1
echo -e "${GREEN}✓ Application built${NC}"

# Configure HAProxy after daemon is installed
echo -e "${BLUE}Configuring HAProxy...${NC}"
mkdir -p /opt/n8n-daemon/haproxy
chown "$DAEMON_USER:$DAEMON_USER" /opt/n8n-daemon/haproxy

# Create initial HAProxy config
cat > /opt/n8n-daemon/haproxy/haproxy.cfg << 'EOF'
# HAProxy Configuration
# Initial config - daemon will regenerate with backends

global
    daemon
    maxconn 4096
    user haproxy
    group haproxy

defaults
    mode tcp
    timeout connect 10s
    timeout client 1m
    timeout server 1m

# Stats page
frontend stats
    bind *:8404
    mode http
    stats enable
    stats uri /stats
    stats refresh 10s
EOF

chown "$DAEMON_USER:$DAEMON_USER" /opt/n8n-daemon/haproxy/haproxy.cfg

# Configure HAProxy systemd to use writable config
mkdir -p /etc/systemd/system/haproxy.service.d
cat > /etc/systemd/system/haproxy.service.d/override.conf << 'HAPROXY_OVERRIDE'
[Service]
ExecStartPre=
ExecStartPre=/usr/sbin/haproxy -f /opt/n8n-daemon/haproxy/haproxy.cfg -c -q
ExecStart=
ExecStart=/usr/sbin/haproxy -Ws -f /opt/n8n-daemon/haproxy/haproxy.cfg -p /run/haproxy.pid
ExecReload=
ExecReload=/usr/sbin/haproxy -f /opt/n8n-daemon/haproxy/haproxy.cfg -c -q
ExecReload=/bin/kill -USR2 $MAINPID
HAPROXY_OVERRIDE

# Install sudoers file for HAProxy management
if [ -f "$INSTALL_DIR/haproxy-sudoers" ]; then
    cp "$INSTALL_DIR/haproxy-sudoers" /etc/sudoers.d/n8n-daemon-haproxy
    chmod 440 /etc/sudoers.d/n8n-daemon-haproxy
    visudo -c > /dev/null 2>&1 || echo -e "${YELLOW}⚠ Warning: sudoers syntax check failed${NC}"
fi

# Reload systemd and start HAProxy
systemctl daemon-reload
systemctl restart haproxy

if systemctl is-active --quiet haproxy; then
    echo -e "${GREEN}✓ HAProxy configured and started${NC}"
else
    echo -e "${YELLOW}⚠ HAProxy failed to start (will retry after daemon starts)${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Installation Complete! ✓             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if .env exists
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo -e "${YELLOW}⚠ Configuration Required${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Configure environment:"
    echo "     sudo nano $INSTALL_DIR/.env"
    echo ""
    echo "  2. Generate API key:"
    echo "     openssl rand -base64 32"
    echo ""
    echo "  3. Set up systemd service:"
    echo "     sudo cp $INSTALL_DIR/n8n-daemon.service /etc/systemd/system/"
    echo "     sudo systemctl daemon-reload"
    echo "     sudo systemctl enable n8n-daemon"
    echo "     sudo systemctl start n8n-daemon"
    echo ""
else
    echo -e "${GREEN}✓ Configuration file exists${NC}"
    echo ""
    echo "Restart the daemon to apply updates:"
    echo "  sudo systemctl restart n8n-daemon"
    echo ""
fi

echo "View logs:"
echo "  sudo journalctl -u n8n-daemon -f"
echo ""

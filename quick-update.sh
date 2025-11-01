#!/bin/bash

# Quick Update Script - Fast daemon update with minimal checks
# Use this when you just want to pull latest code and restart

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🚀 Quick Daemon Update${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root: sudo $0${NC}"
    exit 1
fi

cd /opt/n8n-daemon/daemon

# Stop daemon
echo "1. Stopping daemon..."
systemctl stop n8n-daemon 2>/dev/null || true

# Pull latest
echo "2. Pulling latest code..."
sudo -u n8n-daemon git fetch origin
sudo -u n8n-daemon git reset --hard origin/main

# Install deps (only if package.json changed)
if git diff HEAD@{1} --name-only | grep -q "package.json"; then
    echo "3. Installing dependencies..."
    sudo -u n8n-daemon npm install --production
else
    echo "3. Skipping dependencies (no changes)"
fi

# Build
echo "4. Building..."
sudo -u n8n-daemon npm run build

# Start daemon
echo "5. Starting daemon..."
systemctl start n8n-daemon

# Wait and check
sleep 2
if systemctl is-active --quiet n8n-daemon; then
    echo -e "${GREEN}✓ Update complete!${NC}"
    echo ""
    echo "Check status: systemctl status n8n-daemon"
    echo "View logs: journalctl -u n8n-daemon -f"
else
    echo -e "${RED}✗ Daemon failed to start${NC}"
    echo "Check logs: journalctl -u n8n-daemon -n 50"
    exit 1
fi

#!/bin/bash

# Fix permissions for n8n daemon installation
# Run this if git operations fail due to permission issues

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Fix n8n Daemon Permissions          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Configuration
INSTALL_DIR="/opt/n8n-daemon/daemon"
DAEMON_USER="n8n-daemon"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Error: Please run as root (use sudo)${NC}"
    exit 1
fi

# Check if daemon directory exists
if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${RED}Error: Daemon not installed at $INSTALL_DIR${NC}"
    exit 1
fi

echo -e "${BLUE}[1/3] Stopping daemon...${NC}"
systemctl stop n8n-daemon || true
echo -e "${GREEN}✓ Daemon stopped${NC}"

echo -e "${BLUE}[2/3] Fixing ownership...${NC}"
chown -R "$DAEMON_USER:$DAEMON_USER" "$INSTALL_DIR"
echo -e "${GREEN}✓ Ownership fixed${NC}"

echo -e "${BLUE}[3/3] Resetting git state...${NC}"
cd "$INSTALL_DIR"
sudo -u "$DAEMON_USER" git reset --hard HEAD
sudo -u "$DAEMON_USER" git clean -fd
echo -e "${GREEN}✓ Git state reset${NC}"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Permissions Fixed! ✓                 ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo "You can now run the update script:"
echo "  sudo ./update-from-github.sh"
echo ""

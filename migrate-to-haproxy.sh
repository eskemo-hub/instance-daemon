#!/bin/bash

# Migrate existing server to add HAProxy for database routing
# This script adds HAProxy alongside Traefik (both are needed)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   HAProxy Migration Script            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Error: Please run as root (use sudo)${NC}"
    exit 1
fi

echo -e "${YELLOW}This script will:${NC}"
echo "  1. Install HAProxy (keeps Traefik for web apps)"
echo "  2. Configure HAProxy for database routing"
echo "  3. Update daemon to use HAProxy"
echo "  4. Restart services"
echo ""
echo -e "${YELLOW}Note: Traefik will remain for n8n instances${NC}"
echo -e "${YELLOW}      HAProxy will handle database routing${NC}"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Install HAProxy and socat
echo -e "${BLUE}[1/5] Installing HAProxy...${NC}"
apt-get update -qq
apt-get install -y -qq haproxy socat > /dev/null 2>&1
echo -e "${GREEN}✓ HAProxy installed: $(haproxy -v | head -1)${NC}"

# Configure HAProxy
echo -e "${BLUE}[2/5] Configuring HAProxy...${NC}"
mkdir -p /etc/haproxy/certs
mkdir -p /etc/haproxy/conf.d

# Backup existing config if present
if [ -f /etc/haproxy/haproxy.cfg ]; then
    cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.backup.$(date +%Y%m%d_%H%M%S)
fi

cat > /etc/haproxy/haproxy.cfg << 'EOF'
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

echo -e "${GREEN}✓ HAProxy configured${NC}"

# Set permissions and install sudoers
echo -e "${BLUE}[3/5] Setting permissions...${NC}"

# Add daemon user to haproxy group
DAEMON_USER="n8n-daemon"
if id "$DAEMON_USER" &>/dev/null; then
    usermod -aG haproxy "$DAEMON_USER"
    echo -e "${GREEN}✓ Added $DAEMON_USER to haproxy group${NC}"
fi

# Install sudoers file for HAProxy management
INSTALL_DIR="/opt/n8n-daemon/daemon"
if [ -f "$INSTALL_DIR/haproxy-sudoers" ]; then
    cp "$INSTALL_DIR/haproxy-sudoers" /etc/sudoers.d/n8n-daemon-haproxy
    chmod 440 /etc/sudoers.d/n8n-daemon-haproxy
    echo -e "${GREEN}✓ Sudoers file installed${NC}"
fi

# Configure HAProxy to use writable config location
echo -e "${BLUE}[4/5] Configuring HAProxy...${NC}"

# Create writable HAProxy config directory
mkdir -p /opt/n8n-daemon/haproxy
chown n8n-daemon:n8n-daemon /opt/n8n-daemon/haproxy

# Copy initial config to writable location
cp /etc/haproxy/haproxy.cfg /opt/n8n-daemon/haproxy/haproxy.cfg
chown n8n-daemon:n8n-daemon /opt/n8n-daemon/haproxy/haproxy.cfg

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

# Reload systemd and start HAProxy
systemctl daemon-reload
systemctl enable haproxy
systemctl restart haproxy

if systemctl is-active --quiet haproxy; then
    echo -e "${GREEN}✓ HAProxy started successfully${NC}"
else
    echo -e "${RED}✗ HAProxy failed to start${NC}"
    echo "Check logs: sudo journalctl -u haproxy -n 50"
    exit 1
fi

# Update daemon
echo -e "${BLUE}[5/5] Updating daemon...${NC}"
INSTALL_DIR="/opt/n8n-daemon/daemon"

if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    
    # Pull latest changes
    echo "Pulling latest code..."
    git fetch origin
    git reset --hard origin/main
    
    # Install dependencies
    echo "Installing dependencies..."
    sudo -u "$DAEMON_USER" npm install --include=dev > /dev/null 2>&1
    
    # Build
    echo "Building..."
    sudo -u "$DAEMON_USER" npm run build > /dev/null 2>&1
    
    # Clean up dev dependencies
    sudo -u "$DAEMON_USER" npm prune --production > /dev/null 2>&1
    
    # Restart daemon
    echo "Restarting daemon..."
    systemctl restart n8n-daemon
    
    sleep 2
    
    if systemctl is-active --quiet n8n-daemon; then
        echo -e "${GREEN}✓ Daemon updated and restarted${NC}"
    else
        echo -e "${RED}✗ Daemon failed to start${NC}"
        echo "Check logs: sudo journalctl -u n8n-daemon -n 50"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ Daemon not found at $INSTALL_DIR${NC}"
    echo "Skipping daemon update"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Migration Complete! ✓                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}Services Status:${NC}"
echo -n "  Traefik: "
if systemctl is-active --quiet traefik; then
    echo -e "${GREEN}Running ✓${NC}"
else
    echo -e "${YELLOW}Not running${NC}"
fi

echo -n "  HAProxy: "
if systemctl is-active --quiet haproxy; then
    echo -e "${GREEN}Running ✓${NC}"
else
    echo -e "${RED}Not running ✗${NC}"
fi

echo -n "  Daemon:  "
if systemctl is-active --quiet n8n-daemon; then
    echo -e "${GREEN}Running ✓${NC}"
else
    echo -e "${RED}Not running ✗${NC}"
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Open firewall ports for databases:"
echo "     sudo ufw allow 5432/tcp  # PostgreSQL"
echo "     sudo ufw allow 3306/tcp  # MySQL"
echo ""
echo "  2. Create DNS A records for your databases:"
echo "     mydb.yourdomain.com → $(curl -s ifconfig.me)"
echo ""
echo "  3. Existing databases will continue using direct ports"
echo "     New databases will use HAProxy with standard ports"
echo ""
echo "  4. View HAProxy stats:"
echo "     http://$(curl -s ifconfig.me):8404/stats"
echo ""
echo "  5. Monitor logs:"
echo "     sudo journalctl -u haproxy -f"
echo "     sudo journalctl -u n8n-daemon -f"
echo ""


#!/bin/bash

# Verify n8n Daemon Installation
# This script checks that all components are properly installed and configured

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Installation Verification            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

ERRORS=0
WARNINGS=0

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}⚠ Warning: Not running as root. Some checks may fail.${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# 1. Check Node.js
echo -n "Checking Node.js... "
if command -v node &> /dev/null; then
    VERSION=$(node --version)
    echo -e "${GREEN}✓ Installed ($VERSION)${NC}"
else
    echo -e "${RED}✗ Not installed${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 2. Check Docker
echo -n "Checking Docker... "
if command -v docker &> /dev/null; then
    VERSION=$(docker --version | cut -d' ' -f3 | tr -d ',')
    if systemctl is-active --quiet docker; then
        echo -e "${GREEN}✓ Installed and running ($VERSION)${NC}"
    else
        echo -e "${YELLOW}⚠ Installed but not running ($VERSION)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Not installed${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 3. Check HAProxy
echo -n "Checking HAProxy... "
if command -v haproxy &> /dev/null; then
    VERSION=$(haproxy -v | head -1 | cut -d' ' -f3)
    if systemctl is-active --quiet haproxy; then
        echo -e "${GREEN}✓ Installed and running ($VERSION)${NC}"
    else
        echo -e "${YELLOW}⚠ Installed but not running ($VERSION)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Not installed${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 4. Check daemon user
echo -n "Checking daemon user... "
if id "n8n-daemon" &>/dev/null; then
    GROUPS=$(groups n8n-daemon | cut -d: -f2)
    echo -e "${GREEN}✓ Exists (groups:$GROUPS)${NC}"
    
    # Check if in docker group
    if groups n8n-daemon | grep -q docker; then
        echo -e "  ${GREEN}✓ In docker group${NC}"
    else
        echo -e "  ${RED}✗ Not in docker group${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check if in haproxy group
    if groups n8n-daemon | grep -q haproxy; then
        echo -e "  ${GREEN}✓ In haproxy group${NC}"
    else
        echo -e "  ${YELLOW}⚠ Not in haproxy group${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Does not exist${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 5. Check daemon installation
echo -n "Checking daemon files... "
if [ -d "/opt/n8n-daemon/daemon" ]; then
    echo -e "${GREEN}✓ Installed${NC}"
    
    # Check if built
    if [ -d "/opt/n8n-daemon/daemon/dist" ]; then
        echo -e "  ${GREEN}✓ Built (dist/ exists)${NC}"
    else
        echo -e "  ${RED}✗ Not built (dist/ missing)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check .env
    if [ -f "/opt/n8n-daemon/daemon/.env" ]; then
        echo -e "  ${GREEN}✓ Configured (.env exists)${NC}"
    else
        echo -e "  ${YELLOW}⚠ Not configured (.env missing)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Not installed${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 6. Check HAProxy configuration
echo -n "Checking HAProxy config... "
if [ -f "/opt/n8n-daemon/haproxy/haproxy.cfg" ]; then
    echo -e "${GREEN}✓ Config exists${NC}"
    
    # Test config syntax
    if haproxy -c -f /opt/n8n-daemon/haproxy/haproxy.cfg &> /dev/null; then
        echo -e "  ${GREEN}✓ Config is valid${NC}"
    else
        echo -e "  ${RED}✗ Config has errors${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check ownership
    OWNER=$(stat -c '%U:%G' /opt/n8n-daemon/haproxy/haproxy.cfg)
    if [ "$OWNER" = "n8n-daemon:n8n-daemon" ]; then
        echo -e "  ${GREEN}✓ Correct ownership${NC}"
    else
        echo -e "  ${YELLOW}⚠ Wrong ownership ($OWNER)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Config missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 7. Check HAProxy systemd override
echo -n "Checking HAProxy systemd override... "
if [ -f "/etc/systemd/system/haproxy.service.d/override.conf" ]; then
    if grep -q "/opt/n8n-daemon/haproxy/haproxy.cfg" /etc/systemd/system/haproxy.service.d/override.conf; then
        echo -e "${GREEN}✓ Configured correctly${NC}"
    else
        echo -e "${YELLOW}⚠ Override exists but may be incorrect${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Override missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# 8. Check sudoers file
echo -n "Checking sudoers file... "
if [ -f "/etc/sudoers.d/n8n-daemon-haproxy" ]; then
    echo -e "${GREEN}✓ Installed${NC}"
    
    # Check syntax
    if visudo -c -f /etc/sudoers.d/n8n-daemon-haproxy &> /dev/null; then
        echo -e "  ${GREEN}✓ Syntax is valid${NC}"
    else
        echo -e "  ${RED}✗ Syntax errors${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${YELLOW}⚠ Not installed${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# 9. Check daemon service
echo -n "Checking daemon service... "
if [ -f "/etc/systemd/system/n8n-daemon.service" ]; then
    if systemctl is-enabled --quiet n8n-daemon; then
        if systemctl is-active --quiet n8n-daemon; then
            echo -e "${GREEN}✓ Enabled and running${NC}"
        else
            echo -e "${YELLOW}⚠ Enabled but not running${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo -e "${YELLOW}⚠ Installed but not enabled${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}⚠ Service file not installed${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# 10. Check firewall
echo -n "Checking firewall... "
if command -v ufw &> /dev/null; then
    if ufw status | grep -q "Status: active"; then
        echo -e "${GREEN}✓ UFW is active${NC}"
        
        # Check important ports
        if ufw status | grep -q "5432"; then
            echo -e "  ${GREEN}✓ Port 5432 (PostgreSQL) open${NC}"
        else
            echo -e "  ${YELLOW}⚠ Port 5432 not open${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
        
        if ufw status | grep -q "3306"; then
            echo -e "  ${GREEN}✓ Port 3306 (MySQL) open${NC}"
        else
            echo -e "  ${YELLOW}⚠ Port 3306 not open${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        echo -e "${YELLOW}⚠ UFW is inactive${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}⚠ UFW not installed${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════${NC}"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Your installation is ready to use."
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo ""
    echo "Installation is functional but some optional components need attention."
    exit 0
else
    echo -e "${RED}✗ $ERRORS error(s) and $WARNINGS warning(s) found${NC}"
    echo ""
    echo "Please fix the errors before using the daemon."
    exit 1
fi

#!/bin/bash

# n8n Daemon - Update from GitHub
# This script updates the daemon from the GitHub repository

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   n8n Daemon Update from GitHub       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Configuration
INSTALL_DIR="/opt/n8n-daemon/daemon"
DAEMON_USER="n8n-daemon"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Error: Please run as root (use sudo)${NC}"
    exit 1
fi

# Check if daemon is installed
if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${RED}Error: Daemon not installed at $INSTALL_DIR${NC}"
    echo "Run install-from-github.sh first"
    exit 1
fi

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}Warning: GITHUB_TOKEN not set${NC}"
    echo "Attempting update without token (may fail for private repos)"
    echo ""
fi

# Stop daemon if running
echo -e "${BLUE}[1/6] Stopping daemon...${NC}"
if systemctl is-active --quiet n8n-daemon; then
    systemctl stop n8n-daemon
    echo -e "${GREEN}✓ Daemon stopped${NC}"
else
    echo -e "${YELLOW}⚠ Daemon not running${NC}"
fi

# Backup current installation
echo -e "${BLUE}[2/6] Creating backup...${NC}"
BACKUP_DIR="$INSTALL_DIR.backup.$(date +%Y%m%d_%H%M%S)"
cp -r "$INSTALL_DIR" "$BACKUP_DIR"
echo -e "${GREEN}✓ Backup created: $BACKUP_DIR${NC}"

# Update from GitHub
echo -e "${BLUE}[3/6] Pulling latest changes...${NC}"
cd "$INSTALL_DIR"

# Ensure Git trusts this directory when running under root
git config --system --add safe.directory "$INSTALL_DIR" || true

# Stash any local changes
git stash > /dev/null 2>&1 || true

# Pull latest changes
if [ -n "$GITHUB_TOKEN" ]; then
    # Update remote URL with token
    git remote set-url origin "https://${GITHUB_TOKEN}@github.com/$(git remote get-url origin | sed 's|https://.*@github.com/||' | sed 's|https://github.com/||')"
fi

git fetch origin
git reset --hard "origin/$GITHUB_BRANCH"

# Fix ownership after git operations
chown -R "$DAEMON_USER:$DAEMON_USER" "$INSTALL_DIR"
echo -e "${GREEN}✓ Latest changes pulled${NC}"

# Install/update dependencies (including devDependencies for build)
echo -e "${BLUE}[4/6] Updating dependencies...${NC}"
cd "$INSTALL_DIR"

# Remove node_modules and package-lock.json to ensure clean install
if [ -d "node_modules" ]; then
    echo "Removing old node_modules..."
    rm -rf node_modules
fi

if [ -f "package-lock.json" ]; then
    echo "Removing package-lock.json for clean install..."
    rm -f package-lock.json
fi

# Clear npm cache to avoid potential issues
echo "Clearing npm cache..."
sudo -u "$DAEMON_USER" npm cache clean --force

# Install all dependencies (including devDependencies)
echo "Installing dependencies with dev dependencies..."
if sudo -u "$DAEMON_USER" npm install --include=dev; then
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${RED}✗ Dependency installation failed${NC}"
    echo "Attempting fallback installation..."
    
    # Fallback: try installing without cache and with legacy peer deps
    if sudo -u "$DAEMON_USER" npm install --include=dev --no-cache --legacy-peer-deps; then
        echo -e "${YELLOW}✓ Dependencies installed with fallback method${NC}"
    else
        echo -e "${RED}✗ All dependency installation methods failed${NC}"
        exit 1
    fi
fi

# Verify and ensure TypeScript is properly installed
echo "Verifying TypeScript installation..."
if [ ! -f "node_modules/.bin/tsc" ]; then
    echo -e "${YELLOW}⚠ TypeScript not found, installing explicitly...${NC}"
    
    # Try installing TypeScript explicitly
    if sudo -u "$DAEMON_USER" npm install --save-dev typescript@latest; then
        echo -e "${GREEN}✓ TypeScript installed explicitly${NC}"
    else
        echo -e "${RED}✗ Failed to install TypeScript${NC}"
        exit 1
    fi
fi

# Double-check TypeScript installation
if [ -f "node_modules/.bin/tsc" ]; then
    echo -e "${GREEN}✓ TypeScript compiler verified${NC}"
    # Show TypeScript version for debugging
    TYPESCRIPT_VERSION=$(sudo -u "$DAEMON_USER" ./node_modules/.bin/tsc --version)
    echo "TypeScript version: $TYPESCRIPT_VERSION"
else
    echo -e "${RED}✗ TypeScript compiler still not found after installation${NC}"
    exit 1
fi

# Verify other essential build tools
echo "Verifying build environment..."
if [ ! -f "tsconfig.json" ]; then
    echo -e "${RED}✗ tsconfig.json not found${NC}"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo -e "${RED}✗ package.json not found${NC}"
    exit 1
fi

# Verify package.json has build script
if ! grep -q '"build"' package.json; then
    echo -e "${RED}✗ Build script not found in package.json${NC}"
    exit 1
fi

# Verify TypeScript is in devDependencies
if ! grep -q '"typescript"' package.json; then
    echo -e "${YELLOW}⚠ TypeScript not found in package.json devDependencies${NC}"
    echo "This might cause issues, but continuing..."
fi

echo -e "${GREEN}✓ Build environment verified${NC}"

# Rebuild application
echo -e "${BLUE}[5/6] Rebuilding application...${NC}"

# Final verification before build
echo "Final pre-build verification..."
if [ ! -f "node_modules/.bin/tsc" ]; then
    echo -e "${RED}✗ TypeScript compiler not found before build${NC}"
    echo "Available in node_modules/.bin:"
    ls -la node_modules/.bin/ | head -20
    echo ""
    echo "Restoring backup..."
    systemctl stop n8n-daemon || true
    rm -rf "$INSTALL_DIR"
    mv "$BACKUP_DIR" "$INSTALL_DIR"
    systemctl start n8n-daemon
    exit 1
fi

# Show build environment info for debugging
echo "Build environment:"
echo "  - Node.js version: $(sudo -u "$DAEMON_USER" node --version)"
echo "  - npm version: $(sudo -u "$DAEMON_USER" npm --version)"
echo "  - TypeScript version: $(sudo -u "$DAEMON_USER" ./node_modules/.bin/tsc --version)"
echo "  - Working directory: $(pwd)"

# Run the build with verbose output
echo "Starting build process..."
if sudo -u "$DAEMON_USER" npm run build 2>&1; then
    echo -e "${GREEN}✓ Application rebuilt successfully${NC}"
    
    # Verify build output exists
    if [ -d "dist" ] || [ -d "build" ] || [ -f "index.js" ]; then
        echo -e "${GREEN}✓ Build output verified${NC}"
    else
        echo -e "${YELLOW}⚠ Build completed but output directory not found${NC}"
        echo "Contents of current directory:"
        ls -la
    fi
    
    # Clean up devDependencies after build to save space
    echo -e "${BLUE}Cleaning up devDependencies...${NC}"
    sudo -u "$DAEMON_USER" npm prune --production
    echo -e "${GREEN}✓ DevDependencies removed${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    echo ""
    echo "Build failed. Debugging information:"
    echo "  - Check if all TypeScript files are valid"
    echo "  - Verify tsconfig.json is correct"
    echo "  - Check for missing dependencies"
    echo ""
    echo "TypeScript compiler status:"
    if [ -f "node_modules/.bin/tsc" ]; then
        echo "  ✓ TypeScript compiler found"
        sudo -u "$DAEMON_USER" ./node_modules/.bin/tsc --version
    else
        echo "  ✗ TypeScript compiler missing"
    fi
    echo ""
    echo "Restoring backup..."
    systemctl stop n8n-daemon || true
    rm -rf "$INSTALL_DIR"
    mv "$BACKUP_DIR" "$INSTALL_DIR"
    systemctl start n8n-daemon
    exit 1
fi

# Restart daemon
echo -e "${BLUE}[6/6] Starting daemon...${NC}"
systemctl start n8n-daemon
sleep 2

if systemctl is-active --quiet n8n-daemon; then
    echo -e "${GREEN}✓ Daemon started successfully${NC}"
else
    echo -e "${RED}✗ Daemon failed to start${NC}"
    echo ""
    echo "Check logs:"
    echo "  sudo journalctl -u n8n-daemon -n 50"
    echo ""
    echo "Restore backup if needed:"
    echo "  sudo systemctl stop n8n-daemon"
    echo "  sudo rm -rf $INSTALL_DIR"
    echo "  sudo mv $BACKUP_DIR $INSTALL_DIR"
    echo "  sudo systemctl start n8n-daemon"
    exit 1
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Update Complete! ✓                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Show version info
echo "Daemon status:"
systemctl status n8n-daemon --no-pager -l | head -10
echo ""

echo "View logs:"
echo "  sudo journalctl -u n8n-daemon -f"
echo ""

echo "Backup location:"
echo "  $BACKUP_DIR"
echo ""

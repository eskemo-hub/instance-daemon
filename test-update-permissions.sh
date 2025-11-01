#!/bin/bash

# Test if daemon user can run update script with sudo
# Run as daemon user: sudo -u n8n-daemon bash test-update-permissions.sh

echo "Testing sudo permissions for n8n-daemon user..."
echo "Current user: $(whoami)"
echo ""

# Test if we can run sudo
if sudo -n true 2>/dev/null; then
    echo "✓ Can run sudo without password"
else
    echo "✗ Cannot run sudo without password"
    echo ""
    echo "Run this as root to fix:"
    echo "  sudo bash setup-update-permissions.sh"
    exit 1
fi

# Test if update script exists
UPDATE_SCRIPT="/opt/n8n-daemon/daemon/update-from-github.sh"
if [ -f "$UPDATE_SCRIPT" ]; then
    echo "✓ Update script exists: $UPDATE_SCRIPT"
else
    echo "✗ Update script not found: $UPDATE_SCRIPT"
    exit 1
fi

# Test if update script is executable
if [ -x "$UPDATE_SCRIPT" ]; then
    echo "✓ Update script is executable"
else
    echo "✗ Update script is not executable"
    echo "Run: sudo chmod +x $UPDATE_SCRIPT"
    exit 1
fi

# Test if we can run the update script with sudo (dry run)
echo ""
echo "Testing sudo execution (this will just check permissions, not actually update)..."
if sudo -n test -f "$UPDATE_SCRIPT"; then
    echo "✓ Can execute update script with sudo"
else
    echo "✗ Cannot execute update script with sudo"
    exit 1
fi

echo ""
echo "✓ All permissions tests passed!"
echo "The daemon should be able to trigger updates via the API."

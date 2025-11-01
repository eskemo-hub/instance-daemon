#!/bin/bash

# Setup permissions for daemon to run update script
# Run this once as root: sudo bash setup-update-permissions.sh

set -e

DAEMON_USER="n8n-daemon"
INSTALL_DIR="/opt/n8n-daemon/daemon"
UPDATE_SCRIPT="$INSTALL_DIR/update-from-github.sh"

echo "Setting up update permissions for $DAEMON_USER..."

# Make update script executable
chmod +x "$UPDATE_SCRIPT"

# Create sudoers file to allow daemon user to run update script
SUDOERS_FILE="/etc/sudoers.d/n8n-daemon-update"

cat > "$SUDOERS_FILE" << EOF
# Allow n8n-daemon user to run update script with sudo
$DAEMON_USER ALL=(ALL) NOPASSWD: $UPDATE_SCRIPT
EOF

# Set correct permissions on sudoers file
chmod 0440 "$SUDOERS_FILE"

# Verify sudoers syntax
if visudo -c -f "$SUDOERS_FILE"; then
    echo "✓ Sudoers configuration valid"
else
    echo "✗ Sudoers configuration invalid, removing..."
    rm "$SUDOERS_FILE"
    exit 1
fi

echo "✓ Update permissions configured"
echo ""
echo "The daemon can now run updates via the API"

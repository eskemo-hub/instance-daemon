#!/bin/bash

# Update systemd service to include GITHUB_TOKEN
# Run as root: sudo bash update-systemd-env.sh

set -e

SERVICE_FILE="/etc/systemd/system/n8n-daemon.service"

echo "Updating n8n-daemon systemd service environment..."

# Check if GITHUB_TOKEN is set
if [ -z "$GITHUB_TOKEN" ]; then
    echo "Warning: GITHUB_TOKEN not set in current environment"
    echo "The daemon will still work but may fail to update from private repos"
    echo ""
    echo "To set it, run:"
    echo "  export GITHUB_TOKEN=your_token_here"
    echo "  sudo -E bash update-systemd-env.sh"
    echo ""
fi

# Check if service file exists
if [ ! -f "$SERVICE_FILE" ]; then
    echo "Error: Service file not found: $SERVICE_FILE"
    exit 1
fi

# Backup service file
cp "$SERVICE_FILE" "$SERVICE_FILE.backup.$(date +%Y%m%d_%H%M%S)"

# Check if GITHUB_TOKEN line already exists
if grep -q "Environment=GITHUB_TOKEN=" "$SERVICE_FILE"; then
    echo "GITHUB_TOKEN already configured in service file"
    if [ -n "$GITHUB_TOKEN" ]; then
        # Update existing token
        sed -i "s|Environment=GITHUB_TOKEN=.*|Environment=GITHUB_TOKEN=$GITHUB_TOKEN|" "$SERVICE_FILE"
        echo "✓ Updated GITHUB_TOKEN"
    fi
else
    # Add GITHUB_TOKEN after NODE_ENV line
    if [ -n "$GITHUB_TOKEN" ]; then
        sed -i "/Environment=NODE_ENV=production/a Environment=GITHUB_TOKEN=$GITHUB_TOKEN" "$SERVICE_FILE"
        echo "✓ Added GITHUB_TOKEN to service file"
    fi
fi

# Reload systemd
systemctl daemon-reload
echo "✓ Systemd configuration reloaded"

echo ""
echo "Service environment updated. Restart daemon to apply:"
echo "  sudo systemctl restart n8n-daemon"

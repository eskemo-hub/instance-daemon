#!/bin/bash

# Fix SSL for test-cmhmoqju.hostinau.com container

DOMAIN="test-cmhmoqju.hostinau.com"

echo "Finding container for domain: $DOMAIN"
CONTAINER=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .instanceName" 2>/dev/null)

if [ -z "$CONTAINER" ] || [ "$CONTAINER" = "null" ]; then
    echo "❌ Container not found for domain: $DOMAIN"
    exit 1
fi

echo "Found container: $CONTAINER"
echo ""

# Check if script exists
if [ ! -f "./enable-ssl-existing-containers.sh" ]; then
    echo "❌ enable-ssl-existing-containers.sh not found in current directory"
    echo "Please run this from the n8n-daemon-repo directory"
    exit 1
fi

# Make script executable
chmod +x ./enable-ssl-existing-containers.sh

echo "Enabling SSL on container..."
sudo ./enable-ssl-existing-containers.sh "$CONTAINER"

echo ""
echo "Restarting container..."
sudo docker restart "$CONTAINER"

echo ""
echo "✅ Done! Container $CONTAINER has been restarted with SSL enabled."
echo ""
echo "Wait a few seconds, then test the connection:"
echo "  psql \"postgresql://postgres:password@$DOMAIN:5432/postgres?sslmode=require\""


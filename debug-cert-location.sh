#!/bin/bash

# Debug certificate location for a container

CONTAINER_NAME="${1}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 CONTAINER_NAME"
    exit 1
fi

echo "Container: $CONTAINER_NAME"
echo ""

# Extract instance name
INSTANCE_NAME=$(echo "$CONTAINER_NAME" | sed 's/postgres_//')
echo "Instance name: $INSTANCE_NAME"
echo ""

# Check certificate locations
echo "Checking certificate locations:"
echo "-----------------------------------"

POSSIBLE_CERT_DIRS=(
    "/opt/n8n-daemon/certs/$INSTANCE_NAME"
    "$(pwd)/certs/$INSTANCE_NAME"
    "~/instance-daemon/certs/$INSTANCE_NAME"
    "/var/lib/n8n-daemon/certs/$INSTANCE_NAME"
)

for CERT_DIR in "${POSSIBLE_CERT_DIRS[@]}"; do
    CERT_DIR=$(eval echo "$CERT_DIR")
    echo "Checking: $CERT_DIR"
    if [ -d "$CERT_DIR" ]; then
        echo "  ✅ Directory exists"
        ls -la "$CERT_DIR" 2>/dev/null | head -10
    else
        echo "  ❌ Directory does not exist"
    fi
    echo ""
done

# Check what's actually in /opt/n8n-daemon/certs/
echo "Contents of /opt/n8n-daemon/certs/:"
echo "-----------------------------------"
sudo ls -la /opt/n8n-daemon/certs/ 2>/dev/null | head -20 || echo "Directory not found or not accessible"
echo ""

# Check if certificates exist with different instance name patterns
echo "Searching for certificates matching container name:"
echo "-----------------------------------"
sudo find /opt/n8n-daemon/certs/ -name "*${INSTANCE_NAME}*" -o -name "*${CONTAINER_NAME}*" 2>/dev/null | head -10


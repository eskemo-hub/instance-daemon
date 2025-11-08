#!/bin/bash

# Enable SSL on existing PostgreSQL containers
# This script modifies postgresql.conf to enable SSL

CONTAINER_NAME="${1}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 CONTAINER_NAME"
    echo "Example: $0 postgres_cmhplte3t0005jydari0ept4q"
    exit 1
fi

echo "=========================================="
echo "Enabling SSL on PostgreSQL Container"
echo "Container: $CONTAINER_NAME"
echo "=========================================="
echo ""

# Check if container exists
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Container not found: $CONTAINER_NAME"
    exit 1
fi

# Get domain from backends.json
DOMAIN=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.instanceName == \"$CONTAINER_NAME\") | .domain" 2>/dev/null)

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "null" ]; then
    echo "⚠️  Could not find domain for container, will use default paths"
    DOMAIN=""
fi

# Check if certificates are mounted or exist in container
CERT_FILE=""
KEY_FILE=""

# First, check if certificates are already mounted
if docker exec "$CONTAINER_NAME" ls /var/lib/postgresql/ssl/ >/dev/null 2>&1; then
    CERT_FILE=$(docker exec "$CONTAINER_NAME" sh -c "ls /var/lib/postgresql/ssl/*.crt /var/lib/postgresql/ssl/*.pem 2>/dev/null | head -1" | tr -d '\r\n')
    KEY_FILE=$(docker exec "$CONTAINER_NAME" sh -c "ls /var/lib/postgresql/ssl/*.key 2>/dev/null | head -1" | tr -d '\r\n')
fi

# If certificates not found, check on host and copy them
if [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
    echo "⚠️  Certificates not mounted, checking host for certificates..."
    
    # Try to find certificates on host
    INSTANCE_NAME=$(echo "$CONTAINER_NAME" | sed 's/postgres_//')
    HOST_CERT_DIR="/opt/n8n-daemon/certs/$INSTANCE_NAME"
    
    if [ -d "$HOST_CERT_DIR" ]; then
        # Find certificate files on host
        HOST_CERT=$(find "$HOST_CERT_DIR" -name "*.crt" -o -name "fullchain.pem" 2>/dev/null | head -1)
        HOST_KEY=$(find "$HOST_CERT_DIR" -name "*.key" -o -name "privkey.pem" 2>/dev/null | head -1)
        
        if [ -n "$HOST_CERT" ] && [ -n "$HOST_KEY" ]; then
            echo "Found certificates on host, copying to container..."
            
            # Create SSL directory in container
            docker exec "$CONTAINER_NAME" mkdir -p /var/lib/postgresql/ssl
            
            # Copy certificates to container
            docker cp "$HOST_CERT" "$CONTAINER_NAME:/var/lib/postgresql/ssl/$(basename "$HOST_CERT")"
            docker cp "$HOST_KEY" "$CONTAINER_NAME:/var/lib/postgresql/ssl/$(basename "$HOST_KEY")"
            
            # Set permissions
            docker exec "$CONTAINER_NAME" chmod 600 /var/lib/postgresql/ssl/*.key
            docker exec "$CONTAINER_NAME" chmod 644 /var/lib/postgresql/ssl/*.crt /var/lib/postgresql/ssl/*.pem
            docker exec "$CONTAINER_NAME" chown -R postgres:postgres /var/lib/postgresql/ssl
            
            CERT_FILE="/var/lib/postgresql/ssl/$(basename "$HOST_CERT")"
            KEY_FILE="/var/lib/postgresql/ssl/$(basename "$HOST_KEY")"
            
            echo "✅ Certificates copied to container"
        else
            echo "❌ Certificate files not found on host at: $HOST_CERT_DIR"
            echo ""
            echo "You may need to:"
            echo "1. Generate certificates using the daemon API"
            echo "2. Or recreate the container (new containers will have SSL enabled automatically)"
            exit 1
        fi
    else
        echo "❌ Certificate directory not found on host: $HOST_CERT_DIR"
        echo ""
        echo "This container may have been created before SSL certificate mounting was implemented."
        echo "Options:"
        echo "1. Recreate the container (new containers will have SSL enabled automatically)"
        echo "2. Generate certificates manually and copy them to the container"
        exit 1
    fi
fi

echo "Found certificates:"
echo "  Cert: $CERT_FILE"
echo "  Key: $KEY_FILE"
echo ""

# Check current SSL status
echo "Current SSL status:"
docker exec "$CONTAINER_NAME" psql -U postgres -c "SHOW ssl;" 2>/dev/null || echo "  Could not check SSL status"
echo ""

# Enable SSL in postgresql.conf
echo "Enabling SSL in postgresql.conf..."
docker exec "$CONTAINER_NAME" bash -c "
# Backup postgresql.conf
cp /var/lib/postgresql/data/postgresql.conf /var/lib/postgresql/data/postgresql.conf.bak

# Add SSL configuration if not already present
if ! grep -q '^ssl = on' /var/lib/postgresql/data/postgresql.conf; then
    echo '' >> /var/lib/postgresql/data/postgresql.conf
    echo '# SSL Configuration (enabled by enable-ssl script)' >> /var/lib/postgresql/data/postgresql.conf
    echo 'ssl = on' >> /var/lib/postgresql/data/postgresql.conf
    echo \"ssl_cert_file = '$CERT_FILE'\" >> /var/lib/postgresql/data/postgresql.conf
    echo \"ssl_key_file = '$KEY_FILE'\" >> /var/lib/postgresql/data/postgresql.conf
    echo 'ssl_min_protocol_version = '\''TLSv1.2'\''' >> /var/lib/postgresql/data/postgresql.conf
    echo '✅ SSL configuration added to postgresql.conf'
else
    echo '⚠️  SSL already configured in postgresql.conf'
fi
"

# Reload PostgreSQL configuration
echo ""
echo "Reloading PostgreSQL configuration..."
docker exec "$CONTAINER_NAME" psql -U postgres -c "SELECT pg_reload_conf();" 2>/dev/null && echo "✅ Configuration reloaded" || echo "⚠️  Could not reload (restart may be required)"

echo ""
echo "=========================================="
echo "SSL Configuration Complete"
echo "=========================================="
echo ""
echo "⚠️  IMPORTANT: SSL changes require a container restart to take effect"
echo ""
echo "To restart the container:"
echo "  docker restart $CONTAINER_NAME"
echo ""
echo "After restart, verify SSL is enabled:"
echo "  docker exec $CONTAINER_NAME psql -U postgres -c 'SHOW ssl;'"
echo ""


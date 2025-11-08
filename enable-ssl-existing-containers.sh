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

# Check if certificates are mounted
if ! docker exec "$CONTAINER_NAME" ls /var/lib/postgresql/ssl/ >/dev/null 2>&1; then
    echo "❌ SSL certificates not found in container"
    echo "   Expected: /var/lib/postgresql/ssl/"
    exit 1
fi

# Find certificate files
CERT_FILE=$(docker exec "$CONTAINER_NAME" ls /var/lib/postgresql/ssl/*.crt /var/lib/postgresql/ssl/*.pem 2>/dev/null | head -1 | tr -d '\r')
KEY_FILE=$(docker exec "$CONTAINER_NAME" ls /var/lib/postgresql/ssl/*.key /var/lib/postgresql/ssl/*.pem 2>/dev/null | head -1 | tr -d '\r')

if [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
    echo "❌ Certificate files not found"
    exit 1
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


#!/bin/bash

# Check PostgreSQL SSL Configuration

CONTAINER_NAME="${1}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 CONTAINER_NAME"
    echo "Example: $0 postgres_cmhpl4aab0001jyda3t4t8l8h"
    exit 1
fi

echo "=========================================="
echo "Checking PostgreSQL SSL Configuration"
echo "Container: $CONTAINER_NAME"
echo "=========================================="
echo ""

# Check if container exists
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Container not found: $CONTAINER_NAME"
    exit 1
fi

echo "1. Check if SSL certificates are mounted"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" ls -la /var/lib/postgresql/ssl/ 2>/dev/null || echo "  ⚠️  SSL directory not found or not accessible"
echo ""

echo "2. Check PostgreSQL SSL setting"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" psql -U postgres -c "SHOW ssl;" 2>/dev/null || echo "  ⚠️  Could not check SSL setting"
echo ""

echo "3. Check PostgreSQL configuration"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" cat /var/lib/postgresql/data/postgresql.conf 2>/dev/null | grep -i ssl | head -10 || echo "  ⚠️  Could not read postgresql.conf"
echo ""

echo "4. Test non-TLS connection"
echo "-----------------------------------"
PORT=$(docker inspect "$CONTAINER_NAME" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports."5432/tcp"[0].HostPort' 2>/dev/null)
echo "Testing direct connection (non-TLS) to port $PORT..."
timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$PORT" 2>/dev/null && echo "✅ Port is accessible" || echo "❌ Port not accessible"
echo ""

echo "5. Check container environment variables"
echo "-----------------------------------"
docker inspect "$CONTAINER_NAME" 2>/dev/null | jq -r '.[0].Config.Env[]' | grep -i ssl || echo "  No SSL-related environment variables"
echo ""

echo "=========================================="
echo "To enable SSL on PostgreSQL:"
echo "=========================================="
echo "1. SSL certificates are already mounted to /var/lib/postgresql/ssl/"
echo "2. Need to enable SSL in postgresql.conf:"
echo "   - ssl = on"
echo "   - ssl_cert_file = '/var/lib/postgresql/ssl/server.crt'"
echo "   - ssl_key_file = '/var/lib/postgresql/ssl/server.key'"
echo "3. Restart PostgreSQL container"
echo ""


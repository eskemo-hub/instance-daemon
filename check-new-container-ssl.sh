#!/bin/bash

# Check SSL configuration on a new PostgreSQL container

DOMAIN="${1:-test-cmhmoqju.hostinau.com}"

if [ -z "$DOMAIN" ]; then
    echo "Usage: $0 DOMAIN"
    echo "Example: $0 test-cmhmoqju.hostinau.com"
    exit 1
fi

echo "=========================================="
echo "Checking SSL Configuration"
echo "Domain: $DOMAIN"
echo "=========================================="
echo ""

# Find container by domain
CONTAINER_NAME=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .instanceName" 2>/dev/null)

if [ -z "$CONTAINER_NAME" ] || [ "$CONTAINER_NAME" = "null" ]; then
    echo "❌ Container not found for domain: $DOMAIN"
    echo ""
    echo "Available containers:"
    docker ps --format "{{.Names}}" | grep postgres | head -5
    exit 1
fi

echo "Container: $CONTAINER_NAME"
echo ""

# Check if container is running
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Container is not running"
    exit 1
fi

echo "1. Check if SSL certificates are mounted"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" ls -la /var/lib/postgresql/ssl/ 2>/dev/null || echo "  ⚠️  SSL directory not found"
echo ""

echo "2. Check PostgreSQL SSL setting"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" psql -U postgres -c "SHOW ssl;" 2>/dev/null || echo "  ⚠️  Could not check SSL setting"
echo ""

echo "3. Check postgresql.conf for SSL settings"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" grep -i "^ssl" /var/lib/postgresql/data/postgresql.conf 2>/dev/null | head -10 || echo "  ⚠️  No SSL settings found in postgresql.conf"
echo ""

echo "4. Check if init script ran"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" ls -la /docker-entrypoint-initdb.d/ 2>/dev/null | grep -i ssl || echo "  ⚠️  No SSL init script found"
echo ""

echo "5. Check container logs for SSL-related messages"
echo "-----------------------------------"
docker logs "$CONTAINER_NAME" 2>&1 | grep -i ssl | tail -10 || echo "  No SSL-related messages in logs"
echo ""

echo "6. Test TLS connection"
echo "-----------------------------------"
PORT=$(docker inspect "$CONTAINER_NAME" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports."5432/tcp"[0].HostPort' 2>/dev/null)
echo "Testing TLS connection to port $PORT..."
timeout 3 bash -c "echo | openssl s_client -connect 127.0.0.1:$PORT -starttls postgres 2>&1 | head -5" || echo "  ⚠️  TLS connection test failed"
echo ""

echo "=========================================="
echo "If SSL is not enabled:"
echo "=========================================="
echo "1. Check if init script exists: docker exec $CONTAINER_NAME ls -la /docker-entrypoint-initdb.d/"
echo "2. Check container logs: docker logs $CONTAINER_NAME | grep -i ssl"
echo "3. Manually enable SSL: ./enable-ssl-existing-containers.sh $CONTAINER_NAME"
echo "4. Restart container: docker restart $CONTAINER_NAME"
echo ""


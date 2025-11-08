#!/bin/bash

# Check SSL configuration in PostgreSQL container

CONTAINER_NAME="${1}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 CONTAINER_NAME"
    exit 1
fi

echo "Checking SSL configuration for: $CONTAINER_NAME"
echo "=========================================="
echo ""

# Find postgresql.conf
echo "1. Finding postgresql.conf..."
PGDATA=$(docker exec "$CONTAINER_NAME" psql -U postgres -t -c "SHOW data_directory;" 2>/dev/null | tr -d ' \n\r' || echo "")
if [ -z "$PGDATA" ]; then
    PGDATA="/var/lib/postgresql/data"
fi
PG_CONF="$PGDATA/postgresql.conf"
echo "   Data directory: $PGDATA"
echo "   Config file: $PG_CONF"
echo ""

# Check if file exists
if docker exec "$CONTAINER_NAME" test -f "$PG_CONF" 2>/dev/null; then
    echo "✅ postgresql.conf exists"
    echo ""
    echo "2. Checking SSL settings in postgresql.conf:"
    echo "-----------------------------------"
    docker exec "$CONTAINER_NAME" grep -i "^ssl" "$PG_CONF" 2>/dev/null || echo "   No SSL settings found"
    echo ""
else
    echo "❌ postgresql.conf not found at $PG_CONF"
    echo ""
    echo "Searching for postgresql.conf..."
    docker exec "$CONTAINER_NAME" find / -name "postgresql.conf" 2>/dev/null | head -5
    echo ""
fi

# Check SSL status
echo "3. Current SSL status:"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" psql -U postgres -c "SHOW ssl;" 2>/dev/null
echo ""

# Check certificates
echo "4. Checking certificates:"
echo "-----------------------------------"
docker exec "$CONTAINER_NAME" ls -la /var/lib/postgresql/ssl/ 2>/dev/null || echo "   SSL directory not found"
echo ""

# Check if certificates are readable
echo "5. Testing certificate paths:"
echo "-----------------------------------"
CERT_FILE=$(docker exec "$CONTAINER_NAME" sh -c "ls /var/lib/postgresql/ssl/*.crt /var/lib/postgresql/ssl/*.pem 2>/dev/null | head -1" | tr -d '\r\n')
KEY_FILE=$(docker exec "$CONTAINER_NAME" sh -c "ls /var/lib/postgresql/ssl/*.key 2>/dev/null | head -1" | tr -d '\r\n')

if [ -n "$CERT_FILE" ] && [ -n "$KEY_FILE" ]; then
    echo "   Cert: $CERT_FILE"
    echo "   Key: $KEY_FILE"
    
    # Check if files are readable
    if docker exec "$CONTAINER_NAME" test -r "$CERT_FILE" 2>/dev/null; then
        echo "   ✅ Certificate file is readable"
    else
        echo "   ❌ Certificate file is NOT readable"
    fi
    
    if docker exec "$CONTAINER_NAME" test -r "$KEY_FILE" 2>/dev/null; then
        echo "   ✅ Key file is readable"
    else
        echo "   ❌ Key file is NOT readable"
    fi
else
    echo "   ❌ Certificates not found"
fi
echo ""

# Check PostgreSQL logs for SSL errors
echo "6. Recent PostgreSQL logs (SSL-related):"
echo "-----------------------------------"
docker logs "$CONTAINER_NAME" 2>&1 | grep -i ssl | tail -10 || echo "   No SSL-related log entries"
echo ""


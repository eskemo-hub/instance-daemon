#!/bin/bash

# Debug Connection Routing
# Helps identify which database a connection is actually hitting

DOMAIN="${1:-60-cmhmoqju.hostinau.com}"

echo "=========================================="
echo "Debugging Connection Routing"
echo "Domain: $DOMAIN"
echo "=========================================="
echo ""

# Get expected backend info
INSTANCE_NAME=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .instanceName" 2>/dev/null)
EXPECTED_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .port" 2>/dev/null)

echo "1. Expected Routing"
echo "-----------------------------------"
echo "Domain: $DOMAIN"
echo "Instance: $INSTANCE_NAME"
echo "Expected Port: $EXPECTED_PORT"
echo ""

# Find container
CONTAINER=$(docker ps --format "{{.Names}}" | grep "$INSTANCE_NAME" | head -1)

if [ -z "$CONTAINER" ]; then
    echo "❌ Container not found: $INSTANCE_NAME"
    exit 1
fi

echo "2. Container Info"
echo "-----------------------------------"
echo "Container: $CONTAINER"
ACTUAL_PORT=$(docker inspect "$CONTAINER" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports."5432/tcp"[0].HostPort' 2>/dev/null)
echo "Actual Port: $ACTUAL_PORT"

if [ "$ACTUAL_PORT" == "$EXPECTED_PORT" ]; then
    echo "✅ Ports match"
else
    echo "❌ Port mismatch!"
fi
echo ""

echo "3. Test Direct Connection to Container"
echo "-----------------------------------"
echo "Testing direct connection to container port $ACTUAL_PORT..."
echo "This bypasses HAProxy to test if the container itself works"
echo ""

# Test direct connection
echo "Run this to test direct connection:"
echo "  psql -h 127.0.0.1 -p $ACTUAL_PORT -U postgres -d postgres"
echo ""

echo "4. Test HAProxy Routing"
echo "-----------------------------------"
echo "Testing connection via HAProxy (domain: $DOMAIN)..."
echo ""

# Check HAProxy config for this domain
echo "HAProxy routing rule:"
sudo grep -B 2 -A 2 "$DOMAIN" /opt/n8n-daemon/haproxy/haproxy.cfg 2>/dev/null | head -10
echo ""

echo "5. Check Which Database You're Actually Connecting To"
echo "-----------------------------------"
echo "When you connect, check the database name:"
echo ""
echo "Method 1: Check current database in psql"
echo "  psql -h $DOMAIN -p 5432 -U postgres -d postgres"
echo "  Then run: SELECT current_database(), inet_server_addr(), inet_server_port();"
echo ""
echo "Method 2: Check container logs"
echo "  docker logs $CONTAINER --tail 20"
echo ""
echo "Method 3: Check HAProxy logs while connecting"
echo "  sudo journalctl -u haproxy -f"
echo "  (Then connect in another terminal)"
echo ""

echo "6. Verify SNI Routing"
echo "-----------------------------------"
echo "Check if SNI routing rule exists:"
sudo grep "req_ssl_sni.*$DOMAIN" /opt/n8n-daemon/haproxy/haproxy.cfg 2>/dev/null || echo "  ❌ SNI rule not found"
echo ""

echo "7. Test Connection with Verbose Output"
echo "-----------------------------------"
echo "Run this to see detailed connection info:"
echo "  PGPASSWORD='your_password' psql -h $DOMAIN -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'SELECT current_database(), version();'"
echo ""

echo "=========================================="
echo "Troubleshooting Steps"
echo "=========================================="
echo ""
echo "If password authentication fails:"
echo "1. Verify you're using the correct password for THIS specific database"
echo "2. Check if connection is going to wrong database:"
echo "   - Connect and run: SELECT current_database();"
echo "   - Compare with expected instance name"
echo "3. Check container logs for authentication attempts:"
echo "   docker logs $CONTAINER --tail 50 | grep -i auth"
echo "4. Verify HAProxy is routing correctly:"
echo "   sudo journalctl -u haproxy -n 50 | grep $DOMAIN"
echo ""


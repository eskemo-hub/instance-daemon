#!/bin/bash

# Check Which Database Connection Actually Hits

DOMAIN="${1:-60-cmhmoqju.hostinau.com}"

echo "=========================================="
echo "Checking Which Database Connection Hits"
echo "Domain: $DOMAIN"
echo "=========================================="
echo ""

# Get expected info
EXPECTED_INSTANCE=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .instanceName" 2>/dev/null)
EXPECTED_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .port" 2>/dev/null)

echo "Expected:"
echo "  Instance: $EXPECTED_INSTANCE"
echo "  Port: $EXPECTED_PORT"
echo ""

# Check HAProxy config - which backend does this domain route to?
echo "HAProxy Routing Rule:"
sudo grep -B 2 -A 2 "$DOMAIN" /opt/n8n-daemon/haproxy/haproxy.cfg 2>/dev/null | grep -E "(use_backend|backend postgres_)" | head -5
echo ""

# Check what the first backend is (where non-TLS goes)
FIRST_BACKEND=$(sudo grep -A 20 "frontend postgres_frontend" /opt/n8n-daemon/haproxy/haproxy.cfg 2>/dev/null | grep "default_backend" | head -1 | awk '{print $2}')
echo "Default Backend (for non-TLS): $FIRST_BACKEND"
echo ""

# Get first backend's port
if [ -n "$FIRST_BACKEND" ]; then
    FIRST_INSTANCE=$(echo "$FIRST_BACKEND" | sed 's/postgres_//' | sed 's/_/ /g' | awk '{print $1}')
    FIRST_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[\"$FIRST_INSTANCE\"].port" 2>/dev/null)
    FIRST_DOMAIN=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[\"$FIRST_INSTANCE\"].domain" 2>/dev/null)
    echo "First Backend Details:"
    echo "  Instance: $FIRST_INSTANCE"
    echo "  Domain: $FIRST_DOMAIN"
    echo "  Port: $FIRST_PORT"
    echo ""
    
    if [ "$FIRST_PORT" != "$EXPECTED_PORT" ]; then
        echo "⚠️  WARNING: Non-TLS connections route to FIRST backend ($FIRST_DOMAIN:$FIRST_PORT)"
        echo "   Your domain ($DOMAIN) should route to port $EXPECTED_PORT"
        echo "   But non-TLS will go to port $FIRST_PORT instead!"
        echo ""
        echo "   SOLUTION: Use TLS connection with sslmode=require"
    fi
fi

echo ""
echo "To verify which database you're connecting to:"
echo "1. Connect: psql -h $DOMAIN -p 5432 -U postgres -d postgres"
echo "2. Run: SELECT current_database(), inet_server_addr(), inet_server_port();"
echo "3. Compare the port with expected port: $EXPECTED_PORT"
echo ""

echo "Or test direct connection (bypasses HAProxy):"
echo "  psql -h 127.0.0.1 -p $EXPECTED_PORT -U postgres -d postgres"
echo ""


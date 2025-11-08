#!/bin/bash

# Fix Non-TLS Routing Issue
# The problem: Non-TLS connections route to first backend, not your domain

DOMAIN="${1:-60-cmhmoqju.hostinau.com}"

echo "=========================================="
echo "Fixing Non-TLS Routing Issue"
echo "Domain: $DOMAIN"
echo "=========================================="
echo ""

# Get expected backend
EXPECTED_INSTANCE=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .instanceName" 2>/dev/null)
EXPECTED_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .port" 2>/dev/null)

echo "Expected:"
echo "  Instance: $EXPECTED_INSTANCE"
echo "  Port: $EXPECTED_PORT"
echo ""

# Check which backend is default (first backend)
echo "Checking HAProxy default backend..."
FIRST_BACKEND=$(sudo grep -A 20 "frontend postgres_frontend" /opt/n8n-daemon/haproxy/haproxy.cfg 2>/dev/null | grep "default_backend" | head -1 | awk '{print $2}')

if [ -n "$FIRST_BACKEND" ]; then
    # Extract instance name from backend name
    FIRST_INSTANCE=$(echo "$FIRST_BACKEND" | sed 's/postgres_//')
    FIRST_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[\"$FIRST_INSTANCE\"].port" 2>/dev/null)
    FIRST_DOMAIN=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[\"$FIRST_INSTANCE\"].domain" 2>/dev/null)
    
    echo "Default Backend (where non-TLS goes):"
    echo "  Instance: $FIRST_INSTANCE"
    echo "  Domain: $FIRST_DOMAIN"
    echo "  Port: $FIRST_PORT"
    echo ""
    
    if [ "$FIRST_PORT" != "$EXPECTED_PORT" ]; then
        echo "❌ PROBLEM FOUND!"
        echo "   Non-TLS connections route to: $FIRST_DOMAIN (port $FIRST_PORT)"
        echo "   Your domain should route to: $DOMAIN (port $EXPECTED_PORT)"
        echo ""
        echo "   This is why password authentication fails - wrong database!"
        echo ""
        echo "SOLUTION: Enable SSL on PostgreSQL containers so TLS/SNI routing works"
        echo "   OR use direct container port: psql -h 127.0.0.1 -p $EXPECTED_PORT"
    fi
fi

echo ""
echo "To verify which database you're hitting:"
echo "1. Connect: psql -h $DOMAIN -p 5432 -U postgres -d postgres"
echo "2. Run: SELECT current_database(), inet_server_port();"
echo "3. If port is NOT $EXPECTED_PORT, you're hitting the wrong database"
echo ""


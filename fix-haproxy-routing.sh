#!/bin/bash

# Fix HAProxy Routing Issues
# This script helps diagnose and fix HAProxy routing problems

echo "=========================================="
echo "HAProxy Routing Fix Script"
echo "=========================================="
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  This script needs sudo privileges"
    echo "   Run with: sudo bash fix-haproxy-routing.sh"
    exit 1
fi

echo "Step 1: Verify HAProxy Config Syntax"
echo "-----------------------------------"
HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
if [ ! -f "$HAPROXY_CONFIG" ]; then
    HAPROXY_CONFIG="/etc/haproxy/haproxy.cfg"
fi

if [ -f "$HAPROXY_CONFIG" ]; then
    haproxy -c -f "$HAPROXY_CONFIG"
    if [ $? -eq 0 ]; then
        echo "✅ HAProxy config syntax is valid"
    else
        echo "❌ HAProxy config has syntax errors!"
        echo "   Fix the config before proceeding"
        exit 1
    fi
else
    echo "❌ HAProxy config not found at $HAPROXY_CONFIG"
    exit 1
fi

echo ""
echo "Step 2: Check SNI Routing Rules"
echo "-----------------------------------"
echo "Checking if SNI rules are correctly configured..."
echo ""

# Check for exact domain matching (should use regex with ^ and $)
SNI_RULES=$(grep -E "use_backend.*req_ssl_sni" "$HAPROXY_CONFIG" | wc -l)
echo "Found $SNI_RULES SNI routing rules"

# Check if using exact match (should have ^ and $)
EXACT_MATCH=$(grep -E "req_ssl_sni.*\^.*\$" "$HAPROXY_CONFIG" | wc -l)
if [ "$EXACT_MATCH" -eq "$SNI_RULES" ]; then
    echo "✅ All SNI rules use exact domain matching"
else
    echo "⚠️  Some SNI rules may not use exact matching"
    echo "   This could cause routing to wrong containers"
fi

echo ""
echo "Step 3: Verify Port Mappings"
echo "-----------------------------------"
echo "Checking if container ports match HAProxy config..."
echo ""

# Use the API if available, otherwise check manually
if command -v curl &> /dev/null; then
    echo "Using API to verify ports..."
    # Note: This requires API key, so we'll do manual check instead
fi

# Manual check: Compare backends.json with actual container ports
BACKENDS_FILE="/opt/n8n-daemon/haproxy/backends.json"
if [ -f "$BACKENDS_FILE" ]; then
    echo "Checking each backend..."
    
    # Get all domains
    while IFS= read -r domain; do
        if [ -z "$domain" ] || [ "$domain" == "null" ]; then
            continue
        fi
        
        # Get expected port from backends.json
        EXPECTED_PORT=$(cat "$BACKENDS_FILE" | jq -r ".[] | select(.domain == \"$domain\") | .port")
        INSTANCE_NAME=$(cat "$BACKENDS_FILE" | jq -r ".[] | select(.domain == \"$domain\") | .instanceName")
        
        if [ -z "$EXPECTED_PORT" ] || [ "$EXPECTED_PORT" == "null" ]; then
            continue
        fi
        
        # Find container
        CONTAINER=$(docker ps --format "{{.Names}}" | grep "$INSTANCE_NAME" | head -1)
        
        if [ -z "$CONTAINER" ]; then
            echo "  ⚠️  $domain: Container not found"
            continue
        fi
        
        # Get actual port
        ACTUAL_PORT=$(docker inspect "$CONTAINER" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort' 2>/dev/null)
        
        if [ -z "$ACTUAL_PORT" ] || [ "$ACTUAL_PORT" == "null" ]; then
            echo "  ⚠️  $domain: Could not get container port"
            continue
        fi
        
        if [ "$ACTUAL_PORT" == "$EXPECTED_PORT" ]; then
            echo "  ✅ $domain: Ports match ($ACTUAL_PORT)"
        else
            echo "  ❌ $domain: MISMATCH - Expected: $EXPECTED_PORT, Actual: $ACTUAL_PORT"
        fi
    done < <(cat "$BACKENDS_FILE" | jq -r '.[] | .domain')
else
    echo "❌ Backends file not found"
fi

echo ""
echo "Step 4: Fix Options"
echo "-----------------------------------"
echo ""
echo "If ports don't match or routing is wrong, try these fixes:"
echo ""
echo "Option 1: Auto-fix via API (Recommended)"
echo "  curl -X POST http://localhost:3001/api/haproxy/verify-ports \\"
echo "    -H 'X-API-Key: YOUR_API_KEY'"
echo ""
echo "Option 2: Regenerate HAProxy Config"
echo "  curl -X POST http://localhost:3001/api/haproxy/regenerate \\"
echo "    -H 'X-API-Key: YOUR_API_KEY'"
echo ""
echo "Option 3: Manual Fix"
echo "  1. Update backends.json with correct ports"
echo "  2. Regenerate config: curl -X POST http://localhost:3001/api/haproxy/regenerate"
echo ""
echo "Option 4: Check HAProxy Logs"
echo "  sudo journalctl -u haproxy -n 50"
echo "  or"
echo "  sudo tail -f /var/log/haproxy.log"
echo ""

echo "Step 5: Test Connection"
echo "-----------------------------------"
read -p "Enter domain to test (e.g., 50-cmhmoqju.hostinau.com): " TEST_DOMAIN

if [ -n "$TEST_DOMAIN" ]; then
    echo ""
    echo "Testing connection to $TEST_DOMAIN:5432..."
    
    # Get the port from backends.json
    TEST_PORT=$(cat "$BACKENDS_FILE" 2>/dev/null | jq -r ".[] | select(.domain == \"$TEST_DOMAIN\") | .port" 2>/dev/null)
    
    if [ -n "$TEST_PORT" ] && [ "$TEST_PORT" != "null" ]; then
        echo "Expected container port: $TEST_PORT"
        echo ""
        echo "Testing direct connection to container..."
        if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$TEST_PORT" 2>/dev/null; then
            echo "✅ Container port $TEST_PORT is accessible"
        else
            echo "❌ Container port $TEST_PORT is NOT accessible"
        fi
        
        echo ""
        echo "Testing HAProxy routing (requires psql or similar)..."
        echo "Run this command to test:"
        echo "  psql -h $TEST_DOMAIN -p 5432 -U postgres -d postgres"
        echo "  or"
        echo "  nc -zv $TEST_DOMAIN 5432"
    else
        echo "❌ Domain not found in backends.json"
    fi
fi

echo ""
echo "=========================================="
echo "Done"
echo "=========================================="


#!/bin/bash

# Check port for instance: 50-cmhmoqju.hostinau.com
DOMAIN="50-cmhmoqju.hostinau.com"

echo "=========================================="
echo "Checking Ports for: $DOMAIN"
echo "=========================================="
echo ""

# 1. Check HAProxy Backend Port
echo "1. HAProxy Backend Configuration"
echo "-----------------------------------"
HAPROXY_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r "to_entries[] | select(.value.domain == \"$DOMAIN\") | .value.port" 2>/dev/null)

if [ -n "$HAPROXY_PORT" ] && [ "$HAPROXY_PORT" != "null" ]; then
    echo "✅ HAProxy backend port: $HAPROXY_PORT"
    INSTANCE_NAME=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r "to_entries[] | select(.value.domain == \"$DOMAIN\") | .key" 2>/dev/null)
    echo "   Instance name: $INSTANCE_NAME"
else
    echo "❌ Domain not found in HAProxy backends"
    echo "   Checking if backends.json exists..."
    if [ -f "/opt/n8n-daemon/haproxy/backends.json" ]; then
        echo "   File exists. Available domains:"
        sudo cat /opt/n8n-daemon/haproxy/backends.json | jq -r '.[] | .domain' 2>/dev/null
    else
        echo "   File not found at /opt/n8n-daemon/haproxy/backends.json"
    fi
    exit 1
fi

echo ""
echo "2. Container Port (from Docker)"
echo "-----------------------------------"

# Find container by instance name or domain
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep -E "(50|cmhmoqju)" | head -1)

if [ -z "$CONTAINER_NAME" ]; then
    echo "❌ Container not found"
    echo "   Searching for containers with '50' or 'cmhmoqju'..."
    docker ps --format "{{.Names}}" | grep -i "50\|cmhmoqju" || echo "   No matching containers found"
    exit 1
fi

echo "✅ Container found: $CONTAINER_NAME"

# Get actual container port
CONTAINER_PORT=$(docker inspect "$CONTAINER_NAME" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort' 2>/dev/null)

if [ -n "$CONTAINER_PORT" ] && [ "$CONTAINER_PORT" != "null" ]; then
    echo "✅ Container bound port: $CONTAINER_PORT"
else
    echo "❌ Could not determine container port"
    echo "   Checking all port bindings..."
    docker inspect "$CONTAINER_NAME" 2>/dev/null | jq '.[0].NetworkSettings.Ports' 2>/dev/null
    exit 1
fi

echo ""
echo "3. Port Comparison"
echo "-----------------------------------"
if [ "$CONTAINER_PORT" == "$HAPROXY_PORT" ]; then
    echo "✅ PORTS MATCH: $CONTAINER_PORT"
    echo ""
    echo "Routing: $DOMAIN:5432 → HAProxy (SNI) → 127.0.0.1:$CONTAINER_PORT"
else
    echo "❌ PORT MISMATCH!"
    echo "   Container port: $CONTAINER_PORT"
    echo "   HAProxy port:    $HAPROXY_PORT"
    echo ""
    echo "⚠️  HAProxy is routing to the wrong port!"
    echo "   Run this to fix: curl -X POST http://localhost:3001/api/haproxy/verify-ports -H 'X-API-Key: YOUR_KEY'"
fi

echo ""
echo "4. HAProxy Config Check"
echo "-----------------------------------"
HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
if [ ! -f "$HAPROXY_CONFIG" ]; then
    HAPROXY_CONFIG="/etc/haproxy/haproxy.cfg"
fi

if [ -f "$HAPROXY_CONFIG" ]; then
    echo "Checking HAProxy config for domain: $DOMAIN"
    sudo grep -A 5 "$DOMAIN" "$HAPROXY_CONFIG" | head -10
else
    echo "❌ HAProxy config not found"
fi

echo ""
echo "5. Port Accessibility"
echo "-----------------------------------"
if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$CONTAINER_PORT" 2>/dev/null; then
    echo "✅ Port $CONTAINER_PORT is accessible on 127.0.0.1"
    echo "   HAProxy can reach the container"
else
    echo "❌ Port $CONTAINER_PORT is NOT accessible on 127.0.0.1"
    echo "   HAProxy cannot reach the container!"
fi

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Domain:        $DOMAIN"
echo "External Port: 5432 (always)"
echo "Container:     $CONTAINER_NAME"
echo "Container Port: $CONTAINER_PORT"
echo "HAProxy Port:  $HAPROXY_PORT"
echo "Status:        $([ "$CONTAINER_PORT" == "$HAPROXY_PORT" ] && echo "✅ MATCH" || echo "❌ MISMATCH")"
echo ""


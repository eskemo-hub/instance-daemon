#!/bin/bash

# Database Routing Diagnostic Script
# Checks HAProxy configuration and container port bindings

set -e

DOMAIN="${1:-36-cmhmoqju.hostinau.com}"

echo "=========================================="
echo "Database Routing Diagnostic"
echo "=========================================="
echo "Domain: $DOMAIN"
echo ""

# Extract subdomain and domain
SUBDOMAIN=$(echo "$DOMAIN" | cut -d. -f1)
DOMAIN_PART=$(echo "$DOMAIN" | cut -d. -f2-)

echo "1. Checking HAProxy Configuration..."
echo "-----------------------------------"

HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
if [ ! -f "$HAPROXY_CONFIG" ]; then
    HAPROXY_CONFIG="/etc/haproxy/haproxy.cfg"
fi

if [ -f "$HAPROXY_CONFIG" ]; then
    echo "HAProxy config location: $HAPROXY_CONFIG"
    echo ""
    
    # Find backend configuration for this domain
    echo "Backend configuration for $DOMAIN:"
    grep -A 5 "backend postgres_.*" "$HAPROXY_CONFIG" | grep -B 5 -A 5 "$DOMAIN" || echo "  No backend found for $DOMAIN"
    echo ""
    
    # Find all PostgreSQL backends
    echo "All PostgreSQL backends:"
    grep -E "^backend postgres_" "$HAPROXY_CONFIG" | while read line; do
        BACKEND_NAME=$(echo "$line" | awk '{print $2}')
        echo "  Backend: $BACKEND_NAME"
        grep -A 3 "backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "server" | head -1
    done
    echo ""
    
    # Check frontend routing
    echo "Frontend routing rules:"
    grep -A 10 "frontend postgres_frontend" "$HAPROXY_CONFIG" | grep -E "(use_backend|default_backend)" | grep -i "$DOMAIN" || echo "  No routing rule found for $DOMAIN"
    echo ""
else
    echo "  ❌ HAProxy config not found at $HAPROXY_CONFIG"
    echo ""
fi

echo "2. Checking HAProxy Backends JSON..."
echo "-----------------------------------"

BACKENDS_FILE="/opt/n8n-daemon/haproxy/backends.json"
if [ ! -f "$BACKENDS_FILE" ]; then
    BACKENDS_FILE="$(pwd)/haproxy/backends.json"
fi

if [ -f "$BACKENDS_FILE" ]; then
    echo "Backends file: $BACKENDS_FILE"
    echo ""
    echo "Backend entries:"
    cat "$BACKENDS_FILE" | jq '.' 2>/dev/null || cat "$BACKENDS_FILE"
    echo ""
    
    # Check if domain exists in backends
    if grep -q "$DOMAIN" "$BACKENDS_FILE"; then
        echo "  ✅ Domain found in backends file"
        PORT=$(cat "$BACKENDS_FILE" | jq -r ".[] | select(.domain == \"$DOMAIN\") | .port" 2>/dev/null || echo "")
        if [ -n "$PORT" ]; then
            echo "  Configured port: $PORT"
        fi
    else
        echo "  ❌ Domain NOT found in backends file"
    fi
    echo ""
else
    echo "  ❌ Backends file not found at $BACKENDS_FILE"
    echo ""
fi

echo "3. Checking Running Containers..."
echo "-----------------------------------"

# Find containers that might match
echo "PostgreSQL containers:"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}" | grep -i postgres || echo "  No PostgreSQL containers found"
echo ""

# Try to find container by subdomain or instance name
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep -i "$SUBDOMAIN" | head -1)

if [ -n "$CONTAINER_NAME" ]; then
    echo "Found container: $CONTAINER_NAME"
    echo ""
    
    echo "Container port bindings:"
    docker inspect "$CONTAINER_NAME" --format '{{range .NetworkSettings.Ports}}{{.}}{{println}}{{end}}' | grep -v "^$" || echo "  No port bindings found"
    echo ""
    
    echo "Detailed port information:"
    docker inspect "$CONTAINER_NAME" | jq -r '.[0].HostConfig.PortBindings' 2>/dev/null || \
    docker inspect "$CONTAINER_NAME" | grep -A 10 "PortBindings"
    echo ""
    
    echo "Container IP and network:"
    docker inspect "$CONTAINER_NAME" --format 'IP: {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
    echo ""
else
    echo "  ⚠️  No container found matching subdomain: $SUBDOMAIN"
    echo "  Listing all containers:"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
    echo ""
fi

echo "4. Checking Port Listeners..."
echo "-----------------------------------"

# Check what ports are listening on localhost
echo "Ports listening on 127.0.0.1:"
sudo ss -tlnp | grep "127.0.0.1" | grep -E ":(5432|3306|27017)" || echo "  No database ports found on 127.0.0.1"
echo ""

# Check HAProxy stats
echo "5. Checking HAProxy Status..."
echo "-----------------------------------"

if systemctl is-active --quiet haproxy; then
    echo "  ✅ HAProxy is running"
    
    # Try to get stats
    if [ -S /run/haproxy/admin.sock ]; then
        echo ""
        echo "HAProxy backend status:"
        echo "show stat" | sudo socat stdio /run/haproxy/admin.sock 2>/dev/null | grep -E "postgres|BACKEND" | head -20 || echo "  Could not retrieve stats"
    else
        echo "  ⚠️  HAProxy admin socket not found at /run/haproxy/admin.sock"
    fi
    
    # Check HAProxy logs for errors
    echo ""
    echo "Recent HAProxy errors:"
    sudo journalctl -u haproxy -n 20 --no-pager | grep -i error || echo "  No errors found"
else
    echo "  ❌ HAProxy is NOT running"
    echo "  Start with: sudo systemctl start haproxy"
fi
echo ""

echo "6. Testing Connection..."
echo "-----------------------------------"

# Try to find the port from backends
if [ -f "$BACKENDS_FILE" ]; then
    BACKEND_PORT=$(cat "$BACKENDS_FILE" | jq -r ".[] | select(.domain == \"$DOMAIN\") | .port" 2>/dev/null || echo "")
    
    if [ -n "$BACKEND_PORT" ]; then
        echo "Testing connection to 127.0.0.1:$BACKEND_PORT"
        
        # Test TCP connection
        if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$BACKEND_PORT" 2>/dev/null; then
            echo "  ✅ Port $BACKEND_PORT is accessible on 127.0.0.1"
        else
            echo "  ❌ Port $BACKEND_PORT is NOT accessible on 127.0.0.1"
            echo "  This means HAProxy cannot reach the container!"
        fi
        
        # Check if PostgreSQL is responding
        if command -v psql &> /dev/null; then
            echo ""
            echo "Testing PostgreSQL connection (this will show password error if routing works):"
            PGPASSWORD="test" timeout 3 psql -h 127.0.0.1 -p "$BACKEND_PORT" -U postgres -c "SELECT 1;" 2>&1 | head -3 || echo "  Connection test completed"
        fi
    else
        echo "  ⚠️  Could not determine backend port from backends.json"
    fi
else
    echo "  ⚠️  Backends file not found, cannot test connection"
fi
echo ""

echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "To fix routing issues:"
echo "1. Verify container is bound to 127.0.0.1:PORT (not 0.0.0.0)"
echo "2. Verify HAProxy backend points to 127.0.0.1:PORT"
echo "3. Verify PORT matches between container and HAProxy config"
echo "4. Check HAProxy logs: sudo journalctl -u haproxy -f"
echo "5. Regenerate HAProxy config if needed"
echo ""


#!/bin/bash

# HAProxy Routing Diagnostic Script
# Checks if HAProxy is routing to the correct container ports

echo "=========================================="
echo "HAProxy Routing Diagnostic"
echo "=========================================="
echo ""

# Check HAProxy config location
HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
if [ ! -f "$HAPROXY_CONFIG" ]; then
    HAPROXY_CONFIG="/etc/haproxy/haproxy.cfg"
fi

echo "1. Checking HAProxy Backend Routing (Port 5432 - TLS)"
echo "------------------------------------------------------"
echo "This shows which container ports HAProxy routes to for each domain:"
echo ""

# Extract all backend server definitions
sudo grep -E "^backend postgres_" "$HAPROXY_CONFIG" | while read backend_line; do
    BACKEND_NAME=$(echo "$backend_line" | awk '{print $2}')
    SERVER_LINE=$(sudo grep -A 3 "backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "server" | head -1)
    PORT=$(echo "$SERVER_LINE" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
    
    # Find which domain uses this backend
    DOMAIN=$(sudo grep -B 10 "backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "use_backend.*$BACKEND_NAME" | grep -o "[0-9]*-[a-z0-9]*\.[a-z.]*" | head -1)
    
    if [ -n "$DOMAIN" ] && [ -n "$PORT" ]; then
        echo "  Domain: $DOMAIN"
        echo "  Backend: $BACKEND_NAME"
        echo "  Routes to: 127.0.0.1:$PORT"
        echo ""
    fi
done

echo ""
echo "2. Checking Non-TLS Port Routing (5433, 5434, 5435, etc.)"
echo "------------------------------------------------------"
for port in 5433 5434 5435 5436 5437 5438; do
    FRONTEND=$(sudo grep -B 5 "bind \*:$port" "$HAPROXY_CONFIG" | grep "frontend" | head -1)
    if [ -n "$FRONTEND" ]; then
        BACKEND_NAME=$(sudo grep -A 3 "bind \*:$port" "$HAPROXY_CONFIG" | grep "default_backend" | awk '{print $2}')
        if [ -n "$BACKEND_NAME" ]; then
            SERVER_LINE=$(sudo grep -A 3 "backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "server" | head -1)
            ROUTE_PORT=$(echo "$SERVER_LINE" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
            DOMAIN=$(echo "$FRONTEND" | grep -o "[0-9]*-[a-z0-9]*\.[a-z.]*" | head -1)
            echo "  Port $port: Routes to 127.0.0.1:$ROUTE_PORT (Domain: $DOMAIN)"
        fi
    fi
done

echo ""
echo "3. Checking backends.json File"
echo "------------------------------------------------------"
BACKENDS_FILE="/opt/n8n-daemon/haproxy/backends.json"
if [ -f "$BACKENDS_FILE" ]; then
    echo "All backends and their ports:"
    sudo cat "$BACKENDS_FILE" | jq 'to_entries | .[] | {instanceName: .key, domain: .value.domain, port: .value.port}' | jq -s 'sort_by(.port)'
    
    echo ""
    echo "Checking for duplicate ports:"
    DUPLICATES=$(sudo cat "$BACKENDS_FILE" | jq '[.[] | .port] | group_by(.) | .[] | select(length > 1) | .[0]')
    if [ -n "$DUPLICATES" ] && [ "$DUPLICATES" != "null" ]; then
        echo "  ❌ FOUND DUPLICATE PORTS!"
        for dup_port in $DUPLICATES; do
            echo "    Port $dup_port is used by:"
            sudo cat "$BACKENDS_FILE" | jq -r "to_entries | .[] | select(.value.port == $dup_port) | \"      - \(.key) (\(.value.domain))\"" 
        done
    else
        echo "  ✅ No duplicate ports found"
    fi
else
    echo "  ❌ Backends file not found at $BACKENDS_FILE"
fi

echo ""
echo "4. Checking Actual Container Port Bindings"
echo "------------------------------------------------------"
docker ps --format "{{.Names}}" | grep -i postgres | while read container_name; do
    echo "Container: $container_name"
    PORT_BINDING=$(docker inspect "$container_name" | jq -r '.[0].HostConfig.PortBindings | to_entries[] | select(.key | contains("5432")) | "  Bound to: " + .value[0].HostIp + ":" + .value[0].HostPort')
    if [ -n "$PORT_BINDING" ]; then
        echo "$PORT_BINDING"
    else
        echo "  ⚠️  No port 5432 binding found"
    fi
    echo ""
done

echo ""
echo "5. Comparing HAProxy Config vs Container Ports"
echo "------------------------------------------------------"
if [ -f "$BACKENDS_FILE" ]; then
    sudo cat "$BACKENDS_FILE" | jq -r 'to_entries | .[] | "\(.key)|\(.value.domain)|\(.value.port)"' | while IFS='|' read instance_name domain haproxy_port; do
        # Find container by instance name pattern
        CONTAINER=$(docker ps --format "{{.Names}}" | grep "$instance_name" | head -1)
        if [ -n "$CONTAINER" ]; then
            ACTUAL_PORT=$(docker inspect "$CONTAINER" | jq -r '.[0].HostConfig.PortBindings | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort')
            if [ -n "$ACTUAL_PORT" ]; then
                if [ "$ACTUAL_PORT" = "$haproxy_port" ]; then
                    echo "  ✅ $domain: HAProxy=$haproxy_port, Container=$ACTUAL_PORT (MATCH)"
                else
                    echo "  ❌ $domain: HAProxy=$haproxy_port, Container=$ACTUAL_PORT (MISMATCH!)"
                fi
            else
                echo "  ⚠️  $domain: HAProxy=$haproxy_port, Container=NOT_FOUND"
            fi
        else
            echo "  ⚠️  $domain: HAProxy=$haproxy_port, Container=NOT_FOUND"
        fi
    done
fi

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "If you see mismatches above, the issue is:"
echo "1. Container is bound to a different port than HAProxy expects"
echo "2. Or HAProxy backend has the wrong port in backends.json"
echo ""
echo "To fix:"
echo "1. Check daemon logs when creating new instances"
echo "2. Verify port allocation is working correctly"
echo "3. Regenerate HAProxy config: sudo systemctl reload haproxy"
echo ""


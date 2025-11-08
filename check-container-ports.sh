#!/bin/bash

# Check Docker Container Port Assignments
# Shows what port each container is actually bound to

echo "=========================================="
echo "Docker Container Port Check"
echo "=========================================="
echo ""

# Check if domain is provided
if [ -n "$1" ]; then
    DOMAIN="$1"
    echo "Checking container for domain: $DOMAIN"
    echo ""
    
    # Get instance name from backends.json
    INSTANCE_NAME=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .instanceName" 2>/dev/null)
    
    if [ -z "$INSTANCE_NAME" ] || [ "$INSTANCE_NAME" == "null" ]; then
        echo "❌ Domain not found in backends.json"
        exit 1
    fi
    
    echo "Instance name: $INSTANCE_NAME"
    echo ""
    
    # Find container
    CONTAINER=$(docker ps --format "{{.Names}}" | grep "$INSTANCE_NAME" | head -1)
    
    if [ -z "$CONTAINER" ]; then
        echo "❌ Container not found for instance: $INSTANCE_NAME"
        echo "Searching for similar containers..."
        docker ps --format "{{.Names}}" | grep -i "$(echo $INSTANCE_NAME | cut -d'_' -f1)" || echo "  No matching containers"
        exit 1
    fi
    
    echo "Container: $CONTAINER"
    echo ""
    
    # Get port bindings
    echo "Port Bindings:"
    docker inspect "$CONTAINER" | jq -r '.[0].NetworkSettings.Ports | to_entries[] | "  \(.key) → \(.value[0].HostIp):\(.value[0].HostPort)"' 2>/dev/null
    
    echo ""
    echo "Detailed Port Info:"
    docker inspect "$CONTAINER" | jq '.[0].NetworkSettings.Ports' 2>/dev/null
    
    echo ""
    echo "Host Config Port Bindings:"
    docker inspect "$CONTAINER" | jq '.[0].HostConfig.PortBindings' 2>/dev/null
    
else
    # Show all PostgreSQL containers
    echo "All PostgreSQL Containers and Their Ports:"
    echo "-----------------------------------"
    echo ""
    
    docker ps --format "{{.Names}}" | grep -i postgres | while read container_name; do
        echo "Container: $container_name"
        
        # Get all port bindings
        PORTS=$(docker inspect "$container_name" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports | to_entries[] | "\(.key) → \(.value[0].HostIp):\(.value[0].HostPort)"' 2>/dev/null)
        
        if [ -n "$PORTS" ]; then
            echo "$PORTS" | while read port_line; do
                echo "  $port_line"
            done
        else
            echo "  ⚠️  No port bindings found"
        fi
        
        # Get PostgreSQL port specifically
        PG_PORT=$(docker inspect "$container_name" 2>/dev/null | jq -r '.[0].NetworkSettings.Ports | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort' 2>/dev/null)
        
        if [ -n "$PG_PORT" ] && [ "$PG_PORT" != "null" ]; then
            echo "  → PostgreSQL port (5432/tcp) bound to: 127.0.0.1:$PG_PORT"
        fi
        
        echo ""
    done
    
    echo ""
    echo "To check a specific domain, run:"
    echo "  bash check-container-ports.sh DOMAIN"
    echo "  Example: bash check-container-ports.sh 50-cmhmoqju.hostinau.com"
fi

echo ""
echo "=========================================="
echo "Quick Commands"
echo "=========================================="
echo ""
echo "List all containers with ports:"
echo "  docker ps --format 'table {{.Names}}\t{{.Ports}}'"
echo ""
echo "Check specific container:"
echo "  docker inspect CONTAINER_NAME | jq '.[0].NetworkSettings.Ports'"
echo ""
echo "Get PostgreSQL port for container:"
echo "  docker inspect CONTAINER_NAME | jq -r '.[0].NetworkSettings.Ports | to_entries[] | select(.key | contains(\"5432\")) | .value[0].HostPort'"
echo ""


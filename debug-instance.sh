#!/bin/bash

# Debug script for n8n instance troubleshooting
# Usage: ./debug-instance.sh [container_id_or_name]

if [ -z "$1" ]; then
    echo "Usage: $0 <container_id_or_name>"
    echo ""
    echo "Available containers:"
    docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
    exit 1
fi

CONTAINER=$1

echo "========================================="
echo "n8n Instance Debug Report"
echo "========================================="
echo ""

# Container status
echo "1. Container Status:"
docker ps -a --filter "id=$CONTAINER" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Container details
echo "2. Container Details:"
docker inspect $CONTAINER --format '
Container ID: {{.Id}}
Name: {{.Name}}
State: {{.State.Status}}
Running: {{.State.Running}}
Started At: {{.State.StartedAt}}
Restart Count: {{.RestartCount}}
'
echo ""

# Port bindings
echo "3. Port Bindings:"
docker inspect $CONTAINER --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} -> {{(index $conf 0).HostPort}}{{"\n"}}{{end}}'
echo ""

# Get the host port
HOST_PORT=$(docker inspect $CONTAINER --format '{{range $p, $conf := .NetworkSettings.Ports}}{{(index $conf 0).HostPort}}{{end}}')

# Check if port is listening
echo "4. Port Listening Check:"
if [ ! -z "$HOST_PORT" ]; then
    echo "Checking if port $HOST_PORT is listening..."
    if command -v ss &> /dev/null; then
        ss -tlnp | grep ":$HOST_PORT" || echo "Port $HOST_PORT is NOT listening"
    elif command -v netstat &> /dev/null; then
        netstat -tlnp | grep ":$HOST_PORT" || echo "Port $HOST_PORT is NOT listening"
    else
        echo "Neither ss nor netstat available"
    fi
else
    echo "Could not determine host port"
fi
echo ""

# Test HTTP connection
echo "5. HTTP Connection Test:"
if [ ! -z "$HOST_PORT" ]; then
    echo "Testing http://localhost:$HOST_PORT ..."
    curl -I -s --connect-timeout 5 http://localhost:$HOST_PORT || echo "Connection failed"
else
    echo "Could not determine host port"
fi
echo ""

# Container logs (last 50 lines)
echo "6. Container Logs (last 50 lines):"
echo "-----------------------------------"
docker logs --tail 50 $CONTAINER
echo ""

# Environment variables
echo "7. Environment Variables:"
docker inspect $CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}' | grep N8N
echo ""

# Volume mounts
echo "8. Volume Mounts:"
docker inspect $CONTAINER --format '{{range .Mounts}}{{.Type}}: {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
echo ""

# Resource usage
echo "9. Resource Usage:"
docker stats $CONTAINER --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
echo ""

echo "========================================="
echo "Debug report complete"
echo "========================================="

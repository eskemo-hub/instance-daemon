#!/bin/bash

# Check container status and logs

CONTAINER_NAME="${1}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 CONTAINER_NAME"
    exit 1
fi

echo "Checking container: $CONTAINER_NAME"
echo "=========================================="
echo ""

# Check container status
echo "1. Container status:"
echo "-----------------------------------"
docker ps -a --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.State}}"
echo ""

# Wait a bit if restarting
STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null)
if [ "$STATUS" = "restarting" ]; then
    echo "Container is restarting, waiting 5 seconds..."
    sleep 5
    STATUS=$(docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}' 2>/dev/null)
    echo "Status after wait: $STATUS"
    echo ""
fi

# Check logs for errors
echo "2. Recent logs (last 20 lines):"
echo "-----------------------------------"
docker logs "$CONTAINER_NAME" --tail 20 2>&1
echo ""

# Check for SSL errors specifically
echo "3. SSL-related log entries:"
echo "-----------------------------------"
docker logs "$CONTAINER_NAME" 2>&1 | grep -i -E "(ssl|tls|certificate|error|fatal)" | tail -10 || echo "  No SSL-related errors found"
echo ""

# If container is running, check SSL status
if [ "$STATUS" = "running" ]; then
    echo "4. SSL status:"
    echo "-----------------------------------"
    docker exec "$CONTAINER_NAME" psql -U postgres -c "SHOW ssl;" 2>/dev/null || echo "  Could not check SSL status"
    echo ""
else
    echo "4. Container is not running (status: $STATUS)"
    echo "   Check logs above for errors"
    echo ""
fi


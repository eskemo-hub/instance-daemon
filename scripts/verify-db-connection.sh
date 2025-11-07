#!/bin/bash
# Verify database connection and container status

set -e

CONTAINER_NAME="${1:-postgres_cmhobhj5h000bjycnhjyrjchi}"
INTERNAL_PORT="${2:-5702}"

echo "=========================================="
echo "Database Connection Verification"
echo "=========================================="
echo "Container: $CONTAINER_NAME"
echo "Internal Port: $INTERNAL_PORT"
echo ""

# Check if container exists
echo "1. Checking container status..."
if sudo docker ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
  echo "  ✅ Container exists"
  sudo docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "$CONTAINER_NAME" || echo "  ⚠️  Container not running"
else
  echo "  ❌ Container not found"
  exit 1
fi
echo ""

# Check port binding
echo "2. Checking port binding..."
if sudo docker ps --format "{{.Names}}\t{{.Ports}}" | grep "$CONTAINER_NAME" | grep -q "127.0.0.1:$INTERNAL_PORT"; then
  echo "  ✅ Port $INTERNAL_PORT is bound to 127.0.0.1"
  sudo docker ps --format "{{.Names}}\t{{.Ports}}" | grep "$CONTAINER_NAME"
else
  echo "  ❌ Port $INTERNAL_PORT not found in container port bindings"
  echo "  Container ports:"
  sudo docker ps --format "{{.Names}}\t{{.Ports}}" | grep "$CONTAINER_NAME" || echo "    Container not running"
fi
echo ""

# Test direct connection to container port
echo "3. Testing direct connection to 127.0.0.1:$INTERNAL_PORT..."
if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$INTERNAL_PORT" 2>/dev/null; then
  echo "  ✅ Port $INTERNAL_PORT is accessible"
else
  echo "  ❌ Port $INTERNAL_PORT is NOT accessible"
fi
echo ""

# Check container logs for errors
echo "4. Recent container logs (last 20 lines)..."
sudo docker logs --tail 20 "$CONTAINER_NAME" 2>&1 | tail -20 || echo "  Could not get logs"
echo ""

# Try to connect with psql (if available)
echo "5. Testing PostgreSQL connection..."
if command -v psql &> /dev/null; then
  echo "  Attempting connection (will fail if password is wrong, but should show connection attempt)..."
  PGPASSWORD="test" timeout 3 psql -h 127.0.0.1 -p $INTERNAL_PORT -U postgres -d postgres -c "SELECT version();" 2>&1 | head -5 || echo "  Connection failed (expected if password is wrong)"
else
  echo "  psql not available, skipping connection test"
fi
echo ""

# Check HAProxy stats
echo "6. HAProxy backend status..."
if curl -s http://localhost:8404/stats 2>/dev/null | grep -q "postgres_postgres_cmhobhj5h000bjycnhjyrjchi"; then
  echo "  ✅ Backend found in HAProxy stats"
  curl -s http://localhost:8404/stats 2>/dev/null | grep "postgres_postgres_cmhobhj5h000bjycnhjyrjchi" | head -3
else
  echo "  ⚠️  Backend not found in HAProxy stats (might be normal if no connections)"
fi
echo ""

echo "=========================================="
echo "Verification Complete"
echo "=========================================="
echo ""
echo "To test connection with correct password:"
echo "  psql \"postgresql://postgres:YOUR_PASSWORD@127.0.0.1:$INTERNAL_PORT/postgres\""
echo ""
echo "To test via HAProxy (port 5435):"
echo "  psql \"postgresql://postgres:YOUR_PASSWORD@36-cmhmoqju.hostinau.com:5435/postgres\""
echo ""


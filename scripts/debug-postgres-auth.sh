#!/bin/bash
# Debug PostgreSQL authentication issues

set -e

CONTAINER_NAME="${1:-postgres_cmhobhj5h000bjycnhjyrjchi}"
INTERNAL_PORT="${2:-5702}"

echo "=========================================="
echo "PostgreSQL Authentication Debug"
echo "=========================================="
echo "Container: $CONTAINER_NAME"
echo "Internal Port: $INTERNAL_PORT"
echo ""

echo "1. Checking pg_hba.conf configuration..."
echo "-----------------------------------"
sudo docker exec "$CONTAINER_NAME" cat /var/lib/postgresql/data/pgdata/pg_hba.conf 2>/dev/null | tail -20 || \
sudo docker exec "$CONTAINER_NAME" cat /var/lib/postgresql/data/pg_hba.conf 2>/dev/null | tail -20 || \
echo "  Could not read pg_hba.conf"
echo ""

echo "2. Checking PostgreSQL users and authentication..."
echo "-----------------------------------"
# Try to connect locally (might work without password)
if sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "\du" 2>&1 | head -10; then
  echo "  ✅ Local connection works"
else
  echo "  ⚠️  Local connection failed"
fi
echo ""

echo "3. Checking password encryption method..."
echo "-----------------------------------"
sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "SHOW password_encryption;" 2>&1 || echo "  Could not check"
echo ""

echo "4. Testing connection source IP..."
echo "-----------------------------------"
echo "When connecting via HAProxy, PostgreSQL sees the connection as coming from:"
echo "  Source: 127.0.0.1 (HAProxy)"
echo ""
echo "Checking pg_hba.conf rules for 127.0.0.1 connections:"
sudo docker exec "$CONTAINER_NAME" grep -E "host|local" /var/lib/postgresql/data/pgdata/pg_hba.conf 2>/dev/null | tail -10 || \
sudo docker exec "$CONTAINER_NAME" grep -E "host|local" /var/lib/postgresql/data/pg_hba.conf 2>/dev/null | tail -10 || \
echo "  Could not check"
echo ""

echo "5. Checking PostgreSQL logs for connection details..."
echo "-----------------------------------"
echo "Recent authentication attempts:"
sudo docker logs --tail 30 "$CONTAINER_NAME" 2>&1 | grep -E "FATAL|authentication|connection" | tail -10
echo ""

echo "6. Testing direct connection (bypass HAProxy)..."
echo "-----------------------------------"
echo "Attempting direct connection to 127.0.0.1:$INTERNAL_PORT..."
echo "This will show if the issue is with HAProxy or PostgreSQL itself"
echo ""
echo "Run this manually with your password:"
echo "  psql \"postgresql://postgres:YOUR_PASSWORD@127.0.0.1:$INTERNAL_PORT/postgres\""
echo ""

echo "7. Checking if connection is being rejected before password check..."
echo "-----------------------------------"
# Check for connection rejections
sudo docker logs --tail 50 "$CONTAINER_NAME" 2>&1 | grep -i "reject\|denied\|refused" | tail -5 || echo "  No connection rejections found"
echo ""

echo "=========================================="
echo "Debug Complete"
echo "=========================================="
echo ""
echo "Key things to check:"
echo "  1. pg_hba.conf should allow connections from 127.0.0.1"
echo "  2. Authentication method should match (scram-sha-256)"
echo "  3. User 'postgres' should exist and have the correct password"
echo "  4. Try connecting directly (bypass HAProxy) to isolate the issue"
echo ""


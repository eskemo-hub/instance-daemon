#!/bin/bash
# Test database connection with password

set -e

CONTAINER_NAME="${1:-postgres_cmhobhj5h000bjycnhjyrjchi}"
PASSWORD="${2}"
DOMAIN="${3:-36-cmhmoqju.hostinau.com}"
PORT="${4:-5435}"

if [ -z "$PASSWORD" ]; then
  echo "Usage: $0 <container_name> <password> [domain] [port]"
  echo "Example: $0 postgres_cmhobhj5h000bjycnhjyrjchi fP7Uzs3hV523dyE6h2Dhkg 36-cmhmoqju.hostinau.com 5435"
  exit 1
fi

echo "=========================================="
echo "Testing Database Connection"
echo "=========================================="
echo "Container: $CONTAINER_NAME"
echo "Domain: $DOMAIN"
echo "Port: $PORT"
echo ""

echo "1. Testing direct connection (bypass HAProxy)..."
echo "-----------------------------------"
# Get the internal port from container
INTERNAL_PORT=$(sudo docker ps --format "{{.Names}}\t{{.Ports}}" | grep "$CONTAINER_NAME" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
if [ -n "$INTERNAL_PORT" ]; then
  echo "Internal port: $INTERNAL_PORT"
  if sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@127.0.0.1:$INTERNAL_PORT/postgres" -c "SELECT current_database(), current_user, inet_client_addr();" 2>&1; then
    echo "  ✅ Direct connection works"
  else
    echo "  ❌ Direct connection failed"
  fi
else
  echo "  ⚠️  Could not determine internal port"
fi
echo ""

echo "2. Testing via HAProxy (port $PORT)..."
echo "-----------------------------------"
if sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@$DOMAIN:$PORT/postgres" -c "SELECT current_database(), current_user, inet_client_addr();" 2>&1; then
  echo "  ✅ HAProxy connection works"
else
  echo "  ❌ HAProxy connection failed"
  echo ""
  echo "3. Checking what source IP PostgreSQL sees..."
  echo "-----------------------------------"
  echo "Connecting and checking connection source..."
  sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "
  SELECT 
      pid,
      usename,
      client_addr,
      client_port,
      state
  FROM pg_stat_activity 
  WHERE state = 'active' AND pid != pg_backend_pid()
  ORDER BY query_start DESC
  LIMIT 5;
  " 2>&1 || echo "Could not query"
fi
echo ""

echo "4. Checking pg_hba.conf for the source IP..."
echo "-----------------------------------"
echo "If connections are coming from Docker bridge network, we may need to add a rule."
echo "Common Docker bridge ranges: 172.17.0.0/16, 172.18.0.0/16"
echo ""
sudo docker exec "$CONTAINER_NAME" cat /var/lib/postgresql/data/pgdata/pg_hba.conf 2>/dev/null | grep -E "^host" | head -10
echo ""

echo "=========================================="
echo "Test Complete"
echo "=========================================="


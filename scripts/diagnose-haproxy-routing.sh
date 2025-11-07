#!/bin/bash
# Diagnostic script to check HAProxy routing and port assignments

set -e

echo "=========================================="
echo "HAProxy Routing Diagnostic"
echo "=========================================="
echo ""

# Find HAProxy config
HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
if [ ! -f "$HAPROXY_CONFIG" ]; then
  HAPROXY_CONFIG="$(pwd)/haproxy/haproxy.cfg"
fi

if [ ! -f "$HAPROXY_CONFIG" ]; then
  echo "❌ HAProxy config not found"
  exit 1
fi

echo "HAProxy Config: $HAPROXY_CONFIG"
echo ""

# Find backends.json
BACKENDS_FILE="/opt/n8n-daemon/haproxy/backends.json"
if [ ! -f "$BACKENDS_FILE" ]; then
  BACKENDS_FILE="$(pwd)/haproxy/backends.json"
fi

echo "1. PostgreSQL Backends Configuration"
echo "-----------------------------------"
if [ -f "$BACKENDS_FILE" ]; then
  echo "Backends JSON:"
  cat "$BACKENDS_FILE" | jq '.' 2>/dev/null || cat "$BACKENDS_FILE"
  echo ""
else
  echo "❌ backends.json not found"
fi

echo ""
echo "2. HAProxy Frontend Ports (PostgreSQL)"
echo "-----------------------------------"
echo "Port 5432 (TLS/SNI routing):"
grep -A 20 "frontend postgres_frontend_tls" "$HAPROXY_CONFIG" | head -25
echo ""

echo "Individual non-TLS frontends:"
grep -E "^frontend postgres_.*_frontend" "$HAPROXY_CONFIG" | while read line; do
  FRONTEND_NAME=$(echo "$line" | awk '{print $2}')
  echo "  $FRONTEND_NAME:"
  grep -A 5 "^frontend $FRONTEND_NAME" "$HAPROXY_CONFIG" | grep -E "(bind|default_backend)" | sed 's/^/    /'
done
echo ""

echo "3. HAProxy Backend Definitions"
echo "-----------------------------------"
grep -E "^backend postgres_" "$HAPROXY_CONFIG" | while read line; do
  BACKEND_NAME=$(echo "$line" | awk '{print $2}')
  echo "  $BACKEND_NAME:"
  grep -A 3 "^backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "server" | sed 's/^/    /'
done
echo ""

echo "4. Docker Container Ports"
echo "-----------------------------------"
echo "PostgreSQL containers and their port bindings:"
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -i postgres || echo "  No PostgreSQL containers found"
echo ""

echo "5. Port Mapping Summary"
echo "-----------------------------------"
echo "Checking which HAProxy ports map to which containers:"
for port in 5432 5433 5434 5435 5436; do
  if grep -q "bind \*:$port" "$HAPROXY_CONFIG"; then
    FRONTEND=$(grep -B 1 "bind \*:$port" "$HAPROXY_CONFIG" | grep "^frontend" | awk '{print $2}')
    BACKEND=$(grep -A 3 "^frontend $FRONTEND" "$HAPROXY_CONFIG" | grep "default_backend" | awk '{print $2}')
    if [ -n "$BACKEND" ]; then
      INTERNAL_PORT=$(grep -A 3 "^backend $BACKEND" "$HAPROXY_CONFIG" | grep "server" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
      echo "  Port $port → Frontend: $FRONTEND → Backend: $BACKEND → Internal: 127.0.0.1:$INTERNAL_PORT"
    fi
  fi
done
echo ""

echo "6. Testing Port Connectivity"
echo "-----------------------------------"
for port in 5432 5433 5434 5435 5436; do
  if timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$port" 2>/dev/null; then
    echo "  ✅ Port $port is listening"
  else
    echo "  ❌ Port $port is NOT listening"
  fi
done
echo ""

echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="


#!/bin/bash
# Check HAProxy routing for database 37

set -e

DOMAIN="37-cmhmoqju.hostinau.com"
HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"

echo "=========================================="
echo "Checking HAProxy Routing for Database 37"
echo "=========================================="
echo "Domain: $DOMAIN"
echo ""

echo "1. Finding HAProxy frontend for database 37..."
echo "-----------------------------------"
grep -B 2 -A 5 "$DOMAIN" "$HAPROXY_CONFIG" | head -20
echo ""

echo "2. Checking which port database 37 should use..."
echo "-----------------------------------"
# Find the frontend for database 37
FRONTEND=$(grep -B 2 "$DOMAIN" "$HAPROXY_CONFIG" | grep "^frontend" | head -1 | awk '{print $2}')
if [ -n "$FRONTEND" ]; then
  echo "Frontend: $FRONTEND"
  grep -A 5 "^frontend $FRONTEND" "$HAPROXY_CONFIG" | grep -E "(bind|default_backend)"
else
  echo "  ⚠️  Frontend not found for $DOMAIN"
fi
echo ""

echo "3. Checking backend for database 37..."
echo "-----------------------------------"
# Find backend name from SNI rule
BACKEND=$(grep "req.ssl_sni -i $DOMAIN" "$HAPROXY_CONFIG" | awk '{print $4}')
if [ -n "$BACKEND" ]; then
  echo "Backend (from SNI rule): $BACKEND"
  grep -A 3 "^backend $BACKEND" "$HAPROXY_CONFIG" | grep "server"
else
  echo "  ⚠️  Backend not found in SNI rules"
fi
echo ""

echo "4. Checking non-TLS frontend for database 37..."
echo "-----------------------------------"
# Find non-TLS frontend (should have unique port)
NON_TLS_FRONTEND=$(grep -B 5 "$DOMAIN" "$HAPROXY_CONFIG" | grep "^frontend.*_frontend" | tail -1 | awk '{print $2}')
if [ -n "$NON_TLS_FRONTEND" ]; then
  echo "Non-TLS Frontend: $NON_TLS_FRONTEND"
  PORT=$(grep -A 3 "^frontend $NON_TLS_FRONTEND" "$HAPROXY_CONFIG" | grep "bind" | grep -o ":\\([0-9]*\\)" | tr -d ':')
  BACKEND_NON_TLS=$(grep -A 3 "^frontend $NON_TLS_FRONTEND" "$HAPROXY_CONFIG" | grep "default_backend" | awk '{print $2}')
  echo "  Port: $PORT"
  echo "  Backend: $BACKEND_NON_TLS"
  if [ -n "$BACKEND_NON_TLS" ]; then
    echo "  Backend server:"
    grep -A 3 "^backend $BACKEND_NON_TLS" "$HAPROXY_CONFIG" | grep "server"
  fi
else
  echo "  ⚠️  Non-TLS frontend not found"
fi
echo ""

echo "5. All PostgreSQL backends and their ports..."
echo "-----------------------------------"
grep -E "^frontend postgres.*_frontend" "$HAPROXY_CONFIG" | while read line; do
  FRONTEND_NAME=$(echo "$line" | awk '{print $2}')
  PORT=$(grep -A 2 "^frontend $FRONTEND_NAME" "$HAPROXY_CONFIG" | grep "bind" | grep -o ":\\([0-9]*\\)" | tr -d ':')
  BACKEND=$(grep -A 2 "^frontend $FRONTEND_NAME" "$HAPROXY_CONFIG" | grep "default_backend" | awk '{print $2}')
  echo "  Frontend: $FRONTEND_NAME"
  echo "    Port: $PORT"
  echo "    Backend: $BACKEND"
  if [ -n "$BACKEND" ]; then
    INTERNAL=$(grep -A 3 "^backend $BACKEND" "$HAPROXY_CONFIG" | grep "server" | grep -o "127.0.0.1:[0-9]*")
    echo "    Internal: $INTERNAL"
  fi
  echo ""
done

echo "6. Testing which database you're actually connecting to..."
echo "-----------------------------------"
echo "When you connect to $DOMAIN:5435, run this query to see which database:"
echo "  SELECT current_database(), inet_server_addr(), inet_server_port();"
echo ""


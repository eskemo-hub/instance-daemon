#!/bin/bash
# Test connection for database 37

PASSWORD="fP7Uzs3hV523dyE6h2Dhkg"
DOMAIN="37-cmhmoqju.hostinau.com"

echo "Testing database 37 connection..."
echo ""

# Find the container
CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -i "37\|cmhoh0xjb000hjycnniu06xud" | head -1)

if [ -z "$CONTAINER" ]; then
  echo "Could not find database 37 container"
  echo "Available PostgreSQL containers:"
  sudo docker ps --format "{{.Names}}" | grep -i postgres
  exit 1
fi

echo "Container: $CONTAINER"
INTERNAL_PORT=$(sudo docker ps --format "{{.Names}}\t{{.Ports}}" | grep "$CONTAINER" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
echo "Internal port: $INTERNAL_PORT"
echo ""

echo "1. Direct connection (bypass HAProxy) to port $INTERNAL_PORT:"
sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@127.0.0.1:$INTERNAL_PORT/postgres" -c "SELECT current_database(), current_user, version();" 2>&1

echo ""
echo "2. Via HAProxy on port 5435:"
sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@$DOMAIN:5435/postgres" -c "SELECT current_database(), current_user, version();" 2>&1


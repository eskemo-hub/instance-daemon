#!/bin/bash
# Quick test for database 36

PASSWORD="gwcGhBi8UBaz3TkqRxPKag"
CONTAINER="postgres_cmhobhj5h000bjycnhjyrjchi"
DOMAIN="36-cmhmoqju.hostinau.com"

echo "Testing database 36 connection..."
echo ""

echo "1. Direct connection (bypass HAProxy) to port 5702:"
sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@127.0.0.1:5702/postgres" -c "SELECT current_database(), current_user, version();" 2>&1

echo ""
echo "2. Via HAProxy on port 5435:"
sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@$DOMAIN:5435/postgres" -c "SELECT current_database(), current_user, version();" 2>&1

echo ""
echo "3. Via HAProxy on port 5432 (TLS - if configured):"
sudo docker run --rm --network host -e PGPASSWORD="$PASSWORD" postgres:16-alpine psql "postgresql://postgres:$PASSWORD@$DOMAIN:5432/postgres?sslmode=require" -c "SELECT current_database(), current_user, version();" 2>&1


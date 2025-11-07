#!/bin/bash
# Fix pg_hba.conf to allow connections from HAProxy

set -e

CONTAINER_NAME="${1:-postgres_cmhobhj5h000bjycnhjyrjchi}"

echo "=========================================="
echo "Fixing PostgreSQL pg_hba.conf"
echo "=========================================="
echo "Container: $CONTAINER_NAME"
echo ""

# Find pg_hba.conf location
PGHBA_PATH="/var/lib/postgresql/data/pgdata/pg_hba.conf"
if ! sudo docker exec "$CONTAINER_NAME" test -f "$PGHBA_PATH" 2>/dev/null; then
  PGHBA_PATH="/var/lib/postgresql/data/pg_hba.conf"
fi

echo "Using pg_hba.conf: $PGHBA_PATH"
echo ""

echo "1. Backing up current pg_hba.conf..."
sudo docker exec "$CONTAINER_NAME" cp "$PGHBA_PATH" "${PGHBA_PATH}.backup.$(date +%s)" 2>/dev/null || echo "  Could not create backup"
echo ""

echo "2. Current pg_hba.conf (last 15 lines):"
sudo docker exec "$CONTAINER_NAME" tail -15 "$PGHBA_PATH" 2>/dev/null || echo "  Could not read"
echo ""

echo "3. Fixing pg_hba.conf..."
echo "-----------------------------------"
echo "The issue is that the catch-all rule 'host all all all scram-sha-256'"
echo "is matching before the 127.0.0.1 trust rule."
echo ""
echo "We need to ensure 127.0.0.1 connections use 'trust' authentication"
echo "so HAProxy connections work without password issues."
echo ""

# Create a fixed pg_hba.conf
FIXED_PGHBA=$(cat <<'EOF'
# PostgreSQL Client Authentication Configuration File
# This file controls: which hosts are allowed to connect, how clients
# are authenticated, which PostgreSQL user names they can use, which
# databases they can access.

# TYPE  DATABASE        USER            ADDRESS                 METHOD

# "local" is for Unix domain socket connections only
local   all             all                                     trust

# IPv4 local connections (including HAProxy):
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust

# Allow replication connections from localhost
local   replication     all                                     trust
host    replication     all             127.0.0.1/32            trust
host    replication     all             ::1/128                 trust

# External connections (from outside localhost) require password
host    all             all             0.0.0.0/0               scram-sha-256
host    all             all             ::/0                    scram-sha-256
EOF
)

# Write the fixed config
echo "$FIXED_PGHBA" | sudo docker exec -i "$CONTAINER_NAME" tee "$PGHBA_PATH" > /dev/null

echo "  ✅ Updated pg_hba.conf"
echo ""

echo "4. Reloading PostgreSQL configuration..."
if sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "SELECT pg_reload_conf();" 2>&1; then
  echo "  ✅ Configuration reloaded"
else
  echo "  ⚠️  Could not reload, you may need to restart the container"
  echo "  Run: sudo docker restart $CONTAINER_NAME"
fi
echo ""

echo "5. Verifying new configuration..."
sudo docker exec "$CONTAINER_NAME" tail -10 "$PGHBA_PATH" 2>/dev/null || echo "  Could not verify"
echo ""

echo "=========================================="
echo "Fix Complete"
echo "=========================================="
echo ""
echo "Now test the connection:"
echo "  psql \"postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5702/postgres\""
echo "  or via HAProxy:"
echo "  psql \"postgresql://postgres:YOUR_PASSWORD@36-cmhmoqju.hostinau.com:5435/postgres\""
echo ""
echo "Note: With 'trust' authentication for 127.0.0.1, the password might be ignored."
echo "This is expected for localhost connections."
echo ""


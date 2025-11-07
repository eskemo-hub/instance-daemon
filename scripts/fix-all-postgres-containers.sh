#!/bin/bash
# Fix pg_hba.conf for all PostgreSQL containers

set -e

echo "=========================================="
echo "Fixing PostgreSQL pg_hba.conf for All Containers"
echo "=========================================="
echo ""

# Find all PostgreSQL containers
CONTAINERS=$(sudo docker ps --format "{{.Names}}" | grep -i postgres || echo "")

if [ -z "$CONTAINERS" ]; then
  echo "No PostgreSQL containers found"
  exit 1
fi

echo "Found PostgreSQL containers:"
echo "$CONTAINERS"
echo ""

for CONTAINER in $CONTAINERS; do
  echo "=========================================="
  echo "Fixing container: $CONTAINER"
  echo "=========================================="
  
  # Find pg_hba.conf location
  PGHBA_PATH="/var/lib/postgresql/data/pgdata/pg_hba.conf"
  if ! sudo docker exec "$CONTAINER" test -f "$PGHBA_PATH" 2>/dev/null; then
    PGHBA_PATH="/var/lib/postgresql/data/pg_hba.conf"
  fi
  
  if ! sudo docker exec "$CONTAINER" test -f "$PGHBA_PATH" 2>/dev/null; then
    echo "  ⚠️  pg_hba.conf not found at $PGHBA_PATH, skipping..."
    continue
  fi
  
  echo "Using pg_hba.conf: $PGHBA_PATH"
  
  # Create fixed pg_hba.conf
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
  echo "$FIXED_PGHBA" | sudo docker exec -i "$CONTAINER" tee "$PGHBA_PATH" > /dev/null
  
  echo "  ✅ Updated pg_hba.conf"
  
  # Reload PostgreSQL configuration
  if sudo docker exec "$CONTAINER" psql -U postgres -d postgres -c "SELECT pg_reload_conf();" 2>&1 > /dev/null; then
    echo "  ✅ Configuration reloaded"
  else
    echo "  ⚠️  Could not reload, container may need restart"
  fi
  
  echo ""
done

echo "=========================================="
echo "All containers fixed!"
echo "=========================================="
echo ""
echo "Test connections:"
echo "  Database 36: psql \"postgresql://postgres:gwcGhBi8UBaz3TkqRxPKag@36-cmhmoqju.hostinau.com:5435/postgres\""
echo "  Database 37: psql \"postgresql://postgres:fP7Uzs3hV523dyE6h2Dhkg@37-cmhmoqju.hostinau.com:5435/postgres\""
echo ""


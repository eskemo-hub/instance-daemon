#!/bin/bash
# Check what source IP PostgreSQL sees for connections

set -e

CONTAINER_NAME="${1:-postgres_cmhobhj5h000bjycnhjyrjchi}"

echo "=========================================="
echo "Checking PostgreSQL Connection Source IP"
echo "=========================================="
echo ""

echo "1. Current active connections and their source IPs:"
echo "-----------------------------------"
sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    client_port,
    state,
    query_start
FROM pg_stat_activity 
WHERE datname = 'postgres' AND pid != pg_backend_pid()
ORDER BY query_start DESC;
" 2>&1 || echo "Could not query"
echo ""

echo "2. Testing what IP PostgreSQL sees for a connection:"
echo "-----------------------------------"
echo "Making a test connection and checking the source IP..."
echo ""

# Make a connection and check what IP it sees
sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "
SELECT 
    inet_server_addr() as server_ip,
    inet_server_port() as server_port,
    inet_client_addr() as client_ip,
    inet_client_port() as client_port;
" 2>&1

echo ""
echo "3. Checking pg_hba.conf rules again:"
echo "-----------------------------------"
sudo docker exec "$CONTAINER_NAME" grep -E "^host|^local" /var/lib/postgresql/data/pgdata/pg_hba.conf 2>/dev/null | head -10
echo ""

echo "4. If connections are coming from Docker bridge network:"
echo "-----------------------------------"
echo "Docker containers might see connections from Docker's bridge network IP range."
echo "Common Docker bridge IPs: 172.17.0.0/16, 172.18.0.0/16, etc."
echo ""
echo "We may need to add a rule for the Docker bridge network."
echo ""


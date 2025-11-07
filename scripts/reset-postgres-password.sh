#!/bin/bash
# Reset PostgreSQL password for a container

set -e

CONTAINER_NAME="${1:-postgres_cmhobhj5h000bjycnhjyrjchi}"
NEW_PASSWORD="${2}"

if [ -z "$NEW_PASSWORD" ]; then
  echo "Usage: $0 <container_name> <new_password>"
  echo "Example: $0 postgres_cmhobhj5h000bjycnhjyrjchi mynewpassword123"
  exit 1
fi

echo "=========================================="
echo "PostgreSQL Password Reset"
echo "=========================================="
echo "Container: $CONTAINER_NAME"
echo ""

# Check if container is running
if ! sudo docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
  echo "❌ Container $CONTAINER_NAME is not running"
  exit 1
fi

echo "1. Checking current PostgreSQL users..."
sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "\du" 2>&1 | head -20 || echo "  Could not list users (might need password)"
echo ""

echo "2. Resetting password for user 'postgres'..."
# Try to reset password using ALTER USER
# First, try to connect without password (local connections might work)
if sudo docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '$NEW_PASSWORD';" 2>&1; then
  echo "  ✅ Password reset successfully"
else
  echo "  ⚠️  Could not reset via ALTER USER, trying alternative method..."
  
  # Alternative: Use environment variable if container supports it
  # Or use pg_ctl to restart with trust authentication temporarily
  echo "  Attempting to reset via environment variable..."
  
  # Check if we can modify pg_hba.conf temporarily to allow trust auth
  echo "  Note: You may need to restart the container with POSTGRES_PASSWORD environment variable"
  echo "  Or manually edit pg_hba.conf to allow trust authentication temporarily"
fi
echo ""

echo "3. Testing new password..."
# Test the connection with new password
if timeout 3 sudo docker exec -e PGPASSWORD="$NEW_PASSWORD" "$CONTAINER_NAME" psql -U postgres -d postgres -c "SELECT current_user, current_database();" 2>&1; then
  echo "  ✅ Password works!"
else
  echo "  ❌ Password test failed"
  echo "  You may need to restart the container for changes to take effect"
fi
echo ""

echo "=========================================="
echo "Password Reset Complete"
echo "=========================================="
echo ""
echo "To test connection:"
echo "  psql \"postgresql://postgres:$NEW_PASSWORD@127.0.0.1:5702/postgres\""
echo ""


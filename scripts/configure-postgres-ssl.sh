#!/bin/bash
# Script to configure SSL for an existing PostgreSQL container
# Usage: ./configure-postgres-ssl.sh <container_id_or_name> <domain>

set -e

CONTAINER_ID="$1"
DOMAIN="$2"

if [ -z "$CONTAINER_ID" ] || [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <container_id_or_name> <domain>"
  echo "Example: $0 postgres_cmhobhj5h000bjycnhjyrjchi 36-cmhmoqju.hostinau.com"
  exit 1
fi

echo "Configuring SSL for PostgreSQL container: $CONTAINER_ID"
echo "Domain: $DOMAIN"
echo ""

# Check if container exists and is running
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_ID}$" && \
   ! docker ps --format "{{.ID}}" | grep -q "^${CONTAINER_ID}$"; then
  echo "Error: Container $CONTAINER_ID not found or not running"
  exit 1
fi

# Get container name
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep -E "^${CONTAINER_ID}$|.*${CONTAINER_ID}.*" | head -1)
if [ -z "$CONTAINER_NAME" ]; then
  CONTAINER_NAME=$(docker inspect --format '{{.Name}}' "$CONTAINER_ID" | sed 's|^/||')
fi

echo "Container name: $CONTAINER_NAME"
echo ""

# Generate certificates (if not already exist)
CERT_DIR="/opt/n8n-daemon/certs/${CONTAINER_NAME}"
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  echo "Generating certificates..."
  openssl genrsa -out "$CERT_DIR/server.key" 2048
  chmod 640 "$CERT_DIR/server.key"
  chown root:root "$CERT_DIR/server.key" 2>/dev/null || true
  
  openssl req -new -x509 -key "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt" \
    -days 3650 -subj "/CN=${DOMAIN}/O=Grumpy Wombat/C=US"
  chmod 644 "$CERT_DIR/server.crt"
  
  cp "$CERT_DIR/server.crt" "$CERT_DIR/ca.crt"
  echo "Certificates generated: $CERT_DIR"
else
  echo "Certificates already exist: $CERT_DIR"
fi

# Copy certificates into container
echo "Copying certificates into container..."
docker cp "$CERT_DIR/server.crt" "${CONTAINER_NAME}:/var/lib/postgresql/data/server.crt"
docker cp "$CERT_DIR/server.key" "${CONTAINER_NAME}:/var/lib/postgresql/data/server.key"
docker cp "$CERT_DIR/ca.crt" "${CONTAINER_NAME}:/var/lib/postgresql/data/ca.crt"

# Set permissions inside container
echo "Setting permissions..."
docker exec "$CONTAINER_NAME" chmod 600 /var/lib/postgresql/data/server.key
docker exec "$CONTAINER_NAME" chown postgres:postgres /var/lib/postgresql/data/server.* 2>/dev/null || \
docker exec -u root "$CONTAINER_NAME" chown postgres:postgres /var/lib/postgresql/data/server.* 2>/dev/null || true

# Configure postgresql.conf
echo "Configuring postgresql.conf..."
docker exec "$CONTAINER_NAME" bash -c "
  # Enable SSL
  if ! grep -q '^ssl = on' /var/lib/postgresql/data/postgresql.conf; then
    sed -i \"s/#ssl = off/ssl = on/\" /var/lib/postgresql/data/postgresql.conf 2>/dev/null || \
    sed -i \"s/ssl = off/ssl = on/\" /var/lib/postgresql/data/postgresql.conf 2>/dev/null || \
    echo 'ssl = on' >> /var/lib/postgresql/data/postgresql.conf
  fi
  
  # Set certificate paths
  if ! grep -q '^ssl_cert_file' /var/lib/postgresql/data/postgresql.conf; then
    sed -i \"s/#ssl_cert_file = 'server.crt'/ssl_cert_file = 'server.crt'/\" /var/lib/postgresql/data/postgresql.conf 2>/dev/null || \
    echo \"ssl_cert_file = 'server.crt'\" >> /var/lib/postgresql/data/postgresql.conf
  fi
  
  if ! grep -q '^ssl_key_file' /var/lib/postgresql/data/postgresql.conf; then
    sed -i \"s/#ssl_key_file = 'server.key'/ssl_key_file = 'server.key'/\" /var/lib/postgresql/data/postgresql.conf 2>/dev/null || \
    echo \"ssl_key_file = 'server.key'\" >> /var/lib/postgresql/data/postgresql.conf
  fi
"

# Update pg_hba.conf
echo "Updating pg_hba.conf..."
docker exec "$CONTAINER_NAME" bash -c "
  if ! grep -q 'hostssl' /var/lib/postgresql/data/pg_hba.conf; then
    echo 'hostssl all all 0.0.0.0/0 scram-sha-256' >> /var/lib/postgresql/data/pg_hba.conf
  fi
"

# Reload PostgreSQL configuration
echo "Reloading PostgreSQL configuration..."
docker exec "$CONTAINER_NAME" psql -U postgres -d postgres -c "SELECT pg_reload_conf();" 2>/dev/null || \
docker exec "$CONTAINER_NAME" psql -U \${POSTGRES_USER:-postgres} -d \${POSTGRES_DB:-postgres} -c "SELECT pg_reload_conf();" 2>/dev/null || true

echo ""
echo "✅ PostgreSQL SSL configuration complete!"
echo ""
echo "To test TLS connection:"
echo "  psql \"postgresql://user:pass@${DOMAIN}:5432/db?sslmode=require\""
echo ""
echo "Note: You may need to restart the container for changes to take full effect:"
echo "  docker restart ${CONTAINER_NAME}"


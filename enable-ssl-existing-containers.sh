#!/bin/bash

# Enable SSL on existing PostgreSQL containers
# This script modifies postgresql.conf to enable SSL

CONTAINER_NAME="${1}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 CONTAINER_NAME"
    echo "Example: $0 postgres_cmhplte3t0005jydari0ept4q"
    exit 1
fi

echo "=========================================="
echo "Enabling SSL on PostgreSQL Container"
echo "Container: $CONTAINER_NAME"
echo "=========================================="
echo ""

# Check if container exists
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Container not found: $CONTAINER_NAME"
    exit 1
fi

# Get domain from backends.json
DOMAIN=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.instanceName == \"$CONTAINER_NAME\") | .domain" 2>/dev/null)

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "null" ]; then
    echo "⚠️  Could not find domain for container, will use default paths"
    DOMAIN=""
fi

# Check if certificates are mounted or exist in container
CERT_FILE=""
KEY_FILE=""

# First, check if certificates are already mounted
if docker exec "$CONTAINER_NAME" ls /var/lib/postgresql/ssl/ >/dev/null 2>&1; then
    CERT_FILE=$(docker exec "$CONTAINER_NAME" sh -c "ls /var/lib/postgresql/ssl/*.crt /var/lib/postgresql/ssl/*.pem 2>/dev/null | head -1" | tr -d '\r\n')
    KEY_FILE=$(docker exec "$CONTAINER_NAME" sh -c "ls /var/lib/postgresql/ssl/*.key 2>/dev/null | head -1" | tr -d '\r\n')
fi

# If certificates not found, check on host and copy them
if [ -z "$CERT_FILE" ] || [ -z "$KEY_FILE" ]; then
    echo "⚠️  Certificates not mounted, checking host for certificates..."
    
    # Try to find certificates on host
    INSTANCE_NAME=$(echo "$CONTAINER_NAME" | sed 's/postgres_//')
    
    # Check multiple possible certificate locations
    # Note: Use sudo for checking /opt/n8n-daemon/ as it may require root access
    POSSIBLE_CERT_DIRS=(
        "/opt/n8n-daemon/certs/$INSTANCE_NAME"
        "/home/$(whoami)/instance-daemon/certs/$INSTANCE_NAME"
        "$HOME/instance-daemon/certs/$INSTANCE_NAME"
        "/var/lib/n8n-daemon/certs/$INSTANCE_NAME"
    )
    
    HOST_CERT_DIR=""
    HOST_CERT=""
    HOST_KEY=""
    
    echo "Looking for certificates in:"
    for CERT_DIR in "${POSSIBLE_CERT_DIRS[@]}"; do
        echo "  - $CERT_DIR"
        
        # Use sudo for /opt/n8n-daemon/, regular check for others
        if [[ "$CERT_DIR" == /opt/n8n-daemon/* ]] || [[ "$CERT_DIR" == /var/lib/n8n-daemon/* ]]; then
            if sudo test -d "$CERT_DIR"; then
                echo "  ✅ Directory exists"
                HOST_CERT_DIR="$CERT_DIR"
                # Find certificate files on host (with sudo) - need to group -o conditions
                HOST_CERT=$(sudo find "$CERT_DIR" \( -name "*.crt" -o -name "fullchain.pem" \) 2>/dev/null | head -1)
                HOST_KEY=$(sudo find "$CERT_DIR" \( -name "*.key" -o -name "privkey.pem" \) 2>/dev/null | head -1)
                
                echo "    Cert found: ${HOST_CERT:-none}"
                echo "    Key found: ${HOST_KEY:-none}"
                
                if [ -n "$HOST_CERT" ] && [ -n "$HOST_KEY" ]; then
                    echo "  ✅ Found certificates!"
                    break
                fi
            else
                echo "  ❌ Directory does not exist"
            fi
        else
            if [ -d "$CERT_DIR" ]; then
                echo "  ✅ Directory exists"
                HOST_CERT_DIR="$CERT_DIR"
                # Find certificate files on host - need to group -o conditions
                HOST_CERT=$(find "$CERT_DIR" \( -name "*.crt" -o -name "fullchain.pem" \) 2>/dev/null | head -1)
                HOST_KEY=$(find "$CERT_DIR" \( -name "*.key" -o -name "privkey.pem" \) 2>/dev/null | head -1)
                
                echo "    Cert found: ${HOST_CERT:-none}"
                echo "    Key found: ${HOST_KEY:-none}"
                
                if [ -n "$HOST_CERT" ] && [ -n "$HOST_KEY" ]; then
                    echo "  ✅ Found certificates!"
                    break
                fi
            else
                echo "  ❌ Directory does not exist"
            fi
        fi
    done
    echo ""
    
    if [ -n "$HOST_CERT_DIR" ] && [ -n "$HOST_CERT" ] && [ -n "$HOST_KEY" ]; then
        echo "Found certificates on host at: $HOST_CERT_DIR"
        echo "  Cert: $HOST_CERT"
        echo "  Key: $HOST_KEY"
        echo "Copying to container..."
        
        # Create SSL directory in container
        docker exec "$CONTAINER_NAME" mkdir -p /var/lib/postgresql/ssl
        
        # Copy certificates to container (use sudo if needed for /opt paths)
        if [[ "$HOST_CERT_DIR" == /opt/n8n-daemon/* ]] || [[ "$HOST_CERT_DIR" == /var/lib/n8n-daemon/* ]]; then
            # For system directories, we may need to use sudo to read, but docker cp should work
            sudo docker cp "$HOST_CERT" "$CONTAINER_NAME:/var/lib/postgresql/ssl/$(basename "$HOST_CERT")"
            sudo docker cp "$HOST_KEY" "$CONTAINER_NAME:/var/lib/postgresql/ssl/$(basename "$HOST_KEY")"
        else
            docker cp "$HOST_CERT" "$CONTAINER_NAME:/var/lib/postgresql/ssl/$(basename "$HOST_CERT")"
            docker cp "$HOST_KEY" "$CONTAINER_NAME:/var/lib/postgresql/ssl/$(basename "$HOST_KEY")"
        fi
        
        # Set permissions
        docker exec "$CONTAINER_NAME" chmod 600 /var/lib/postgresql/ssl/*.key
        docker exec "$CONTAINER_NAME" chmod 644 /var/lib/postgresql/ssl/*.crt /var/lib/postgresql/ssl/*.pem
        docker exec "$CONTAINER_NAME" chown -R postgres:postgres /var/lib/postgresql/ssl
        
        CERT_FILE="/var/lib/postgresql/ssl/$(basename "$HOST_CERT")"
        KEY_FILE="/var/lib/postgresql/ssl/$(basename "$HOST_KEY")"
        
        echo "✅ Certificates copied to container"
    else
        echo "❌ Certificate files not found on host"
        echo ""
        echo "Checked locations:"
        for CERT_DIR in "${POSSIBLE_CERT_DIRS[@]}"; do
            CERT_DIR=$(eval echo "$CERT_DIR")
            echo "  - $CERT_DIR"
        done
        echo ""
        echo "This container may have been created before SSL certificate mounting was implemented."
        echo ""
        echo "Options:"
        echo "1. Recreate the container (new containers will have SSL enabled automatically)"
        echo "2. Generate certificates using the daemon API, then run this script again"
        echo ""
        echo "To generate certificates, you can use the daemon API or create them manually:"
        echo "  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\"
        echo "    -keyout /tmp/server.key -out /tmp/server.crt \\"
        echo "    -subj \"/CN=$DOMAIN\""
        exit 1
    fi
fi

echo "Found certificates:"
echo "  Cert: $CERT_FILE"
echo "  Key: $KEY_FILE"
echo ""

# Check current SSL status
echo "Current SSL status:"
docker exec "$CONTAINER_NAME" psql -U postgres -c "SHOW ssl;" 2>/dev/null || echo "  Could not check SSL status"
echo ""

# Find postgresql.conf location
echo "Finding postgresql.conf location..."
PGDATA=$(docker exec "$CONTAINER_NAME" psql -U postgres -t -c "SHOW data_directory;" 2>/dev/null | tr -d ' \n\r' || echo "")

# Try to find postgresql.conf in the data directory or subdirectories
PG_CONF=""
if [ -n "$PGDATA" ]; then
    # Check if postgresql.conf is directly in PGDATA
    if docker exec "$CONTAINER_NAME" test -f "$PGDATA/postgresql.conf" 2>/dev/null; then
        PG_CONF="$PGDATA/postgresql.conf"
    else
        # Check subdirectories (like pgdata/)
        for SUBDIR in "pgdata" "data" ""; do
            TEST_PATH="$PGDATA"
            if [ -n "$SUBDIR" ]; then
                TEST_PATH="$PGDATA/$SUBDIR"
            fi
            if docker exec "$CONTAINER_NAME" test -f "$TEST_PATH/postgresql.conf" 2>/dev/null; then
                PG_CONF="$TEST_PATH/postgresql.conf"
                break
            fi
        done
    fi
fi

# If still not found, try common locations
if [ -z "$PG_CONF" ]; then
    for PGDATA_PATH in "/var/lib/postgresql/data/pgdata" "/var/lib/postgresql/data" "/var/lib/postgresql" "/data"; do
        if docker exec "$CONTAINER_NAME" test -f "$PGDATA_PATH/postgresql.conf" 2>/dev/null; then
            PG_CONF="$PGDATA_PATH/postgresql.conf"
            break
        fi
    done
fi

if [ -z "$PG_CONF" ]; then
    echo "⚠️  Could not find postgresql.conf automatically"
    echo "Searching for postgresql.conf..."
    PG_CONF=$(docker exec "$CONTAINER_NAME" find /var/lib/postgresql -name "postgresql.conf" 2>/dev/null | head -1)
    if [ -z "$PG_CONF" ]; then
        echo "❌ Could not locate postgresql.conf"
        exit 1
    fi
fi

echo "Using PostgreSQL config: $PG_CONF"
echo ""

# Enable SSL in postgresql.conf
echo "Enabling SSL in postgresql.conf..."
if docker exec "$CONTAINER_NAME" test -f "$PG_CONF" 2>/dev/null; then
    # Backup postgresql.conf
    docker exec "$CONTAINER_NAME" cp "$PG_CONF" "$PG_CONF.bak"
    
    # Check if SSL is already enabled
    if docker exec "$CONTAINER_NAME" grep -q '^ssl = on' "$PG_CONF" 2>/dev/null; then
        echo "⚠️  SSL already configured in postgresql.conf"
        # Update certificate paths if they're different
        docker exec "$CONTAINER_NAME" sed -i "s|ssl_cert_file =.*|ssl_cert_file = '$CERT_FILE'|" "$PG_CONF"
        docker exec "$CONTAINER_NAME" sed -i "s|ssl_key_file =.*|ssl_key_file = '$KEY_FILE'|" "$PG_CONF"
        echo "✅ Updated certificate paths"
    else
        # Add SSL configuration
        echo "" | docker exec -i "$CONTAINER_NAME" sh -c "cat >> '$PG_CONF'"
        echo "# SSL Configuration (enabled by enable-ssl script)" | docker exec -i "$CONTAINER_NAME" sh -c "cat >> '$PG_CONF'"
        echo "ssl = on" | docker exec -i "$CONTAINER_NAME" sh -c "cat >> '$PG_CONF'"
        echo "ssl_cert_file = '$CERT_FILE'" | docker exec -i "$CONTAINER_NAME" sh -c "cat >> '$PG_CONF'"
        echo "ssl_key_file = '$KEY_FILE'" | docker exec -i "$CONTAINER_NAME" sh -c "cat >> '$PG_CONF'"
        echo "ssl_min_protocol_version = 'TLSv1.2'" | docker exec -i "$CONTAINER_NAME" sh -c "cat >> '$PG_CONF'"
        echo "✅ SSL configuration added to postgresql.conf"
        
        # Verify it was added
        echo ""
        echo "Verifying SSL settings:"
        docker exec "$CONTAINER_NAME" grep -i "^ssl" "$PG_CONF" 2>/dev/null || echo "  ⚠️  SSL settings not found in config"
    fi
else
    echo "❌ postgresql.conf not found at $PG_CONF"
    exit 1
fi

# Reload PostgreSQL configuration
echo ""
echo "Reloading PostgreSQL configuration..."
docker exec "$CONTAINER_NAME" psql -U postgres -c "SELECT pg_reload_conf();" 2>/dev/null && echo "✅ Configuration reloaded" || echo "⚠️  Could not reload (restart may be required)"

echo ""
echo "=========================================="
echo "SSL Configuration Complete"
echo "=========================================="
echo ""
echo "⚠️  IMPORTANT: SSL changes require a container restart to take effect"
echo ""
echo "To restart the container:"
echo "  docker restart $CONTAINER_NAME"
echo ""
echo "After restart, verify SSL is enabled:"
echo "  docker exec $CONTAINER_NAME psql -U postgres -c 'SHOW ssl;'"
echo ""


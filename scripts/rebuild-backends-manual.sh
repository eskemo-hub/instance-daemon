#!/bin/bash

# Manual script to rebuild backends.json from HAProxy config
# Run this on the server

HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
BACKENDS_FILE="/opt/n8n-daemon/haproxy/backends.json"

if [ ! -f "$HAPROXY_CONFIG" ]; then
    echo "❌ HAProxy config not found at $HAPROXY_CONFIG"
    exit 1
fi

echo "Rebuilding backends.json from HAProxy config..."
echo ""

# Create temporary file for JSON
TEMP_FILE=$(mktemp)

# Start JSON object
echo "{" > "$TEMP_FILE"

# Extract PostgreSQL backends
FIRST=true
sudo grep -E "^backend postgres_" "$HAPROXY_CONFIG" | while read backend_line; do
    BACKEND_NAME=$(echo "$backend_line" | awk '{print $2}')
    
    # Get the server line
    SERVER_LINE=$(sudo grep -A 3 "backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "server" | head -1)
    INSTANCE_NAME=$(echo "$SERVER_LINE" | awk '{print $2}')
    PORT=$(echo "$SERVER_LINE" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
    
    # Get domain from use_backend line
    DOMAIN=$(sudo grep -B 10 "backend $BACKEND_NAME" "$HAPROXY_CONFIG" | grep "use_backend.*$BACKEND_NAME" | grep -o "[0-9]*-[a-z0-9]*\.[a-z.]*" | head -1)
    
    if [ -n "$INSTANCE_NAME" ] && [ -n "$PORT" ] && [ -n "$DOMAIN" ]; then
        if [ "$FIRST" = false ]; then
            echo "," >> "$TEMP_FILE"
        fi
        FIRST=false
        
        echo "  \"$INSTANCE_NAME\": {" >> "$TEMP_FILE"
        echo "    \"instanceName\": \"$INSTANCE_NAME\"," >> "$TEMP_FILE"
        echo "    \"domain\": \"$DOMAIN\"," >> "$TEMP_FILE"
        echo "    \"port\": $PORT," >> "$TEMP_FILE"
        echo "    \"dbType\": \"postgres\"" >> "$TEMP_FILE"
        echo -n "  }" >> "$TEMP_FILE"
        
        echo "Found: $INSTANCE_NAME -> $DOMAIN : $PORT"
    fi
done

# Close JSON object
echo "" >> "$TEMP_FILE"
echo "}" >> "$TEMP_FILE"

# Validate JSON
if jq empty "$TEMP_FILE" 2>/dev/null; then
    # Ensure directory exists
    sudo mkdir -p "$(dirname "$BACKENDS_FILE")"
    
    # Copy to final location
    sudo cp "$TEMP_FILE" "$BACKENDS_FILE"
    sudo chmod 664 "$BACKENDS_FILE"
    
    echo ""
    echo "✅ Rebuilt backends.json successfully!"
    echo "   File: $BACKENDS_FILE"
    echo ""
    echo "Contents:"
    sudo cat "$BACKENDS_FILE" | jq '.'
else
    echo "❌ Generated invalid JSON"
    cat "$TEMP_FILE"
    rm "$TEMP_FILE"
    exit 1
fi

rm "$TEMP_FILE"


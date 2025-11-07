#!/bin/bash
# Diagnostic script for database connection issues

echo "=== Database Connection Diagnostics ==="
echo ""

# Get domain from user
read -p "Enter your database domain (e.g., 36-cmhmoqju.hostinau.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "Error: Domain is required"
    exit 1
fi

echo ""
echo "1. Checking DNS resolution..."
nslookup $DOMAIN || echo "❌ DNS lookup failed"

echo ""
echo "2. Checking HAProxy status..."
sudo systemctl status haproxy --no-pager | head -10

echo ""
echo "3. Checking HAProxy configuration..."
sudo haproxy -c -f /opt/n8n-daemon/haproxy/haproxy.cfg 2>&1 | tail -20

echo ""
echo "4. Checking if HAProxy is listening on port 5432..."
sudo ss -tlnp | grep ":5432" || echo "❌ HAProxy not listening on 5432"

echo ""
echo "5. Checking HAProxy logs (last 20 lines)..."
sudo journalctl -u haproxy -n 20 --no-pager | tail -20

echo ""
echo "6. Checking certificate for domain..."
INSTANCE_NAME=$(sudo grep -r "$DOMAIN" /opt/n8n-daemon/haproxy/haproxy.cfg | grep -o "postgres_[^ ]*" | head -1 | sed 's/postgres_//')
if [ -n "$INSTANCE_NAME" ]; then
    CERT_PATH="/opt/n8n-daemon/haproxy/certs/${INSTANCE_NAME}.pem"
    if [ -f "$CERT_PATH" ]; then
        echo "✅ Certificate found: $CERT_PATH"
        echo "Certificate details:"
        sudo openssl x509 -in "$CERT_PATH" -text -noout | grep -E "Subject:|Issuer:|Not Before|Not After" | head -4
    else
        echo "❌ Certificate not found: $CERT_PATH"
    fi
else
    echo "⚠️  Could not determine instance name from config"
fi

echo ""
echo "7. Testing backend connectivity..."
BACKEND_PORT=$(sudo grep -A 5 "backend.*$INSTANCE_NAME" /opt/n8n-daemon/haproxy/haproxy.cfg | grep "127.0.0.1" | grep -o "127.0.0.1:[0-9]*" | cut -d: -f2)
if [ -n "$BACKEND_PORT" ]; then
    echo "Backend port: $BACKEND_PORT"
    timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$BACKEND_PORT" && echo "✅ Backend is accessible" || echo "❌ Backend is NOT accessible"
else
    echo "⚠️  Could not determine backend port"
fi

echo ""
echo "8. Testing TLS connection to HAProxy..."
echo "Connecting to $DOMAIN:5432 with TLS..."
timeout 5 openssl s_client -connect $DOMAIN:5432 -servername $DOMAIN </dev/null 2>&1 | head -20 || echo "❌ TLS connection failed"

echo ""
echo "=== Diagnostic Complete ==="
echo ""
echo "Common issues and solutions:"
echo "1. If certificate is self-signed, use: sslmode=prefer or sslmode=allow"
echo "2. If backend is not accessible, check container status: docker ps | grep postgres"
echo "3. If SNI doesn't match, ensure domain in connection string matches exactly"
echo "4. Check HAProxy logs for detailed errors: sudo journalctl -u haproxy -f"


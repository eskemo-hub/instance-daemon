#!/bin/bash

# HAProxy Routing Debug Script
# Shows what connections are being routed where

echo "=========================================="
echo "HAProxy Routing Debug"
echo "=========================================="
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Some commands need sudo privileges"
    echo ""
fi

echo "1. HAProxy Real-Time Logs"
echo "-----------------------------------"
echo "Viewing HAProxy logs (last 50 lines, then follow)..."
echo "Press Ctrl+C to stop"
echo ""
sudo journalctl -u haproxy -n 50 --no-pager
echo ""
echo "To follow logs in real-time:"
echo "  sudo journalctl -u haproxy -f"
echo ""

echo "2. HAProxy Stats Page"
echo "-----------------------------------"
echo "HAProxy stats are available at:"
echo "  http://localhost:8404/stats"
echo ""
echo "Or view via command line:"
echo "  echo 'show stat' | sudo socat stdio /run/haproxy/admin.sock"
echo ""
if command -v socat &> /dev/null; then
    echo "Current stats:"
    echo "show stat" | sudo socat stdio /run/haproxy/admin.sock 2>/dev/null | head -20 || echo "  (Stats socket not available)"
else
    echo "  Install socat to view stats: sudo apt-get install socat"
fi
echo ""

echo "3. HAProxy Configuration - Routing Rules"
echo "-----------------------------------"
HAPROXY_CONFIG="/opt/n8n-daemon/haproxy/haproxy.cfg"
if [ ! -f "$HAPROXY_CONFIG" ]; then
    HAPROXY_CONFIG="/etc/haproxy/haproxy.cfg"
fi

if [ -f "$HAPROXY_CONFIG" ]; then
    echo "Frontend routing rules (port 5432):"
    sudo grep -A 20 "frontend postgres_frontend" "$HAPROXY_CONFIG" | grep -E "(use_backend|default_backend|bind)" | head -15
    echo ""
    echo "Backend servers:"
    sudo grep -B 2 -A 1 "^backend postgres_" "$HAPROXY_CONFIG" | grep -E "(^backend|server)" | head -20
else
    echo "❌ HAProxy config not found"
fi
echo ""

echo "4. Test Connection Routing"
echo "-----------------------------------"
read -p "Enter domain to test (e.g., 50-cmhmoqju.hostinau.com) or press Enter to skip: " TEST_DOMAIN

if [ -n "$TEST_DOMAIN" ]; then
    echo ""
    echo "Testing connection to $TEST_DOMAIN:5432..."
    
    # Get expected backend port
    BACKEND_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$TEST_DOMAIN\") | .port" 2>/dev/null)
    
    if [ -n "$BACKEND_PORT" ] && [ "$BACKEND_PORT" != "null" ]; then
        echo "Expected backend port: $BACKEND_PORT"
        echo ""
        echo "Testing direct connection to backend..."
        if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$BACKEND_PORT" 2>/dev/null; then
            echo "✅ Backend port $BACKEND_PORT is accessible"
        else
            echo "❌ Backend port $BACKEND_PORT is NOT accessible"
        fi
        
        echo ""
        echo "Testing HAProxy routing..."
        echo "Run this command to test:"
        echo "  psql -h $TEST_DOMAIN -p 5432 -U postgres -d postgres"
        echo ""
        echo "Or with TLS:"
        echo "  psql 'postgresql://postgres:password@$TEST_DOMAIN:5432/postgres?sslmode=require'"
    else
        echo "❌ Domain not found in backends.json"
    fi
fi
echo ""

echo "5. Active Connections"
echo "-----------------------------------"
echo "Current connections to port 5432:"
sudo ss -tnp | grep ":5432" | head -10
echo ""

echo "6. HAProxy Process Info"
echo "-----------------------------------"
if pgrep -x haproxy > /dev/null; then
    echo "✅ HAProxy is running"
    ps aux | grep haproxy | grep -v grep | head -3
else
    echo "❌ HAProxy is NOT running"
fi
echo ""

echo "7. Check Backends Configuration"
echo "-----------------------------------"
BACKENDS_FILE="/opt/n8n-daemon/haproxy/backends.json"
if [ -f "$BACKENDS_FILE" ]; then
    echo "All configured backends:"
    sudo cat "$BACKENDS_FILE" | jq -r 'to_entries[] | "\(.key): \(.value.domain) → 127.0.0.1:\(.value.port)"' 2>/dev/null || sudo cat "$BACKENDS_FILE"
else
    echo "❌ Backends file not found"
fi
echo ""

echo "8. Monitor Connections in Real-Time"
echo "-----------------------------------"
echo "To monitor connections in real-time, run:"
echo "  watch -n 1 'sudo ss -tnp | grep :5432'"
echo ""
echo "Or follow HAProxy logs:"
echo "  sudo journalctl -u haproxy -f"
echo ""

echo "=========================================="
echo "Quick Commands"
echo "=========================================="
echo ""
echo "View HAProxy logs:"
echo "  sudo journalctl -u haproxy -n 100"
echo ""
echo "Follow HAProxy logs:"
echo "  sudo journalctl -u haproxy -f"
echo ""
echo "Check HAProxy config:"
echo "  sudo haproxy -c -f /opt/n8n-daemon/haproxy/haproxy.cfg"
echo ""
echo "Reload HAProxy:"
echo "  sudo systemctl reload haproxy"
echo ""
echo "View stats page:"
echo "  curl http://localhost:8404/stats"
echo ""


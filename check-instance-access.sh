#!/bin/bash

# Instance Access Troubleshooting Script

echo "=== n8n Instance Access Check ==="
echo ""

# Check containers
echo "1. Running Containers:"
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
echo ""

# Check if ports are listening
echo "2. Listening Ports:"
netstat -tulpn | grep -E ":(5678|5679)" || echo "No ports 5678/5679 listening"
echo ""

# Test local access
echo "3. Local Access Test:"
for port in 5678 5679; do
    echo -n "Port $port: "
    curl -s -o /dev/null -w "%{http_code}" http://localhost:$port || echo "Failed"
done
echo ""

# Check firewall
echo "4. Firewall Status:"
if command -v ufw &> /dev/null; then
    ufw status | grep -E "(5678|5679|Status)"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --list-ports
else
    echo "No firewall detected (ufw/firewalld)"
fi
echo ""

# Check if accessible from outside
echo "5. Server IP Addresses:"
ip addr show | grep "inet " | grep -v "127.0.0.1"
echo ""

# Check container logs for errors
echo "6. Recent Container Logs:"
for container in $(docker ps --format "{{.Names}}" | grep n8n); do
    echo "--- $container ---"
    docker logs --tail 5 $container 2>&1
    echo ""
done

echo "=== Troubleshooting Tips ==="
echo ""
echo "If you can't access from browser:"
echo "1. Check firewall: sudo ufw allow 5678"
echo "2. Check if port is open: telnet <server-ip> 5678"
echo "3. Check container logs: docker logs <container-name>"
echo "4. Test locally first: curl http://localhost:5678"
echo "5. Check if using correct IP (not 127.0.0.1)"
echo ""

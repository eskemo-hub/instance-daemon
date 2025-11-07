# Database Routing Diagnostic Commands

Run these commands on your remote server to check if HAProxy is routing correctly.

## Quick Check Commands

### 1. Check HAProxy Configuration

```bash
# Check if HAProxy config exists and find your domain
sudo cat /opt/n8n-daemon/haproxy/haproxy.cfg | grep -A 10 "36-cmhmoqju.hostinau.com"

# Or if config is in default location
sudo cat /etc/haproxy/haproxy.cfg | grep -A 10 "36-cmhmoqju.hostinau.com"

# Check all PostgreSQL backends
sudo grep -B 2 -A 3 "backend postgres_" /opt/n8n-daemon/haproxy/haproxy.cfg | grep -A 3 "server"
```

### 2. Check Backends JSON File

```bash
# View all configured backends
sudo cat /opt/n8n-daemon/haproxy/backends.json | jq '.'

# Or if jq is not installed
sudo cat /opt/n8n-daemon/haproxy/backends.json

# Check specific domain
sudo cat /opt/n8n-daemon/haproxy/backends.json | jq '.[] | select(.domain == "36-cmhmoqju.hostinau.com")'
```

### 3. Check Running Containers

```bash
# Find PostgreSQL containers
docker ps | grep -i postgres

# Find container by subdomain (36)
docker ps | grep "36"

# Get detailed port binding for a specific container
# Replace CONTAINER_NAME with your actual container name
docker inspect CONTAINER_NAME | jq '.[0].HostConfig.PortBindings'

# Or see port bindings in readable format
docker inspect CONTAINER_NAME --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} -> {{(index $conf 0).HostIp}}:{{(index $conf 0).HostPort}}{{println}}{{end}}'
```

### 4. Check What Ports Are Listening

```bash
# Check if port is listening on 127.0.0.1 (required for HAProxy)
sudo ss -tlnp | grep "127.0.0.1" | grep -E ":(5432|3306)"

# Check all listening ports
sudo netstat -tlnp | grep -E ":(5432|3306)" | head -10

# Or using ss
sudo ss -tlnp | grep -E ":(5432|3306)"
```

### 5. Verify HAProxy Can Reach Container

```bash
# First, find the port from backends.json
BACKEND_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json | jq -r '.[] | select(.domain == "36-cmhmoqju.hostinau.com") | .port')

echo "HAProxy expects port: $BACKEND_PORT"

# Test if that port is accessible on localhost
timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$BACKEND_PORT" && echo "✅ Port $BACKEND_PORT is accessible" || echo "❌ Port $BACKEND_PORT is NOT accessible"

# Check if PostgreSQL is responding on that port
PGPASSWORD="test" timeout 3 psql -h 127.0.0.1 -p "$BACKEND_PORT" -U postgres -c "SELECT 1;" 2>&1 | head -3
```

### 6. Check HAProxy Status

```bash
# Check if HAProxy is running
sudo systemctl status haproxy

# Check HAProxy logs for errors
sudo journalctl -u haproxy -n 50 --no-pager | grep -i error

# View recent HAProxy logs
sudo journalctl -u haproxy -n 100 --no-pager
```

### 7. Compare Container Port vs HAProxy Config

```bash
# Get container name (adjust grep pattern as needed)
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep "36" | head -1)
echo "Container: $CONTAINER_NAME"

# Get container's actual port binding
CONTAINER_PORT=$(docker inspect "$CONTAINER_NAME" | jq -r '.[0].HostConfig.PortBindings | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort')
echo "Container bound to port: $CONTAINER_PORT"

# Get HAProxy expected port
HAPROXY_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json | jq -r '.[] | select(.domain == "36-cmhmoqju.hostinau.com") | .port')
echo "HAProxy expects port: $HAPROXY_PORT"

# Compare
if [ "$CONTAINER_PORT" == "$HAPROXY_PORT" ]; then
    echo "✅ Ports match!"
else
    echo "❌ MISMATCH! Container is on $CONTAINER_PORT but HAProxy expects $HAPROXY_PORT"
fi
```

## Complete Diagnostic Script

Run this all-in-one check:

```bash
DOMAIN="36-cmhmoqju.hostinau.com"

echo "=== Checking HAProxy Backend ==="
HAPROXY_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[] | select(.domain == \"$DOMAIN\") | .port" 2>/dev/null)
if [ -n "$HAPROXY_PORT" ]; then
    echo "HAProxy backend port: $HAPROXY_PORT"
else
    echo "❌ Domain not found in HAProxy backends"
    exit 1
fi

echo ""
echo "=== Checking Container ==="
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep "36" | head -1)
if [ -z "$CONTAINER_NAME" ]; then
    echo "❌ No container found matching '36'"
    exit 1
fi
echo "Container: $CONTAINER_NAME"

CONTAINER_PORT=$(docker inspect "$CONTAINER_NAME" 2>/dev/null | jq -r '.[0].HostConfig.PortBindings | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort' 2>/dev/null)
if [ -z "$CONTAINER_PORT" ]; then
    echo "❌ Could not determine container port"
    exit 1
fi
echo "Container port: $CONTAINER_PORT"

echo ""
echo "=== Port Comparison ==="
if [ "$CONTAINER_PORT" == "$HAPROXY_PORT" ]; then
    echo "✅ Ports match: $CONTAINER_PORT"
else
    echo "❌ MISMATCH: Container=$CONTAINER_PORT, HAProxy=$HAPROXY_PORT"
    echo "This is the problem! HAProxy is routing to the wrong port."
fi

echo ""
echo "=== Testing Connectivity ==="
if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/$HAPROXY_PORT" 2>/dev/null; then
    echo "✅ Port $HAPROXY_PORT is accessible on 127.0.0.1"
else
    echo "❌ Port $HAPROXY_PORT is NOT accessible on 127.0.0.1"
    echo "HAProxy cannot reach the container!"
fi
```

## Fix Commands

If ports don't match, you need to regenerate HAProxy config:

```bash
# Option 1: Use the daemon API (if you have API key)
curl -X POST http://localhost:3001/api/haproxy/regenerate \
  -H "X-API-Key: YOUR_API_KEY"

# Option 2: Use the regenerate script
cd /path/to/daemon
node scripts/regenerate-haproxy.js

# Option 3: Manually check and update backends.json
# Edit the port in backends.json to match container port, then regenerate
sudo nano /opt/n8n-daemon/haproxy/backends.json
# After editing, regenerate:
cd /path/to/daemon
node scripts/regenerate-haproxy.js
```

## Check HAProxy Stats Page

```bash
# HAProxy has a stats page on port 8404
# View in browser: http://YOUR_SERVER_IP:8404/stats
# Or via command line:
curl http://localhost:8404/stats 2>/dev/null | grep -E "postgres|BACKEND" | head -20
```


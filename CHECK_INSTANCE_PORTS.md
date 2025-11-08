# How to Check Instance Port and HAProxy Routing

## Quick Check Methods

### 1. Check All Backends (API)

```bash
# Get all HAProxy backends with their ports
curl -X GET http://localhost:3001/api/haproxy/backends \
  -H "X-API-Key: YOUR_API_KEY" | jq '.'
```

This shows:
- `instanceName`: Container name
- `domain`: Full domain (e.g., `mydb.example.com`)
- `port`: Container's internal port (e.g., `35001`) - this is what HAProxy routes to
- `dbType`: Database type (postgres, mysql, mongodb)

### 2. Check Specific Instance by Domain

```bash
# Replace DOMAIN with your instance's domain
curl -X GET "http://localhost:3001/api/haproxy/backends/mydb.example.com" \
  -H "X-API-Key: YOUR_API_KEY" | jq '.'
```

### 3. Validate All Mappings (Best for Debugging)

```bash
# This checks actual container ports vs HAProxy configuration
curl -X GET http://localhost:3001/api/haproxy/validate-mappings \
  -H "X-API-Key: YOUR_API_KEY" | jq '.'
```

This returns:
- `valid`: Number of correct mappings
- `invalid`: Number of mismatched ports
- `missing`: Number of containers not found
- `mappings`: Array with details for each instance showing:
  - `instanceName`
  - `domain`
  - `expectedPort`: Port in HAProxy config
  - `actualPort`: Actual container port from Docker
  - `status`: `valid`, `invalid`, or `missing`
  - `routing`: Full routing path (e.g., `mydb.example.com:5432 → HAProxy (SNI) → 127.0.0.1:35001`)

### 4. Verify and Fix Ports

```bash
# This will automatically fix any port mismatches
curl -X POST http://localhost:3001/api/haproxy/verify-ports \
  -H "X-API-Key: YOUR_API_KEY" | jq '.'
```

---

## Command Line Methods

### 1. Check Container Port Directly

```bash
# Find your container (replace INSTANCE_NAME with your container name)
CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep "INSTANCE_NAME" | head -1)

# Get the actual bound port
docker inspect "$CONTAINER_NAME" | jq '.[0].NetworkSettings.Ports | to_entries[] | select(.key | contains("5432")) | {internal: .key, hostPort: .value[0].HostPort}'
```

Or in a more readable format:
```bash
docker inspect "$CONTAINER_NAME" --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} -> {{(index $conf 0).HostIp}}:{{(index $conf 0).HostPort}}{{println}}{{end}}'
```

### 2. Check HAProxy Backends File

```bash
# View all backends
sudo cat /opt/n8n-daemon/haproxy/backends.json | jq '.'

# Check specific instance by domain
sudo cat /opt/n8n-daemon/haproxy/backends.json | jq '.[] | select(.domain == "mydb.example.com")'
```

### 3. Check HAProxy Config

```bash
# Find your domain in HAProxy config
sudo grep -A 10 "mydb.example.com" /opt/n8n-daemon/haproxy/haproxy.cfg

# Or check the backend section
sudo grep -B 5 -A 5 "backend postgres_YOUR_INSTANCE" /opt/n8n-daemon/haproxy/haproxy.cfg
```

### 4. Use the Diagnostic Script

```bash
# Run the HAProxy routing diagnostic script
bash /path/to/n8n-daemon-repo/scripts/check-haproxy-routing.sh
```

---

## Understanding the Output

### Example API Response

```json
{
  "success": true,
  "backends": {
    "my-instance-123": {
      "instanceName": "my-instance-123",
      "domain": "mydb.example.com",
      "port": 35001,
      "dbType": "postgres"
    }
  }
}
```

**What this means:**
- **External port**: Always `5432` (users connect to `mydb.example.com:5432`)
- **Internal port**: `35001` (container's actual bound port)
- **HAProxy routing**: `mydb.example.com:5432 → HAProxy (SNI) → 127.0.0.1:35001`

### Example Validation Response

```json
{
  "success": true,
  "summary": {
    "total": 1,
    "valid": 1,
    "invalid": 0,
    "missing": 0
  },
  "mappings": [
    {
      "instanceName": "my-instance-123",
      "domain": "mydb.example.com",
      "expectedPort": 35001,
      "actualPort": 35001,
      "status": "valid",
      "routing": "mydb.example.com:5432 → HAProxy (SNI) → 127.0.0.1:35001"
    }
  ]
}
```

**Status meanings:**
- `valid`: Container port matches HAProxy config ✅
- `invalid`: Container port doesn't match HAProxy config ❌ (run `/api/haproxy/verify-ports` to fix)
- `missing`: Container not found (may not be running)

---

## Quick One-Liner to Check Specific Instance

Replace `INSTANCE_NAME` with your container name:

```bash
# Get container port
CONTAINER_PORT=$(docker inspect INSTANCE_NAME 2>/dev/null | jq -r '.[0].NetworkSettings.Ports | to_entries[] | select(.key | contains("5432")) | .value[0].HostPort')

# Get HAProxy port
HAPROXY_PORT=$(sudo cat /opt/n8n-daemon/haproxy/backends.json 2>/dev/null | jq -r ".[\"INSTANCE_NAME\"].port")

# Compare
echo "Container port: $CONTAINER_PORT"
echo "HAProxy port: $HAPROXY_PORT"
if [ "$CONTAINER_PORT" == "$HAPROXY_PORT" ]; then
  echo "✅ Ports match!"
else
  echo "❌ MISMATCH - Run: curl -X POST http://localhost:3001/api/haproxy/verify-ports -H 'X-API-Key: YOUR_KEY'"
fi
```

---

## Troubleshooting

### If ports don't match:

1. **Auto-fix**: Run the verify-ports endpoint:
   ```bash
   curl -X POST http://localhost:3001/api/haproxy/verify-ports \
     -H "X-API-Key: YOUR_API_KEY"
   ```

2. **Manual check**: Verify the container is running:
   ```bash
   docker ps | grep YOUR_INSTANCE_NAME
   ```

3. **Regenerate HAProxy config**:
   ```bash
   curl -X POST http://localhost:3001/api/haproxy/regenerate \
     -H "X-API-Key: YOUR_API_KEY"
   ```

### If instance not found in HAProxy:

- Check if `publicAccess` is enabled for the database
- Check if the instance has a domain configured
- Verify the instance was created with `useTraefik: true`


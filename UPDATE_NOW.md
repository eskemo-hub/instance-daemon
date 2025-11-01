# Update Daemon Right Now

## Quick Update (Copy & Paste)

Run this on your server as root:

```bash
cd /opt/n8n-daemon/daemon && \
systemctl stop n8n-daemon && \
git fetch origin && \
git reset --hard origin/main && \
npm install --production && \
npm run build && \
systemctl start n8n-daemon && \
sleep 2 && \
systemctl status n8n-daemon
```

## Step by Step

If you prefer to see each step:

```bash
# 1. Go to daemon directory
cd /opt/n8n-daemon/daemon

# 2. Stop daemon
systemctl stop n8n-daemon

# 3. Pull latest code
git fetch origin
git reset --hard origin/main

# 4. Install dependencies
npm install --production

# 5. Build
npm run build

# 6. Start daemon
systemctl start n8n-daemon

# 7. Check status
systemctl status n8n-daemon
```

## Using the Quick Update Script

```bash
cd /opt/n8n-daemon/daemon
chmod +x quick-update.sh
./quick-update.sh
```

## Check if Update Worked

```bash
# Check service status
systemctl status n8n-daemon

# Check API health
curl http://localhost:3001/api/health

# View logs
journalctl -u n8n-daemon -n 20
```

## If Build Hangs

Press `Ctrl+C` and run:

```bash
# Kill stuck processes
pkill -9 node

# Clean and rebuild
cd /opt/n8n-daemon/daemon
rm -rf dist
npm run build
```

## Rollback if Needed

```bash
# Stop daemon
systemctl stop n8n-daemon

# Go back to previous commit
cd /opt/n8n-daemon/daemon
git reset --hard HEAD~1

# Rebuild
npm run build

# Start
systemctl start n8n-daemon
```

## What Gets Updated

- ✅ New API endpoints (stats, backup, etc.)
- ✅ Bug fixes
- ✅ Performance improvements
- ✅ New features
- ❌ Your instances (not affected)
- ❌ Your data (preserved)
- ❌ Your configuration (.env file)

## Downtime

- **Expected**: 10-30 seconds
- **Build time**: 1-2 minutes
- **Total**: 3-5 minutes

## After Update

New features available:
- Real-time container stats (CPU, memory, network, disk)
- Enhanced backup system
- Improved error handling
- Better logging

Test the new stats endpoint:
```bash
# Get stats for a container
curl -X POST http://localhost:3001/api/stats/container \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"containerId": "your-container-id"}'
```

## Troubleshooting

**Build fails?**
```bash
cd /opt/n8n-daemon/daemon
rm -rf node_modules dist
npm install
npm run build
```

**Service won't start?**
```bash
journalctl -u n8n-daemon -n 50
```

**Port in use?**
```bash
netstat -tulpn | grep 3001
kill -9 <PID>
systemctl start n8n-daemon
```

---

**Need help?** See `TROUBLESHOOTING.md` for detailed solutions.

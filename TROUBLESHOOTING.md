# Daemon Troubleshooting Guide

## Update/Build Issues

### Build Hangs or Takes Too Long

**Symptoms**: `npm run build` hangs or takes more than 5 minutes

**Solutions**:

1. **Check if build is actually running**:
   ```bash
   # Check CPU usage
   top
   # Look for node/tsc processes
   
   # Check if TypeScript compiler is running
   ps aux | grep tsc
   ```

2. **Kill stuck build and retry**:
   ```bash
   # Kill any stuck node processes
   pkill -9 node
   
   # Clean and rebuild
   cd /opt/n8n-daemon/daemon
   rm -rf dist node_modules
   npm install
   npm run build
   ```

3. **Build with verbose output**:
   ```bash
   npm run build -- --verbose
   ```

4. **Check disk space**:
   ```bash
   df -h
   # If low, clean up
   apt-get clean
   docker system prune -a
   ```

5. **Check memory**:
   ```bash
   free -h
   # If low, add swap or upgrade server
   ```

### Dependencies Installation Fails

**Symptoms**: `npm install` fails or hangs

**Solutions**:

1. **Clear npm cache**:
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Use different registry**:
   ```bash
   npm install --registry=https://registry.npmjs.org/
   ```

3. **Install with legacy peer deps**:
   ```bash
   npm install --legacy-peer-deps
   ```

4. **Check Node version**:
   ```bash
   node --version
   # Should be v18.x or v20.x
   
   # Update if needed
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt-get install -y nodejs
   ```

### Git Pull Fails

**Symptoms**: Cannot pull latest changes

**Solutions**:

1. **Reset to clean state**:
   ```bash
   cd /opt/n8n-daemon/daemon
   git stash
   git reset --hard HEAD
   git clean -fd
   git pull origin main
   ```

2. **Check remote URL**:
   ```bash
   git remote -v
   # Should show GitHub URL
   
   # Fix if needed
   git remote set-url origin https://github.com/eskemo-hub/n8n-instance-manager.git
   ```

3. **Check GitHub token**:
   ```bash
   echo $GITHUB_TOKEN
   # Should show token
   
   # Set if missing
   export GITHUB_TOKEN=your_token_here
   ```

## Service Issues

### Daemon Won't Start

**Symptoms**: `systemctl start n8n-daemon` fails

**Solutions**:

1. **Check logs**:
   ```bash
   journalctl -u n8n-daemon -n 50
   ```

2. **Check if port is in use**:
   ```bash
   netstat -tulpn | grep 3001
   # If in use, kill the process
   kill -9 <PID>
   ```

3. **Check permissions**:
   ```bash
   ls -la /opt/n8n-daemon
   # Should be owned by n8n-daemon user
   
   # Fix if needed
   chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon
   ```

4. **Check environment file**:
   ```bash
   cat /opt/n8n-daemon/.env
   # Should have API_KEY and other vars
   
   # Create if missing
   cp /opt/n8n-daemon/.env.example /opt/n8n-daemon/.env
   nano /opt/n8n-daemon/.env
   ```

5. **Test manual start**:
   ```bash
   cd /opt/n8n-daemon
   sudo -u n8n-daemon node dist/index.js
   # Check for errors
   ```

### Daemon Crashes Repeatedly

**Symptoms**: Daemon starts but crashes immediately

**Solutions**:

1. **Check for missing dependencies**:
   ```bash
   cd /opt/n8n-daemon/daemon
   npm install
   ```

2. **Check Docker socket**:
   ```bash
   ls -la /var/run/docker.sock
   # Should be accessible
   
   # Add user to docker group
   usermod -aG docker n8n-daemon
   ```

3. **Check for syntax errors**:
   ```bash
   cd /opt/n8n-daemon/daemon
   npm run build
   # Look for TypeScript errors
   ```

4. **Check environment variables**:
   ```bash
   systemctl cat n8n-daemon
   # Verify EnvironmentFile path
   
   cat /opt/n8n-daemon/.env
   # Verify all required vars are set
   ```

## Quick Fixes

### Complete Reset

If all else fails, completely reset the daemon:

```bash
# Stop daemon
systemctl stop n8n-daemon

# Backup data (if needed)
cp -r /opt/n8n-daemon /opt/n8n-daemon.backup

# Remove everything
rm -rf /opt/n8n-daemon

# Reinstall
cd /opt
git clone https://github.com/eskemo-hub/n8n-instance-manager.git n8n-daemon
cd n8n-daemon/daemon
cp .env.example .env
nano .env  # Set your API_KEY

# Install and build
npm install
npm run build

# Fix permissions
chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon

# Start
systemctl start n8n-daemon
```

### Manual Update (Step by Step)

If automated scripts fail, update manually:

```bash
# 1. Stop daemon
sudo systemctl stop n8n-daemon

# 2. Backup
sudo cp -r /opt/n8n-daemon /opt/n8n-daemon.backup.$(date +%Y%m%d_%H%M%S)

# 3. Pull code
cd /opt/n8n-daemon/daemon
sudo -u n8n-daemon git fetch origin
sudo -u n8n-daemon git reset --hard origin/main

# 4. Install dependencies
sudo -u n8n-daemon npm install --production

# 5. Build
sudo -u n8n-daemon npm run build

# 6. Start
sudo systemctl start n8n-daemon

# 7. Check status
sudo systemctl status n8n-daemon
```

### Force Rebuild

If build seems stuck:

```bash
# Kill any node processes
pkill -9 node

# Clean everything
cd /opt/n8n-daemon/daemon
rm -rf dist node_modules package-lock.json

# Reinstall
npm install

# Build with output
npm run build

# Should see TypeScript compilation progress
```

## Common Error Messages

### "Cannot find module"

```bash
# Missing dependency
cd /opt/n8n-daemon/daemon
npm install
```

### "EACCES: permission denied"

```bash
# Fix permissions
chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon
```

### "Port 3001 already in use"

```bash
# Find and kill process
netstat -tulpn | grep 3001
kill -9 <PID>
```

### "Cannot connect to Docker daemon"

```bash
# Check Docker is running
systemctl status docker

# Add user to docker group
usermod -aG docker n8n-daemon

# Restart daemon
systemctl restart n8n-daemon
```

### "Git pull failed"

```bash
# Reset git state
cd /opt/n8n-daemon/daemon
git reset --hard HEAD
git clean -fd
git pull origin main
```

## Health Checks

### Quick Health Check

```bash
# Check service
systemctl status n8n-daemon

# Check API
curl http://localhost:3001/api/health

# Check logs
journalctl -u n8n-daemon -n 20

# Check processes
ps aux | grep node

# Check ports
netstat -tulpn | grep 3001
```

### Detailed Health Check

```bash
#!/bin/bash
echo "=== Daemon Health Check ==="
echo ""

echo "1. Service Status:"
systemctl is-active n8n-daemon && echo "✓ Running" || echo "✗ Not running"
echo ""

echo "2. API Health:"
curl -s http://localhost:3001/api/health | jq . || echo "✗ API not responding"
echo ""

echo "3. Docker Access:"
sudo -u n8n-daemon docker ps > /dev/null 2>&1 && echo "✓ Docker accessible" || echo "✗ Docker not accessible"
echo ""

echo "4. Disk Space:"
df -h /opt | tail -1
echo ""

echo "5. Memory:"
free -h | grep Mem
echo ""

echo "6. Recent Logs:"
journalctl -u n8n-daemon -n 5 --no-pager
echo ""

echo "7. Process Info:"
ps aux | grep "node.*daemon" | grep -v grep
echo ""
```

## Getting Help

If you're still stuck:

1. **Collect information**:
   ```bash
   # Save logs
   journalctl -u n8n-daemon -n 200 > daemon-logs.txt
   
   # Save system info
   uname -a > system-info.txt
   node --version >> system-info.txt
   npm --version >> system-info.txt
   docker --version >> system-info.txt
   
   # Save service status
   systemctl status n8n-daemon > service-status.txt
   ```

2. **Check GitHub issues**: Look for similar problems

3. **Create new issue**: Include logs and system info

## Prevention

### Regular Maintenance

```bash
# Weekly: Check logs for errors
journalctl -u n8n-daemon --since "1 week ago" | grep -i error

# Monthly: Clean up old backups
find /opt/n8n-daemon-backups -mtime +30 -delete

# Monthly: Update system packages
apt-get update && apt-get upgrade -y

# Quarterly: Review and optimize
docker system prune -a
npm cache clean --force
```

### Monitoring

Set up monitoring to catch issues early:

```bash
# Add to crontab
*/5 * * * * systemctl is-active n8n-daemon || systemctl restart n8n-daemon
```

---

**Quick Commands**:
- Status: `systemctl status n8n-daemon`
- Logs: `journalctl -u n8n-daemon -f`
- Restart: `systemctl restart n8n-daemon`
- Health: `curl http://localhost:3001/api/health`
- Reset: See "Complete Reset" section above

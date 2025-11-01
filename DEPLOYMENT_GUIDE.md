# Deployment Guide - Fresh Server Setup

This guide walks through deploying the n8n daemon on a fresh Ubuntu/Debian server.

## Prerequisites

- Ubuntu 20.04+ or Debian 11+ server
- Root access
- GitHub Personal Access Token (for private repo)
- Domain name with DNS access

## Step 1: Prepare Server

```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Update system
apt-get update
apt-get upgrade -y

# Set hostname (optional)
hostnamectl set-hostname n8n-server
```

## Step 2: Set GitHub Token

```bash
# Create GitHub Personal Access Token at:
# https://github.com/settings/tokens
# Scope needed: repo (full control of private repositories)

export GITHUB_TOKEN=your_github_token_here
```

## Step 3: Run Installation Script

```bash
# Download and run install script
curl -fsSL https://raw.githubusercontent.com/eskemo-hub/n8n-instance-manager/main/daemon/install-from-github.sh -o install.sh

# Make executable
chmod +x install.sh

# Run installation
sudo GITHUB_TOKEN=$GITHUB_TOKEN bash install.sh
```

The script will install:
- ✅ Node.js 18
- ✅ Docker
- ✅ HAProxy
- ✅ Daemon code
- ✅ All dependencies

## Step 4: Configure Environment

```bash
# Copy example env file
cd /opt/n8n-daemon/daemon
cp .env.example .env

# Edit configuration
nano .env
```

Required settings:
```env
# Generate with: openssl rand -base64 32
DAEMON_API_KEY=your_secure_api_key_here

# Your platform's URL
PLATFORM_URL=https://your-platform.com

# Port (default: 3001)
PORT=3001

# Node environment
NODE_ENV=production
```

## Step 5: Set Up Systemd Service

```bash
# Copy service file
cp /opt/n8n-daemon/daemon/n8n-daemon.service /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable and start daemon
systemctl enable n8n-daemon
systemctl start n8n-daemon

# Check status
systemctl status n8n-daemon
```

## Step 6: Configure Firewall

```bash
# Enable UFW if not already enabled
ufw --force enable

# Allow SSH (important!)
ufw allow 22/tcp

# Allow HTTP/HTTPS (for Traefik)
ufw allow 80/tcp
ufw allow 443/tcp

# Allow database ports (for HAProxy)
ufw allow 5432/tcp  # PostgreSQL
ufw allow 3306/tcp  # MySQL
ufw allow 27017/tcp # MongoDB

# Allow daemon API (if needed externally)
ufw allow 3001/tcp

# Reload firewall
ufw reload

# Check status
ufw status
```

## Step 7: Verify Installation

```bash
# Run verification script
cd /opt/n8n-daemon/daemon
bash verify-installation.sh
```

This checks:
- ✅ All services running
- ✅ Correct permissions
- ✅ Valid configurations
- ✅ Firewall rules

## Step 8: Set Up Traefik (Optional)

If you want to host n8n instances with automatic SSL:

```bash
# Traefik will be set up via your platform's API
# Or manually create Traefik container
```

## Step 9: Test Database Creation

From your platform, create a test database:

1. Go to Admin Dashboard
2. Click "Create Database"
3. Select PostgreSQL
4. Set subdomain: `test`
5. Set password
6. Create

Then test connection:
```bash
psql "postgresql://postgres:PASSWORD@test.yourdomain.com:5432/postgres"
```

## Troubleshooting

### Daemon won't start

```bash
# Check logs
journalctl -u n8n-daemon -n 50

# Check if port 3001 is in use
lsof -i :3001

# Verify .env file exists
ls -la /opt/n8n-daemon/daemon/.env
```

### HAProxy not working

```bash
# Check HAProxy status
systemctl status haproxy

# Check HAProxy logs
journalctl -u haproxy -n 50

# Test HAProxy config
haproxy -c -f /opt/n8n-daemon/haproxy/haproxy.cfg

# Check if ports are listening
ss -tlnp | grep -E ":(5432|3306|8404)"
```

### Database connection fails

```bash
# Check if container is running
docker ps | grep postgres

# Check container logs
docker logs CONTAINER_NAME

# Test direct connection to backend
telnet 127.0.0.1 BACKEND_PORT

# Check HAProxy routing
curl http://localhost:8404/stats
```

### Permission errors

```bash
# Fix daemon ownership
chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon

# Fix HAProxy config ownership
chown n8n-daemon:n8n-daemon /opt/n8n-daemon/haproxy/haproxy.cfg

# Verify groups
groups n8n-daemon
# Should show: n8n-daemon docker haproxy
```

## Updating the Daemon

```bash
cd /opt/n8n-daemon/daemon
sudo bash update-from-github.sh
```

Or manually:
```bash
cd /opt/n8n-daemon/daemon
git pull origin main
npm install
npm run build
systemctl restart n8n-daemon
```

## Monitoring

### View Logs

```bash
# Daemon logs
journalctl -u n8n-daemon -f

# HAProxy logs
journalctl -u haproxy -f

# Docker logs
docker logs -f CONTAINER_NAME
```

### Check Status

```bash
# All services
systemctl status n8n-daemon haproxy docker

# HAProxy stats page
curl http://localhost:8404/stats

# List containers
docker ps
```

## Security Checklist

- [ ] Firewall enabled and configured
- [ ] SSH key authentication (disable password auth)
- [ ] Strong DAEMON_API_KEY set
- [ ] Regular system updates
- [ ] Monitoring set up
- [ ] Backups configured
- [ ] SSL certificates for domains

## Next Steps

1. Add server to your platform
2. Configure DNS for your domains
3. Create database instances
4. Set up monitoring/alerts
5. Configure backups

## Support

If you encounter issues:
1. Run `verify-installation.sh`
2. Check logs with `journalctl`
3. Review this guide
4. Check GitHub issues

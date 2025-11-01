# Deploy n8n Daemon to VPS (Vultr, Hetzner, DigitalOcean, etc.)

This guide walks you through deploying the n8n daemon to a VPS server.

## Recommended VPS Providers

### Best Value:
- **Hetzner Cloud** - €4-27/month (Best price/performance)
- **Contabo** - Very cheap, but mixed reviews
- **OVH** - Good for Europe

### Most Popular:
- **DigitalOcean** - $6-40/month (Great docs, reliable)
- **Linode/Akamai** - $5-36/month (Excellent support)
- **Vultr** - $6-48/month (Global locations)

### Recommended Specs:
- **Minimum:** 2GB RAM, 1 vCPU, 50GB SSD (5-8 n8n instances)
- **Recommended:** 4GB RAM, 2 vCPU, 80GB SSD (10-15 instances)
- **Production:** 8GB RAM, 4 vCPU, 160GB SSD (20-30 instances)

---

## Quick Start (Any VPS Provider)

### Step 1: Create VPS Server

**Choose:**
- **OS:** Ubuntu 22.04 LTS or Debian 12 (recommended)
- **Location:** Closest to your users
- **SSH Key:** Add your SSH key for secure access

**Example Hetzner:**
1. Go to https://console.hetzner.cloud
2. Create new project
3. Add server → CPX21 (€8.46/month)
4. Select Ubuntu 22.04
5. Add SSH key
6. Create server

**Example DigitalOcean:**
1. Go to https://cloud.digitalocean.com
2. Create → Droplets
3. Choose $12/month plan (2GB RAM)
4. Select Ubuntu 22.04
5. Add SSH key
6. Create Droplet

### Step 2: Connect to Your Server

```bash
# Replace with your server's IP
ssh root@YOUR_SERVER_IP
```

### Step 3: Run Automated Setup Script

Copy and paste this entire script:

```bash
#!/bin/bash
set -e

echo "🚀 n8n Daemon Installation Script"
echo "=================================="
echo ""

# Update system
echo "📦 Updating system packages..."
apt-get update
apt-get upgrade -y

# Install Node.js 18
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify Node.js
node --version
npm --version

# Install Docker
echo "🐳 Installing Docker..."
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start Docker
systemctl start docker
systemctl enable docker

# Verify Docker
docker --version

# Create daemon user
echo "👤 Creating daemon user..."
useradd -r -s /bin/bash -d /opt/n8n-daemon -m n8n-daemon
usermod -aG docker n8n-daemon

# Create daemon directory
echo "📁 Setting up daemon directory..."
mkdir -p /opt/n8n-daemon
cd /opt/n8n-daemon

# Download daemon files (you'll need to upload these)
echo ""
echo "✅ System setup complete!"
echo ""
echo "Next steps:"
echo "1. Upload daemon files to /opt/n8n-daemon"
echo "2. Configure .env file"
echo "3. Install dependencies and start daemon"
echo ""
echo "See the manual steps below for details."
```

Save this as `setup.sh`, make it executable, and run:

```bash
chmod +x setup.sh
./setup.sh
```

---

## Manual Installation (Step by Step)

### 1. Update System

```bash
apt-get update
apt-get upgrade -y
```

### 2. Install Node.js 18

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify
node --version  # Should show v18.x
npm --version
```

### 3. Install Docker

```bash
# Install prerequisites
apt-get install -y ca-certificates curl gnupg

# Add Docker's GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Verify
docker --version
docker run hello-world
```

### 4. Create Daemon User

```bash
# Create user
useradd -r -s /bin/bash -d /opt/n8n-daemon -m n8n-daemon

# Add to docker group
usermod -aG docker n8n-daemon

# Verify
id n8n-daemon
```

### 5. Upload Daemon Files

**Option A: Using SCP (from your local machine)**

```bash
# From your local machine (in the project root)
scp -r daemon root@YOUR_SERVER_IP:/tmp/

# Then on the server
mv /tmp/daemon/* /opt/n8n-daemon/
chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon
```

**Option B: Using Git**

```bash
# On the server
cd /opt/n8n-daemon
git clone https://github.com/YOUR_USERNAME/n8n-instance-manager.git temp
mv temp/daemon/* .
rm -rf temp
chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon
```

**Option C: Manual Upload**

Use SFTP client like FileZilla:
1. Connect to your server
2. Upload the `daemon` folder to `/opt/n8n-daemon`
3. Run: `chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon`

### 6. Configure Environment

```bash
# Switch to daemon user
su - n8n-daemon
cd /opt/n8n-daemon

# Create .env file
cp .env.example .env
nano .env
```

**Edit .env file:**

```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Security - Generate with: openssl rand -base64 32
API_KEY=your-secure-api-key-here

# Optional: SSL Configuration
# SSL_CERT_PATH=/path/to/cert.pem
# SSL_KEY_PATH=/path/to/key.pem
```

**Generate API Key:**

```bash
openssl rand -base64 32
```

Copy the output and paste it as your API_KEY in .env

### 7. Install Dependencies

```bash
# Still as n8n-daemon user
npm install --production
```

### 8. Build the Application

```bash
npm run build
```

### 9. Test the Daemon

```bash
# Test run
./start-daemon.sh
```

If successful, you'll see:
```
✓ Successfully connected to database
✓ Docker is running
✓ Daemon started on port 3001
```

Press `Ctrl+C` to stop.

### 10. Set Up as System Service

```bash
# Exit from daemon user
exit

# Copy systemd service file
cp /opt/n8n-daemon/n8n-daemon.service /etc/systemd/system/

# Reload systemd
systemctl daemon-reload

# Enable and start service
systemctl enable n8n-daemon
systemctl start n8n-daemon

# Check status
systemctl status n8n-daemon
```

### 11. Configure Firewall

**Using UFW (Ubuntu):**

```bash
# Allow SSH (important!)
ufw allow 22/tcp

# Allow daemon port from your platform server only
ufw allow from YOUR_VERCEL_IP to any port 3001

# Enable firewall
ufw enable
```

**Using firewalld (CentOS/RHEL):**

```bash
firewall-cmd --permanent --add-port=3001/tcp
firewall-cmd --reload
```

---

## Verification

### Test Daemon Health

```bash
# From the server
curl http://localhost:3001/api/health

# From your local machine (if firewall allows)
curl http://YOUR_SERVER_IP:3001/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-10-22T...",
  "cpu": {...},
  "memory": {...},
  "docker": {...}
}
```

### Test with API Key

```bash
curl -H "x-api-key: YOUR_API_KEY" http://YOUR_SERVER_IP:3001/api/containers
```

### Check Logs

```bash
# View logs
journalctl -u n8n-daemon -f

# Recent logs
journalctl -u n8n-daemon -n 100

# Logs from today
journalctl -u n8n-daemon --since today
```

---

## Connect to Platform

### 1. Get Server Information

You'll need:
- **Server IP:** Your VPS IP address
- **Daemon URL:** `http://YOUR_SERVER_IP:3001`
- **API Key:** From your .env file

### 2. Add Server in Platform

1. Login to your Vercel-deployed platform
2. Go to **Admin Dashboard → Servers**
3. Click **"Add Server"**
4. Use the wizard:
   - **Name:** Production Server 1
   - **IP Address:** YOUR_SERVER_IP
   - **Daemon URL:** `http://YOUR_SERVER_IP:3001`
   - **API Key:** Your generated API key
5. Click **"Test Connection"**
6. If successful, click **"Add Server"**

---

## Provider-Specific Tips

### Hetzner Cloud

**Pros:** Best price/performance, excellent network
**Cons:** Limited to Europe (mostly)

```bash
# Recommended: CPX21 (€8.46/month)
# 3 vCPU, 4GB RAM, 80GB SSD
# Can run 8-12 n8n instances
```

**Firewall:** Use Hetzner Cloud Firewall (free)
- Create firewall in Hetzner console
- Allow port 22 (SSH) from your IP
- Allow port 3001 from Vercel IPs
- Attach to server

### DigitalOcean

**Pros:** Great documentation, reliable
**Cons:** Slightly more expensive

```bash
# Recommended: $12/month droplet
# 2 vCPU, 2GB RAM, 50GB SSD
# Can run 5-8 n8n instances
```

**Firewall:** Use DigitalOcean Cloud Firewall (free)
- Create firewall in DO console
- Allow SSH from your IP
- Allow port 3001 from Vercel
- Apply to droplet

### Vultr

**Pros:** Many global locations
**Cons:** Pricing similar to DigitalOcean

```bash
# Recommended: $12/month plan
# 2 vCPU, 4GB RAM, 80GB SSD
```

**Firewall:** Use Vultr Firewall (free)

### Linode/Akamai

**Pros:** Excellent support, reliable
**Cons:** Pricing similar to DigitalOcean

```bash
# Recommended: Linode 4GB ($24/month)
# 2 vCPU, 4GB RAM, 80GB SSD
```

---

## Security Best Practices

### 1. Use SSH Keys Only

```bash
# Disable password authentication
nano /etc/ssh/sshd_config

# Set these values:
PasswordAuthentication no
PermitRootLogin prohibit-password

# Restart SSH
systemctl restart sshd
```

### 2. Set Up Fail2Ban

```bash
apt-get install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

### 3. Enable Automatic Updates

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### 4. Use Strong API Keys

```bash
# Generate strong API key
openssl rand -base64 32
```

### 5. Restrict Firewall

Only allow connections from:
- Your IP (for SSH)
- Vercel IPs (for daemon API)

### 6. Regular Backups

```bash
# Backup daemon config
tar -czf n8n-daemon-backup.tar.gz /opt/n8n-daemon/.env

# Backup Docker volumes
docker volume ls
docker run --rm -v VOLUME_NAME:/data -v $(pwd):/backup ubuntu tar czf /backup/volume-backup.tar.gz /data
```

---

## Troubleshooting

### Daemon won't start

```bash
# Check logs
journalctl -u n8n-daemon -n 50

# Check if port is in use
lsof -i :3001

# Check Docker
docker info
systemctl status docker
```

### Can't connect from platform

```bash
# Test locally first
curl http://localhost:3001/api/health

# Check firewall
ufw status
iptables -L

# Check if daemon is listening
netstat -tlnp | grep 3001
```

### Docker permission errors

```bash
# Ensure user is in docker group
usermod -aG docker n8n-daemon

# Restart daemon
systemctl restart n8n-daemon
```

---

## Monitoring

### Check Resource Usage

```bash
# CPU and Memory
htop

# Docker stats
docker stats

# Disk usage
df -h
```

### Set Up Monitoring (Optional)

**Netdata (Free, Easy):**

```bash
bash <(curl -Ss https://my-netdata.io/kickstart.sh)
```

Access at: `http://YOUR_SERVER_IP:19999`

---

## Updating the Daemon

```bash
# Stop service
systemctl stop n8n-daemon

# Backup
cp -r /opt/n8n-daemon /opt/n8n-daemon.backup

# Upload new files
# (use scp, git, or sftp)

# Install dependencies
su - n8n-daemon
cd /opt/n8n-daemon
npm install --production
npm run build
exit

# Restart service
systemctl start n8n-daemon
systemctl status n8n-daemon
```

---

## Cost Estimates

### Hetzner (Best Value)
- CPX11: €4/month (2GB RAM) - 3-5 instances
- CPX21: €8.46/month (4GB RAM) - 8-12 instances
- CPX31: €13.90/month (8GB RAM) - 15-20 instances

### DigitalOcean
- $6/month (1GB RAM) - 2-3 instances
- $12/month (2GB RAM) - 5-8 instances
- $24/month (4GB RAM) - 10-15 instances

### Vultr
- $6/month (1GB RAM) - 2-3 instances
- $12/month (2GB RAM) - 5-8 instances
- $24/month (4GB RAM) - 10-15 instances

---

## Quick Commands Reference

```bash
# Service management
systemctl start n8n-daemon
systemctl stop n8n-daemon
systemctl restart n8n-daemon
systemctl status n8n-daemon

# View logs
journalctl -u n8n-daemon -f

# Test daemon
curl http://localhost:3001/api/health

# Check Docker
docker ps
docker stats

# Check resources
htop
df -h

# Firewall
ufw status
ufw allow from IP to any port 3001
```

---

**You're all set!** Your daemon is now running on a VPS and ready to manage n8n instances. 🚀

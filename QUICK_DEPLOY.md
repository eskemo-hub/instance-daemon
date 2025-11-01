# Quick Deploy - Daemon from GitHub

## 🚀 One-Command Installation

### Step 1: Get GitHub Token

1. Go to: https://github.com/settings/tokens
2. Generate new token (classic)
3. Select **repo** scope
4. Copy token: `ghp_xxxxxxxxxxxx`

### Step 2: Deploy to VPS

SSH into your server and run:

```bash
export GITHUB_TOKEN=ghp_your_token_here
curl -fsSL https://raw.githubusercontent.com/eskemo-hub/n8n-instance-manager/main/daemon/install-from-github.sh | sudo -E bash
```

### Step 3: Configure

```bash
# Generate API key
openssl rand -base64 32

# Edit config
sudo nano /opt/n8n-daemon/.env
```

Add:
```env
PORT=3001
NODE_ENV=production
API_KEY=your-generated-key-here
```

### Step 4: Start Service

```bash
sudo cp /opt/n8n-daemon/n8n-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable n8n-daemon
sudo systemctl start n8n-daemon
```

### Step 5: Verify

```bash
sudo systemctl status n8n-daemon
curl http://localhost:3001/api/health
```

---

## 🔄 Update Daemon

```bash
export GITHUB_TOKEN=ghp_your_token_here
sudo -E /opt/n8n-daemon/update-from-github.sh
```

---

## 📋 Quick Commands

```bash
# Status
sudo systemctl status n8n-daemon

# Logs
sudo journalctl -u n8n-daemon -f

# Restart
sudo systemctl restart n8n-daemon

# Stop
sudo systemctl stop n8n-daemon

# Start
sudo systemctl start n8n-daemon
```

---

## 🔥 Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow from YOUR_PLATFORM_IP to any port 3001
sudo ufw enable
```

---

## ✅ Done!

Your daemon is now:
- ✓ Installed from GitHub
- ✓ Running as a service
- ✓ Auto-starts on boot
- ✓ Easy to update

**Connect it to your platform:**
1. Login to your Vercel app
2. Go to Admin → Servers
3. Click "Add Server"
4. Enter server details and API key
5. Test connection
6. Add server

---

**Full guides:**
- `GITHUB_DEPLOYMENT.md` - Complete GitHub deployment guide
- `DEPLOY_TO_VPS.md` - Manual VPS deployment
- `INSTALLATION.md` - Detailed installation guide

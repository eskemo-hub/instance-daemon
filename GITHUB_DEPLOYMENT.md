# Deploy Daemon from Private GitHub Repository

This guide shows you how to deploy and auto-update the n8n daemon directly from your private GitHub repository.

## Prerequisites

- VPS server (Vultr, Hetzner, DigitalOcean, etc.)
- GitHub Personal Access Token
- SSH access to your server

---

## Step 1: Create GitHub Personal Access Token

### 1.1 Go to GitHub Settings

Visit: https://github.com/settings/tokens

### 1.2 Generate New Token

1. Click **"Generate new token"** → **"Generate new token (classic)"**
2. Give it a name: `n8n-daemon-deployment`
3. Select scopes:
   - ✓ **repo** (Full control of private repositories)
4. Click **"Generate token"**
5. **Copy the token immediately** (you won't see it again!)

Example token: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 1.3 Save Token Securely

Store it in a password manager or secure note. You'll need it for deployment.

---

## Step 2: One-Command Installation

### On Your VPS Server:

```bash
# Set your GitHub token
export GITHUB_TOKEN=ghp_your_token_here

# Optional: Set custom repository (if different)
export GITHUB_REPO=eskemo-hub/n8n-instance-manager
export GITHUB_BRANCH=main

# Download and run installation script
curl -fsSL https://raw.githubusercontent.com/eskemo-hub/n8n-instance-manager/main/daemon/install-from-github.sh | sudo -E bash
```

**That's it!** The script will:
- ✓ Install Node.js 18
- ✓ Install Docker
- ✓ Create daemon user
- ✓ Clone repository from GitHub
- ✓ Install dependencies
- ✓ Build application

---

## Step 3: Configure Daemon

### 3.1 Create Environment File

```bash
sudo nano /opt/n8n-daemon/.env
```

### 3.2 Add Configuration

```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Security - Generate with: openssl rand -base64 32
API_KEY=your-secure-api-key-here
```

### 3.3 Generate API Key

```bash
openssl rand -base64 32
```

Copy the output and paste it as `API_KEY` in your `.env` file.

---

## Step 4: Set Up as System Service

```bash
# Copy systemd service file
sudo cp /opt/n8n-daemon/n8n-daemon.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable n8n-daemon

# Start daemon
sudo systemctl start n8n-daemon

# Check status
sudo systemctl status n8n-daemon
```

---

## Step 5: Configure Firewall

```bash
# Allow SSH (important!)
sudo ufw allow 22/tcp

# Allow daemon port (adjust IP to your platform server)
sudo ufw allow from YOUR_VERCEL_IP to any port 3001

# Enable firewall
sudo ufw enable
```

---

## Updating the Daemon

### Automatic Update Script

When you push updates to GitHub, update your daemon:

```bash
# Set GitHub token
export GITHUB_TOKEN=ghp_your_token_here

# Run update script
sudo -E /opt/n8n-daemon/update-from-github.sh
```

The script will:
1. Stop the daemon
2. Create a backup
3. Pull latest changes from GitHub
4. Update dependencies
5. Rebuild application
6. Restart daemon

### Manual Update

```bash
# Stop daemon
sudo systemctl stop n8n-daemon

# Backup
sudo cp -r /opt/n8n-daemon /opt/n8n-daemon.backup

# Update from GitHub
cd /opt/n8n-daemon
sudo -u n8n-daemon git pull origin main

# Install dependencies
sudo -u n8n-daemon npm install --production

# Rebuild
sudo -u n8n-daemon npm run build

# Restart
sudo systemctl start n8n-daemon
```

---

## Automated Updates with Cron

### Set Up Daily Auto-Updates

```bash
# Create update script with token
sudo nano /opt/n8n-daemon/auto-update.sh
```

Add this content:

```bash
#!/bin/bash
export GITHUB_TOKEN=ghp_your_token_here
/opt/n8n-daemon/update-from-github.sh >> /var/log/n8n-daemon-update.log 2>&1
```

Make it executable:

```bash
sudo chmod +x /opt/n8n-daemon/auto-update.sh
```

Add to crontab:

```bash
sudo crontab -e
```

Add this line (updates daily at 3 AM):

```cron
0 3 * * * /opt/n8n-daemon/auto-update.sh
```

---

## GitHub Webhooks (Advanced)

### Set Up Webhook for Instant Updates

#### 1. Create Webhook Endpoint on Server

```bash
# Install webhook tool
sudo apt-get install -y webhook

# Create webhook script
sudo nano /opt/n8n-daemon/webhook-update.sh
```

Add:

```bash
#!/bin/bash
export GITHUB_TOKEN=ghp_your_token_here
/opt/n8n-daemon/update-from-github.sh
```

Make executable:

```bash
sudo chmod +x /opt/n8n-daemon/webhook-update.sh
```

#### 2. Configure Webhook

Create `/etc/webhook.conf`:

```json
[
  {
    "id": "n8n-daemon-update",
    "execute-command": "/opt/n8n-daemon/webhook-update.sh",
    "command-working-directory": "/opt/n8n-daemon",
    "response-message": "Updating daemon...",
    "trigger-rule": {
      "match": {
        "type": "payload-hash-sha256",
        "secret": "your-webhook-secret",
        "parameter": {
          "source": "header",
          "name": "X-Hub-Signature-256"
        }
      }
    }
  }
]
```

#### 3. Start Webhook Service

```bash
webhook -hooks /etc/webhook.conf -verbose -port 9000
```

#### 4. Configure GitHub Webhook

1. Go to your GitHub repository
2. Settings → Webhooks → Add webhook
3. Payload URL: `http://YOUR_SERVER_IP:9000/hooks/n8n-daemon-update`
4. Content type: `application/json`
5. Secret: `your-webhook-secret`
6. Events: Just the push event
7. Active: ✓

Now every push to GitHub will automatically update your daemon!

---

## Multiple Servers

### Deploy to Multiple Servers

Create a deployment script:

```bash
#!/bin/bash

SERVERS=(
    "server1.example.com"
    "server2.example.com"
    "server3.example.com"
)

GITHUB_TOKEN="ghp_your_token_here"

for server in "${SERVERS[@]}"; do
    echo "Updating $server..."
    ssh root@$server "export GITHUB_TOKEN=$GITHUB_TOKEN && /opt/n8n-daemon/update-from-github.sh"
done

echo "All servers updated!"
```

---

## Security Best Practices

### 1. Protect Your GitHub Token

**Never commit the token to Git!**

```bash
# Store in environment variable
echo 'export GITHUB_TOKEN=ghp_your_token_here' >> ~/.bashrc
source ~/.bashrc
```

### 2. Use Deploy Keys (Alternative)

Instead of personal access tokens, use deploy keys:

1. Generate SSH key on server:
```bash
ssh-keygen -t ed25519 -C "n8n-daemon-deploy"
```

2. Add public key to GitHub:
   - Repository → Settings → Deploy keys
   - Add key (read-only access)

3. Clone using SSH:
```bash
git clone git@github.com:eskemo-hub/n8n-instance-manager.git
```

### 3. Rotate Tokens Regularly

- Generate new token every 90 days
- Revoke old tokens
- Update on all servers

---

## Troubleshooting

### Installation Fails

**Error: "Authentication failed"**
```bash
# Check token is set
echo $GITHUB_TOKEN

# Verify token has repo access
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user
```

**Error: "Repository not found"**
```bash
# Check repository name
export GITHUB_REPO=your-username/your-repo-name

# Verify access
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$GITHUB_REPO
```

### Update Fails

**Check logs:**
```bash
sudo journalctl -u n8n-daemon -n 50
```

**Restore from backup:**
```bash
sudo systemctl stop n8n-daemon
sudo rm -rf /opt/n8n-daemon
sudo mv /opt/n8n-daemon.backup.YYYYMMDD_HHMMSS /opt/n8n-daemon
sudo systemctl start n8n-daemon
```

### Token Expired

**Generate new token:**
1. Go to https://github.com/settings/tokens
2. Generate new token
3. Update environment variable:
```bash
export GITHUB_TOKEN=ghp_new_token_here
```

---

## Quick Commands Reference

```bash
# Install daemon
export GITHUB_TOKEN=ghp_your_token_here
curl -fsSL https://raw.githubusercontent.com/eskemo-hub/n8n-instance-manager/main/daemon/install-from-github.sh | sudo -E bash

# Update daemon
export GITHUB_TOKEN=ghp_your_token_here
sudo -E /opt/n8n-daemon/update-from-github.sh

# Check status
sudo systemctl status n8n-daemon

# View logs
sudo journalctl -u n8n-daemon -f

# Restart daemon
sudo systemctl restart n8n-daemon

# Test daemon
curl http://localhost:3001/api/health
```

---

## Deployment Workflow

```
┌─────────────────────┐
│  Push to GitHub     │
│  (main branch)      │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  GitHub Repository  │
│  (Private)          │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  VPS Server         │
│  - Pull changes     │
│  - Install deps     │
│  - Build            │
│  - Restart daemon   │
└─────────────────────┘
```

---

## Cost Comparison

### Using GitHub (Recommended)
- ✓ Free private repositories
- ✓ Automatic updates
- ✓ Version control
- ✓ Easy rollback
- ✓ Multiple server deployment

### Manual Upload
- ✗ Manual process
- ✗ No version history
- ✗ Difficult rollback
- ✗ Time-consuming for multiple servers

---

**You're all set!** Your daemon will now automatically update from GitHub whenever you push changes. 🚀

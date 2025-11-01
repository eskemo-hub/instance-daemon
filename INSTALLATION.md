# n8n Daemon Installation Guide

This guide provides detailed instructions for installing and configuring the n8n daemon on a Linux host server.

## Prerequisites

Before installing the daemon, ensure your system meets the following requirements:

- **Operating System**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+, or similar)
- **Node.js**: Version 18 or higher
- **Docker**: Docker Engine 20.10 or higher
- **System Resources**: Minimum 2GB RAM, 20GB disk space
- **Network**: Open port for daemon communication (default: 3001)

## Installation Steps

### 1. Install Node.js

If Node.js is not already installed:

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**CentOS/RHEL:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

Verify installation:
```bash
node --version  # Should be v18.x or higher
npm --version
```

### 2. Install Docker

If Docker is not already installed:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**CentOS/RHEL:**
```bash
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl start docker
sudo systemctl enable docker
```

Verify Docker installation:
```bash
sudo docker --version
sudo docker run hello-world
```

### 3. Create Daemon User

Create a dedicated user for running the daemon:

```bash
sudo useradd -r -s /bin/bash -d /opt/n8n-daemon -m n8n-daemon
```

Add the daemon user to the Docker group:
```bash
sudo usermod -aG docker n8n-daemon
```

### 4. Install the Daemon

Copy the daemon files to the installation directory:

```bash
sudo mkdir -p /opt/n8n-daemon
sudo cp -r /path/to/daemon/* /opt/n8n-daemon/
sudo chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon
```

Switch to the daemon user and install dependencies:
```bash
sudo su - n8n-daemon
cd /opt/n8n-daemon
npm install --production
```

### 5. Configure Environment Variables

Create the `.env` file:
```bash
cp .env.example .env
```

Generate a secure API key:
```bash
openssl rand -base64 32
```

Edit the `.env` file with your configuration:
```bash
nano .env
```

Required configuration:
```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Security
API_KEY=your-generated-api-key-here

# Optional: SSL Configuration (recommended for production)
# SSL_CERT_PATH=/path/to/cert.pem
# SSL_KEY_PATH=/path/to/key.pem
```

Validate your configuration:
```bash
npm run validate-env
```

### 6. Build the Application

Build the TypeScript code:
```bash
npm run build
```

Verify the build:
```bash
ls -la dist/
```

### 7. Test the Daemon

Test the daemon manually before setting up as a service:
```bash
./start-daemon.sh
```

In another terminal, test the health endpoint:
```bash
curl http://localhost:3001/api/health
```

If successful, you should see health metrics. Press `Ctrl+C` to stop the daemon.

### 8. Set Up as a System Service

Exit from the daemon user:
```bash
exit
```

Copy the systemd service file:
```bash
sudo cp /opt/n8n-daemon/n8n-daemon.service /etc/systemd/system/
```

Edit the service file if you used a different installation path:
```bash
sudo nano /etc/systemd/system/n8n-daemon.service
```

Reload systemd and enable the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable n8n-daemon
```

Start the service:
```bash
sudo systemctl start n8n-daemon
```

Check the service status:
```bash
sudo systemctl status n8n-daemon
```

View logs:
```bash
sudo journalctl -u n8n-daemon -f
```

## Firewall Configuration

Configure your firewall to allow access from the platform server only:

**Using UFW (Ubuntu/Debian):**
```bash
sudo ufw allow from <platform-server-ip> to any port 3001
sudo ufw enable
```

**Using firewalld (CentOS/RHEL):**
```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<platform-server-ip>" port protocol="tcp" port="3001" accept'
sudo firewall-cmd --reload
```

Replace `<platform-server-ip>` with the actual IP address of your platform server.

## SSL/TLS Configuration (Recommended)

For production deployments, use SSL/TLS to encrypt communication:

1. Obtain SSL certificates (e.g., from Let's Encrypt):
```bash
sudo apt-get install certbot
sudo certbot certonly --standalone -d daemon.yourdomain.com
```

2. Update your `.env` file:
```env
SSL_CERT_PATH=/etc/letsencrypt/live/daemon.yourdomain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/daemon.yourdomain.com/privkey.pem
```

3. Grant the daemon user access to certificates:
```bash
sudo setfacl -R -m u:n8n-daemon:rx /etc/letsencrypt/live
sudo setfacl -R -m u:n8n-daemon:rx /etc/letsencrypt/archive
```

4. Restart the daemon:
```bash
sudo systemctl restart n8n-daemon
```

## Service Management

### Start the daemon:
```bash
sudo systemctl start n8n-daemon
```

### Stop the daemon:
```bash
sudo systemctl stop n8n-daemon
```

### Restart the daemon:
```bash
sudo systemctl restart n8n-daemon
```

### Check status:
```bash
sudo systemctl status n8n-daemon
```

### View logs:
```bash
# View recent logs
sudo journalctl -u n8n-daemon -n 100

# Follow logs in real-time
sudo journalctl -u n8n-daemon -f

# View logs from today
sudo journalctl -u n8n-daemon --since today
```

### Enable auto-start on boot:
```bash
sudo systemctl enable n8n-daemon
```

### Disable auto-start:
```bash
sudo systemctl disable n8n-daemon
```

## Updating the Daemon

To update the daemon to a new version:

1. Stop the service:
```bash
sudo systemctl stop n8n-daemon
```

2. Backup the current installation:
```bash
sudo cp -r /opt/n8n-daemon /opt/n8n-daemon.backup
```

3. Update the files:
```bash
sudo cp -r /path/to/new/daemon/* /opt/n8n-daemon/
sudo chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon
```

4. Install dependencies and rebuild:
```bash
sudo su - n8n-daemon
cd /opt/n8n-daemon
npm install --production
npm run build
exit
```

5. Restart the service:
```bash
sudo systemctl restart n8n-daemon
```

6. Verify the update:
```bash
sudo systemctl status n8n-daemon
curl http://localhost:3001/api/health
```

## Troubleshooting

### Daemon won't start

Check the logs:
```bash
sudo journalctl -u n8n-daemon -n 50
```

Common issues:
- **Port already in use**: Change the PORT in `.env`
- **Docker not running**: `sudo systemctl start docker`
- **Permission denied**: Ensure daemon user is in docker group
- **Missing dependencies**: Run `npm install` as daemon user

### Docker permission errors

If you see "permission denied" errors accessing Docker:
```bash
sudo usermod -aG docker n8n-daemon
# Log out and log back in, or restart the service
sudo systemctl restart n8n-daemon
```

### Cannot connect from platform

Check firewall rules:
```bash
sudo ufw status  # Ubuntu/Debian
sudo firewall-cmd --list-all  # CentOS/RHEL
```

Test connectivity from platform server:
```bash
curl http://<daemon-server-ip>:3001/api/health
```

### High memory usage

Adjust memory limits in the systemd service file:
```bash
sudo nano /etc/systemd/system/n8n-daemon.service
# Modify MemoryLimit value
sudo systemctl daemon-reload
sudo systemctl restart n8n-daemon
```

### Container creation fails

Check Docker status:
```bash
sudo docker info
sudo docker ps -a
```

Check available disk space:
```bash
df -h
```

Clean up unused Docker resources:
```bash
sudo docker system prune -a
```

## Uninstallation

To completely remove the daemon:

1. Stop and disable the service:
```bash
sudo systemctl stop n8n-daemon
sudo systemctl disable n8n-daemon
```

2. Remove the service file:
```bash
sudo rm /etc/systemd/system/n8n-daemon.service
sudo systemctl daemon-reload
```

3. Remove the installation directory:
```bash
sudo rm -rf /opt/n8n-daemon
```

4. Remove the daemon user (optional):
```bash
sudo userdel -r n8n-daemon
```

## Security Best Practices

1. **Use strong API keys**: Generate keys with at least 32 characters
2. **Enable SSL/TLS**: Always use HTTPS in production
3. **Restrict firewall access**: Only allow connections from the platform server
4. **Keep software updated**: Regularly update Node.js, Docker, and the daemon
5. **Monitor logs**: Regularly check logs for suspicious activity
6. **Use dedicated user**: Never run the daemon as root
7. **Limit resources**: Use systemd resource limits to prevent resource exhaustion
8. **Regular backups**: Backup your configuration and Docker volumes

## Support

For issues and questions:
- Check the main README.md for general information
- Review the troubleshooting section above
- Check daemon logs: `sudo journalctl -u n8n-daemon -f`
- Verify environment configuration: `npm run validate-env`

## Next Steps

After successfully installing the daemon:

1. Register the server in the platform web interface
2. Test instance creation from the platform
3. Monitor the daemon logs during initial operations
4. Set up monitoring and alerting for production use

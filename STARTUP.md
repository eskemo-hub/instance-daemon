# Daemon Startup Guide

Quick reference for starting and managing the n8n daemon.

## Startup Methods

### 1. Using the Startup Script (Recommended for Manual Starts)

The `start-daemon.sh` script provides automated validation and startup:

```bash
./start-daemon.sh
```

**What it does:**
- ✓ Checks for `.env` file
- ✓ Validates Node.js installation
- ✓ Validates Docker installation and status
- ✓ Builds the project if needed
- ✓ Installs dependencies if needed
- ✓ Validates environment configuration
- ✓ Starts the daemon

**When to use:**
- Development and testing
- Manual daemon starts
- Troubleshooting startup issues

### 2. Using Systemd Service (Recommended for Production)

For production environments with automatic startup and monitoring:

```bash
# Start the service
sudo systemctl start n8n-daemon

# Check status
sudo systemctl status n8n-daemon

# Enable auto-start on boot
sudo systemctl enable n8n-daemon

# View logs
sudo journalctl -u n8n-daemon -f
```

**When to use:**
- Production deployments
- Servers that need automatic startup on boot
- When you need centralized logging
- When you need automatic restart on failure

**Setup required:** See [INSTALLATION.md](./INSTALLATION.md) for systemd setup instructions.

### 3. Direct NPM Start

For simple manual starts without validation:

```bash
npm start
```

**When to use:**
- Quick testing after manual validation
- When you're certain all prerequisites are met

### 4. Development Mode

For development with auto-reload:

```bash
npm run dev
```

**When to use:**
- Active development
- Testing code changes
- Debugging

## Pre-Start Checklist

Before starting the daemon, ensure:

- [ ] Node.js 18+ is installed: `node --version`
- [ ] Docker is installed and running: `docker info`
- [ ] `.env` file exists and is configured
- [ ] API key is set in `.env`
- [ ] Port 3001 (or configured port) is available
- [ ] User has Docker permissions: `docker ps`
- [ ] Dependencies are installed: `npm install`
- [ ] Code is built: `npm run build`

## Validation

Validate your configuration before starting:

```bash
npm run validate-env
```

This checks:
- Required environment variables are set
- Port is valid
- API key is present

## Testing the Daemon

After starting, test the daemon:

```bash
# Test health endpoint (no auth required)
curl http://localhost:3001/api/health

# Expected response: JSON with system metrics
```

Test with authentication:

```bash
# Replace YOUR_API_KEY with your actual API key
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3001/api/containers
```

## Stopping the Daemon

### If started with startup script or npm:
Press `Ctrl+C` in the terminal

### If running as systemd service:
```bash
sudo systemctl stop n8n-daemon
```

### If running with PM2:
```bash
pm2 stop n8n-daemon
```

## Troubleshooting Startup Issues

### "Port already in use"
```bash
# Check what's using the port
sudo lsof -i :3001

# Change port in .env file
nano .env
# Set PORT=3002 (or another available port)
```

### "Docker daemon not running"
```bash
# Start Docker
sudo systemctl start docker

# Verify Docker is running
docker info
```

### "Permission denied" accessing Docker
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and log back in, or:
newgrp docker
```

### ".env file not found"
```bash
# Create from example
cp .env.example .env

# Edit with your configuration
nano .env
```

### "Module not found" errors
```bash
# Install dependencies
npm install

# Rebuild
npm run build
```

## Environment Variables Reference

Required variables in `.env`:

```env
# Server port (default: 3001)
PORT=3001

# Environment mode
NODE_ENV=production

# API key for authentication (generate with: openssl rand -base64 32)
API_KEY=your-secure-api-key-here
```

Optional variables:

```env
# SSL/TLS configuration (recommended for production)
SSL_CERT_PATH=/path/to/cert.pem
SSL_KEY_PATH=/path/to/key.pem
```

## Monitoring

### Check if daemon is running:

**Systemd:**
```bash
sudo systemctl status n8n-daemon
```

**Process:**
```bash
ps aux | grep node
```

**Port:**
```bash
sudo lsof -i :3001
```

### View logs:

**Systemd:**
```bash
# Recent logs
sudo journalctl -u n8n-daemon -n 100

# Follow logs
sudo journalctl -u n8n-daemon -f

# Logs from today
sudo journalctl -u n8n-daemon --since today
```

**Direct start:**
Logs appear in the terminal where you started the daemon

## Quick Commands Reference

```bash
# Validate configuration
npm run validate-env

# Start with validation (development/testing)
./start-daemon.sh

# Start systemd service (production)
sudo systemctl start n8n-daemon

# Check service status
sudo systemctl status n8n-daemon

# View logs
sudo journalctl -u n8n-daemon -f

# Stop service
sudo systemctl stop n8n-daemon

# Restart service
sudo systemctl restart n8n-daemon

# Test health endpoint
curl http://localhost:3001/api/health

# Build project
npm run build

# Development mode with auto-reload
npm run dev
```

## Next Steps

After successfully starting the daemon:

1. **Register in Platform**: Add this server in the platform web interface
2. **Test Connection**: Platform should successfully connect to the daemon
3. **Create Test Instance**: Try creating an n8n instance from the platform
4. **Monitor Logs**: Watch logs during first operations
5. **Configure Firewall**: Restrict access to platform server only

## Getting Help

If you encounter issues:

1. Check this startup guide
2. Review [INSTALLATION.md](./INSTALLATION.md) for detailed setup
3. Check [README.md](./README.md) for general information
4. Validate environment: `npm run validate-env`
5. Check logs: `sudo journalctl -u n8n-daemon -f`
6. Verify Docker: `docker info`
7. Test connectivity: `curl http://localhost:3001/api/health`

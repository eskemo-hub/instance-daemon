# n8n Daemon

A lightweight Node.js service that runs on Linux host servers to orchestrate Docker containers for the n8n Instance Manager platform.

## Overview

The daemon is responsible for:
- Creating and managing n8n Docker containers
- Starting, stopping, and restarting containers
- Monitoring system health metrics
- Providing secure API endpoints for the platform to communicate with

## Requirements

- Node.js 18+
- Docker Engine installed and running
- Linux operating system

## Quick Start

### Remote Server Installation (One Command)

For quick installation on a remote server:

```bash
# Run this command on your remote server
curl -fsSL https://raw.githubusercontent.com/eskemo-hub/instance-daemon/main/install.sh | bash
```

*Note: This will install prerequisites, create the daemon user, clone the repository, and set up the service.*

### Development Setup

For local development:

1. Clone the repository:
```bash
git clone https://github.com/eskemo-hub/instance-daemon.git
cd instance-daemon
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Generate a secure API key:
```bash
openssl rand -base64 32
```

5. Configure your environment variables in `.env`:
   - `PORT`: Port for the daemon to listen on (default: 3001)
   - `API_KEY`: Secure API key for authentication with the platform (use the generated key)
   - `NODE_ENV`: Environment (development/production)

   See `.env.example` for detailed configuration options.

6. Validate your configuration:
```bash
npm run validate-env
```

## Production Installation

For production deployment with systemd service on a remote server:

### Prerequisites
- Ubuntu/Debian Linux server
- Git installed
- Node.js 18+ installed
- Docker and Docker Compose installed
- Root or sudo access

### Installation Steps

1. **Install prerequisites** (if not already installed):
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Git (if not installed)
sudo apt install git -y
```

2. **Create a dedicated user for the daemon**:
```bash
# Create system user (no login shell, no password needed)
sudo useradd -r -s /bin/false -d /opt/n8n-daemon -c "N8N Daemon User" n8n-daemon
sudo mkdir -p /opt/n8n-daemon
sudo chown n8n-daemon:n8n-daemon /opt/n8n-daemon
```

3. **Clone the repository**:
```bash
# Clone as admin user, then fix ownership
sudo git clone https://github.com/eskemo-hub/instance-daemon.git /opt/n8n-daemon/daemon
sudo chown -R n8n-daemon:n8n-daemon /opt/n8n-daemon/daemon
```

4. **Install dependencies and build**:
```bash
# Navigate to daemon directory
cd /opt/n8n-daemon/daemon

# Install and build as daemon user (no password required)
sudo -u n8n-daemon npm install
sudo -u n8n-daemon npm run build
```

5. **Configure environment variables**:
```bash
# Copy and configure environment file as daemon user
sudo -u n8n-daemon cp .env.example .env

# Generate a secure API key
openssl rand -base64 32

# Edit the .env file (as admin user for nano access)
sudo nano .env
```

6. **Install and start the systemd service**:
```bash
# Install the systemd service
sudo cp /opt/n8n-daemon/daemon/n8n-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable n8n-daemon
sudo systemctl start n8n-daemon

# Check service status
sudo systemctl status n8n-daemon
```

## Development

Run in development mode with auto-reload:
```bash
npm run dev
```

## Production

Build the TypeScript code:
```bash
npm run build
```

### Option 1: Using the Startup Script

Use the provided startup script for quick manual starts:
```bash
./start-daemon.sh
```

The script will:
- Validate environment configuration
- Check prerequisites (Node.js, Docker)
- Build if necessary
- Start the daemon

### Option 2: Direct Start

Start the daemon directly:
```bash
npm start
```

### Option 3: Systemd Service (Recommended)

For production deployment with automatic startup and monitoring, use systemd:

1. Follow the production installation steps above to set up the systemd service
2. Manage the service with systemctl:
```bash
sudo systemctl start n8n-daemon
sudo systemctl status n8n-daemon
sudo systemctl enable n8n-daemon  # Auto-start on boot
```

### Option 4: PM2 Process Manager

Alternative to systemd, you can use PM2:
```bash
npm install -g pm2
pm2 start dist/index.js --name n8n-daemon
pm2 save
pm2 startup
```

## Documentation

This README contains all the necessary information for setting up and running the n8n daemon. For additional configuration details, see the environment variable examples in `.env.example`.

## Project Structure

```
daemon/
├── src/
│   ├── index.ts              # Main entry point
│   ├── middleware/           # Express middleware
│   ├── routes/               # API route handlers
│   ├── services/             # Business logic services
│   ├── types/                # TypeScript type definitions
│   └── utils/                # Utility functions
├── .env.example              # Example environment configuration
├── .gitignore                # Git ignore rules
├── n8n-daemon.service        # Systemd service file
├── n8n-daemon-update.service # Systemd update service file
├── package.json              # NPM package configuration
├── README.md                 # This documentation
├── setup-update-permissions.sh # Script to setup update permissions
├── start-daemon.sh           # Startup script with validation
├── tsconfig.json             # TypeScript configuration
└── update-from-github.sh     # GitHub update script
```

## API Endpoints

### Health Check (Public)
- `GET /api/health` - Get system health metrics

### Container Management (Protected)
All container endpoints require `x-api-key` header for authentication.

- `POST /api/containers` - Create new n8n container
- `POST /api/containers/:id/start` - Start container
- `POST /api/containers/:id/stop` - Stop container
- `POST /api/containers/:id/restart` - Restart container
- `DELETE /api/containers/:id` - Remove container
- `GET /api/containers/:id/status` - Get container status

## Security

- All container management endpoints require API key authentication
- API key must be passed in the `x-api-key` header
- Use HTTPS in production (configure SSL_CERT_PATH and SSL_KEY_PATH)
- Restrict network access to the daemon port using firewall rules

## Firewall Configuration

Allow access only from the platform server:
```bash
# Example using ufw
sudo ufw allow from <platform-server-ip> to any port 3001
```

## Troubleshooting

### Docker Socket Permission
If you get permission errors accessing Docker, ensure the user running the daemon has access to the Docker socket:
```bash
sudo usermod -aG docker $USER
```

### Port Already in Use
If port 3001 is already in use, change the PORT in your `.env` file.

## License

MIT

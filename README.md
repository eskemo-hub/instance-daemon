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

For development:

1. Clone or copy the daemon directory to your host server

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

For production deployment with systemd service:

1. Install Node.js 18+ and Docker on your Linux server
2. Create a dedicated user for the daemon:
```bash
sudo useradd -r -s /bin/bash -d /opt/n8n-daemon n8n-daemon
sudo mkdir -p /opt/n8n-daemon
sudo chown n8n-daemon:n8n-daemon /opt/n8n-daemon
```

3. Copy the daemon files to `/opt/n8n-daemon/daemon/`
4. Install dependencies and build:
```bash
cd /opt/n8n-daemon/daemon
npm install
npm run build
```

5. Configure environment variables in `.env`
6. Install the systemd service:
```bash
sudo cp n8n-daemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable n8n-daemon
sudo systemctl start n8n-daemon
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

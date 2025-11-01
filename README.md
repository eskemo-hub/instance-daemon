# n8n Daemon

A standalone daemon service for managing n8n instances with Docker containers, providing REST API endpoints for container management, monitoring, and updates.

## Features

- **Container Management**: Start, stop, restart, and monitor n8n Docker containers
- **Health Monitoring**: Real-time health checks and uptime monitoring
- **Backup & Restore**: Automated backup and restore functionality
- **Certificate Management**: SSL certificate handling and renewal
- **API Key Authentication**: Secure API access with key-based authentication
- **HAProxy Integration**: Load balancing and reverse proxy configuration
- **Auto-Updates**: GitHub-based automatic updates
- **Logging & Stats**: Container logs and performance statistics

## Quick Installation

### Prerequisites

- Ubuntu/Debian Linux server
- Docker and Docker Compose installed
- Node.js 18+ installed
- Root or sudo access

### Install from GitHub

```bash
# Set your GitHub token (required for private repositories)
export GITHUB_TOKEN=your_github_token_here

# Download and run the installation script
curl -fsSL https://raw.githubusercontent.com/eskemo-hub/instance-daemon/main/install-from-github.sh | sudo -E bash
```

## Development Setup

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

   See [../ENVIRONMENT.md](../ENVIRONMENT.md) for detailed configuration guide.

6. Validate your configuration:
```bash
npm run validate-env
```

## Production Installation

For production deployment with systemd service, see the detailed [INSTALLATION.md](./INSTALLATION.md) guide which covers:
- System prerequisites and dependencies
- User and permission setup
- Systemd service configuration
- Firewall and SSL/TLS setup
- Service management and monitoring
- Troubleshooting and maintenance

## Starting the Daemon

See [STARTUP.md](./STARTUP.md) for a quick reference guide on different startup methods.

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

1. Follow the [INSTALLATION.md](./INSTALLATION.md) guide to set up the systemd service
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

- **[README.md](./README.md)** - This file, overview and quick start
- **[INSTALLATION.md](./INSTALLATION.md)** - Detailed production installation guide
- **[STARTUP.md](./STARTUP.md)** - Quick reference for starting and managing the daemon
- **[../ENVIRONMENT.md](../ENVIRONMENT.md)** - Environment variable configuration guide

## Project Structure

```
daemon/
├── src/
│   ├── index.ts              # Main entry point
│   ├── middleware/           # Express middleware
│   │   ├── auth.middleware.ts    # API key authentication
│   │   └── error.middleware.ts   # Error handling
│   ├── routes/               # API route handlers
│   │   ├── container.routes.ts   # Container management endpoints
│   │   └── health.routes.ts      # Health check endpoints
│   ├── services/             # Business logic services
│   │   ├── docker.service.ts     # Docker operations
│   │   └── health.service.ts     # System health metrics
│   └── utils/                # Utility functions
│       ├── env-validation.ts     # Environment validation
│       └── validate-env-cli.ts   # CLI validation tool
├── dist/                     # Compiled JavaScript (generated)
├── node_modules/             # Dependencies (generated)
├── .env.example              # Example environment configuration
├── .gitignore                # Git ignore rules
├── INSTALLATION.md           # Production installation guide
├── n8n-daemon.service        # Systemd service file
├── package.json              # NPM package configuration
├── README.md                 # This file
├── start-daemon.sh           # Startup script with validation
├── STARTUP.md                # Startup guide and reference
└── tsconfig.json             # TypeScript configuration
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

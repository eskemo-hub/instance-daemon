# Daemon Setup Guide

## Prerequisites

- Node.js 18+ installed
- Docker installed and running
- Systemd (for service management)
- Sufficient disk space for backups

## Installation Steps

### 1. Install Dependencies

```bash
cd daemon
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
nano .env
```

Required environment variables:
- `PORT`: Port for daemon to listen on (default: 3001)
- `API_KEY`: Secure API key for authentication (generate with: `openssl rand -base64 32`)
- `BACKUP_DIR`: Directory for database backups (default: `/var/lib/grumpy-wombat/backups`)

### 3. Setup Backup Directory

Run the setup script to create the backup directory with proper permissions:

```bash
./setup-backup-dir.sh
```

Or manually:

```bash
sudo mkdir -p /var/lib/grumpy-wombat/backups
sudo chown -R $USER:$USER /var/lib/grumpy-wombat/backups
sudo chmod -R 750 /var/lib/grumpy-wombat/backups
```

**Important**: The daemon must run as a user with access to this directory.

### 4. Build the Daemon

```bash
npm run build
```

### 5. Setup Systemd Service

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/grumpy-wombat-daemon.service
```

Example service file:

```ini
[Unit]
Description=Grumpy Wombat Daemon
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/daemon
EnvironmentFile=/path/to/daemon/.env
ExecStart=/usr/bin/node /path/to/daemon/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Replace:
- `your-user` with the user that has Docker access
- `/path/to/daemon` with the actual daemon directory path

### 6. Start the Daemon

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable daemon to start on boot
sudo systemctl enable grumpy-wombat-daemon

# Start the daemon
sudo systemctl start grumpy-wombat-daemon

# Check status
sudo systemctl status grumpy-wombat-daemon
```

## Backup Directory Structure

Backups are organized by instance ID:

```
/var/lib/grumpy-wombat/backups/
├── {instance-id-1}/
│   ├── postgresql_mydb_2024-01-15T10-30-00.sql
│   └── postgresql_mydb_2024-01-16T10-30-00.sql
├── {instance-id-2}/
│   └── mysql_appdb_2024-01-15T11-00-00.sql
└── ...
```

This structure ensures:
- **Isolation**: Each instance's backups are in separate directories
- **Organization**: Easy to find and manage backups per instance
- **Security**: Permissions can be set per instance if needed

## Backup Retention

- Backups are automatically cleaned up based on the retention policy set in the main platform
- Default retention is typically 30 days
- Ensure sufficient disk space for your backup retention period

## Monitoring

View daemon logs:

```bash
# View recent logs
sudo journalctl -u grumpy-wombat-daemon -n 100

# Follow logs in real-time
sudo journalctl -u grumpy-wombat-daemon -f
```

## Troubleshooting

### Backup Directory Permission Errors

If you see `ENOENT: no such file or directory` errors:

1. Ensure the backup directory exists:
   ```bash
   ls -la /var/lib/grumpy-wombat/backups
   ```

2. Check permissions:
   ```bash
   sudo chown -R $USER:$USER /var/lib/grumpy-wombat/backups
   sudo chmod -R 750 /var/lib/grumpy-wombat/backups
   ```

3. Verify the daemon user has access:
   ```bash
   sudo -u daemon-user ls /var/lib/grumpy-wombat/backups
   ```

### Docker Permission Errors

Ensure the daemon user is in the docker group:

```bash
sudo usermod -aG docker your-user
```

Then restart the daemon:

```bash
sudo systemctl restart grumpy-wombat-daemon
```

## Security Best Practices

1. **API Key**: Use a strong, randomly generated API key
2. **Backup Directory**: Restrict access to backup directory (750 permissions)
3. **Firewall**: Only allow daemon port access from the main platform server
4. **Updates**: Keep the daemon updated with security patches
5. **Monitoring**: Regularly monitor daemon logs for suspicious activity

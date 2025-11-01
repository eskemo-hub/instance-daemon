#!/bin/bash

# Setup script for Grumpy Wombat Daemon backup directory
# This script creates the backup directory with proper permissions

set -e

# Default backup directory
BACKUP_DIR="${BACKUP_DIR:-/var/lib/grumpy-wombat/backups}"

echo "Setting up backup directory: $BACKUP_DIR"

# Create backup directory with recursive flag
sudo mkdir -p "$BACKUP_DIR"

# Set ownership to current user (daemon should run as this user)
sudo chown -R $USER:$USER "$BACKUP_DIR"

# Set permissions: owner can read/write/execute, group can read/execute
sudo chmod -R 750 "$BACKUP_DIR"

echo "✓ Backup directory created successfully"
echo "  Location: $BACKUP_DIR"
echo "  Owner: $USER"
echo "  Permissions: 750 (rwxr-x---)"
echo ""
echo "Note: Ensure the daemon runs as user '$USER' to access this directory"

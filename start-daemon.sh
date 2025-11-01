#!/bin/bash

# n8n Daemon Startup Script
# This script starts the n8n daemon service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${GREEN}Starting n8n Daemon...${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file based on .env.example"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18+ before running the daemon"
    exit 1
fi

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    echo "Please install Docker before running the daemon"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}Error: Docker daemon is not running${NC}"
    echo "Please start Docker before running the daemon"
    exit 1
fi

# Check if dist directory exists (built code)
if [ ! -d "dist" ]; then
    echo -e "${YELLOW}Warning: dist directory not found. Building...${NC}"
    npm run build
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found. Installing dependencies...${NC}"
    npm install
fi

# Validate environment variables
echo "Validating environment configuration..."
npm run validate-env

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Environment validation failed${NC}"
    exit 1
fi

# Start the daemon
echo -e "${GREEN}Starting daemon...${NC}"
npm start

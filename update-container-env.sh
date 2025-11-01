#!/bin/bash

# Update existing n8n containers with recommended environment variables

echo "=== Update n8n Container Environment Variables ==="
echo ""
echo "This will update existing containers with recommended settings"
echo "to remove deprecation warnings."
echo ""

# Get all n8n containers
containers=$(docker ps -a --filter "ancestor=n8nio/n8n:latest" --format "{{.Names}}")

if [ -z "$containers" ]; then
    echo "No n8n containers found."
    exit 0
fi

echo "Found containers:"
echo "$containers"
echo ""

read -p "Update these containers? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

for container in $containers; do
    echo "Updating $container..."
    
    # Get current environment
    current_env=$(docker inspect $container --format '{{range .Config.Env}}{{println .}}{{end}}')
    
    # Stop container
    docker stop $container
    
    # Get container details
    image=$(docker inspect $container --format '{{.Config.Image}}')
    port_mapping=$(docker inspect $container --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}}->{{(index $conf 0).HostPort}} {{end}}')
    volume=$(docker inspect $container --format '{{range .Mounts}}{{.Name}}{{end}}')
    
    # Extract host port
    host_port=$(echo $port_mapping | grep -oP '\d+(?=\s|$)' | head -1)
    
    # Remove old container
    docker rm $container
    
    # Create new container with updated env
    docker run -d \
        --name $container \
        --restart unless-stopped \
        -p ${host_port}:5678 \
        -v ${volume}:/home/node/.n8n \
        -e N8N_PORT=5678 \
        -e N8N_PROTOCOL=http \
        -e WEBHOOK_URL=http://localhost:5678/ \
        -e DB_SQLITE_POOL_SIZE=5 \
        -e N8N_RUNNERS_ENABLED=true \
        -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
        -e N8N_GIT_NODE_DISABLE_BARE_REPOS=true \
        $image
    
    echo "✓ $container updated"
    echo ""
done

echo "All containers updated!"
echo ""
echo "Check status:"
echo "  docker ps"
echo ""
echo "Check logs:"
echo "  docker logs <container-name>"

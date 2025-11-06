import Docker, { Container } from 'dockerode';
import { ComposeStackConfig, ComposeStackInfo } from '../types';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * ComposeStackService handles Docker Compose stack operations
 * Uses docker compose CLI commands for stack management
 */
export class ComposeStackService {
  private docker: Docker;
  private readonly COMPOSE_DIR = '/opt/n8n-daemon/compose';

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    // Ensure compose directory exists
    if (!fs.existsSync(this.COMPOSE_DIR)) {
      fs.mkdirSync(this.COMPOSE_DIR, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Create a new Docker Compose stack
   */
  async createStack(config: ComposeStackConfig): Promise<ComposeStackInfo> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, config.name);
      
      // Create stack directory
      if (!fs.existsSync(stackDir)) {
        fs.mkdirSync(stackDir, { recursive: true, mode: 0o755 });
      }

      // Process and enhance compose file with Traefik labels and environment variables
      let composeContent = config.composeFile;
      let composeData: any = {};
      
      try {
        // Try to parse as YAML
        composeData = yaml.load(composeContent) as any;
        
        // If Traefik is enabled, add labels to services
        if (config.useTraefik && config.domain && config.subdomain) {
          composeData = this.addTraefikLabels(
            composeData, 
            config.domain, 
            config.subdomain, 
            config.port,
            config.traefikConfig
          );
        }
        
        // Add environment variables to services if provided
        if (config.environment && Object.keys(config.environment).length > 0) {
          composeData = this.addEnvironmentVariables(composeData, config.environment);
        }
        
        // Add resource limits to services if provided
        if (config.cpuLimit || config.memoryLimit || config.memoryReservation) {
          composeData = this.addResourceLimits(composeData, config);
        }
        
        // Convert back to YAML
        composeContent = yaml.dump(composeData, { 
          lineWidth: -1,
          noRefs: true,
          quotingType: '"'
        });
      } catch (error) {
        // If YAML parsing fails, use original content (might be a template)
        console.warn(`[COMPOSE] Could not parse compose file as YAML, using as-is: ${this.getErrorMessage(error)}`);
      }

      // Write compose file
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');
      fs.writeFileSync(composeFilePath, composeContent, { mode: 0o644 });

      // Check if compose file references kong.yml and create it if needed
      if (composeContent.includes('kong.yml') || composeContent.includes('./kong.yml')) {
        const kongYmlPath = path.join(stackDir, 'kong.yml');
        if (!fs.existsSync(kongYmlPath)) {
          // Create default kong.yml for Supabase
          const anonKey = config.environment?.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOuoJeHxjNa-WQwfzwR4HcgJSUfpVfKXfVww';
          const serviceKey = config.environment?.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
          const defaultKongYml = `_format_version: "1.1"

consumers:
  - username: anon
    keyauth_credentials:
      - key: ${anonKey}
  - username: service_role
    keyauth_credentials:
      - key: ${serviceKey}

acls:
  - consumer: anon
    group: anon
  - consumer: service_role
    group: admin

services:
  - name: auth-v1-open
    url: http://auth:9999/verify
    routes:
      - name: auth-v1-open
        strip_path: true
        paths:
          - /auth/v1/verify
    plugins:
      - name: cors
  - name: auth-v1-open-callback
    url: http://auth:9999/callback
    routes:
      - name: auth-v1-open-callback
        strip_path: true
        paths:
          - /auth/v1/callback
    plugins:
      - name: cors
  - name: auth-v1-open-authorize
    url: http://auth:9999/authorize
    routes:
      - name: auth-v1-open-authorize
        strip_path: true
        paths:
          - /auth/v1/authorize
    plugins:
      - name: cors
  - name: rest-v1
    url: http://rest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: graphql-v1
    url: http://rest:3000/rpc/graphql
    routes:
      - name: graphql-v1
        strip_path: true
        paths:
          - /graphql/v1
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: request-transformer
        config:
          add:
            headers:
              - Content-Profile:graphql_public
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: auth-v1
    url: http://auth:9999/
    routes:
      - name: auth-v1-all
        strip_path: true
        paths:
          - /auth/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: realtime-v1
    url: http://realtime:4000/socket/
    routes:
      - name: realtime-v1-all
        strip_path: true
        paths:
          - /realtime/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: storage-v1
    url: http://storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: functions-v1
    url: http://functions:9000/
    routes:
      - name: functions-v1-all
        strip_path: true
        paths:
          - /functions/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
            - anon
  - name: analytics-v1
    url: http://analytics:4000/
    routes:
      - name: analytics-v1-all
        strip_path: true
        paths:
          - /analytics/v1/
  - name: meta
    url: http://meta:8080/
    routes:
      - name: meta-all
        strip_path: true
        paths:
          - /pg/
    plugins:
      - name: key-auth
        config:
          hide_credentials: false
      - name: acl
        config:
          hide_groups_header: true
          allow:
            - admin
`;
          fs.writeFileSync(kongYmlPath, defaultKongYml, { mode: 0o644 });
          console.log(`[COMPOSE] Created default kong.yml file for stack: ${config.name}`);
        }
      }

      // Process environment variables and create .env file if needed
      // Docker Compose automatically reads .env files from the same directory as the compose file
      if (config.environment && Object.keys(config.environment).length > 0) {
        const envContent = Object.entries(config.environment)
          .map(([key, value]) => {
            // Escape values that might contain special characters
            // If value contains spaces, quotes, or special chars, wrap in quotes
            if (typeof value === 'string' && (value.includes(' ') || value.includes('"') || value.includes('$'))) {
              // Escape quotes and wrap in quotes
              const escapedValue = value.replace(/"/g, '\\"');
              return `${key}="${escapedValue}"`;
            }
            return `${key}=${value}`;
          })
          .join('\n');
        const envFilePath = path.join(stackDir, '.env');
        fs.writeFileSync(envFilePath, envContent, { mode: 0o644 });
        console.log(`[COMPOSE] Created .env file with ${Object.keys(config.environment).length} variables`);
      }

      // Resolve volume path if template is provided
      let volumePath = config.volumeName;
      if (config.volumePathTemplate) {
        // Replace template variables (e.g., ${INSTANCE_ID})
        volumePath = config.volumePathTemplate.replace(/\$\{(\w+)\}/g, (match, key) => {
          return config.environment?.[key] || match;
        });
      }

      // Create Docker volume if it doesn't exist
      try {
        await this.createVolumeIfNeeded(volumePath);
      } catch (error) {
        console.warn(`Warning: Could not create volume ${volumePath}:`, error);
      }

      // Run docker compose up in detached mode to create the stack
      // We use `docker compose` (v2) which is the modern way
      const composeCommand = `docker compose -f "${composeFilePath}" -p "${config.name}" up -d`;
      console.log(`[COMPOSE] Creating stack: ${config.name}`);
      console.log(`[COMPOSE] Command: ${composeCommand}`);

      try {
        execSync(composeCommand, {
          cwd: stackDir,
          stdio: 'pipe',
          env: { ...process.env, ...config.environment },
          timeout: 300000 // 5 minutes timeout for large containers
        });
      } catch (error: any) {
        const errorMessage = error.stdout?.toString() || error.stderr?.toString() || error.message;
        
        // Cleanup any partially created containers
        console.log(`[COMPOSE] Deployment failed, cleaning up any partially created containers for stack: ${config.name}`);
        try {
          await this.removeStack(config.name, false);
          console.log(`[COMPOSE] Cleaned up partially created stack: ${config.name}`);
        } catch (cleanupError) {
          // Log cleanup errors but don't fail on them - the original error is more important
          console.warn(`[COMPOSE] Failed to cleanup partially created stack (this is okay): ${this.getErrorMessage(cleanupError)}`);
        }
        
        // Check for port conflicts and provide clearer error message
        if (errorMessage.includes('port is already allocated') || errorMessage.includes('port is already in use')) {
          throw new Error(`Port conflict: ${errorMessage}. Please check if another container is using the same port.`);
        }
        
        // Check for DNS errors
        if (errorMessage.includes('getaddrinfo') || errorMessage.includes('EAI_AGAIN')) {
          throw new Error(`DNS lookup failed: ${errorMessage}. Please check your compose file for invalid hostnames or network configuration.`);
        }
        
        throw new Error(`Failed to create compose stack: ${errorMessage}`);
      }

      // Get stack status (with error handling to prevent crashes)
      let stackInfo: ComposeStackInfo;
      try {
        stackInfo = await this.getStackStatus(config.name);
      } catch (error) {
        // If getting stack status fails, still return a basic status
        console.warn(`[COMPOSE] Could not get full stack status for ${config.name}:`, error);
        stackInfo = {
          name: config.name,
          status: 'unknown',
          services: []
        };
      }
      return stackInfo;
    } catch (error) {
      throw new Error(`Failed to create compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Start a Docker Compose stack
   */
  async startStack(stackName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" start`;
      console.log(`[COMPOSE] Starting stack: ${stackName}`);

      execSync(composeCommand, {
        cwd: stackDir,
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to start compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Stop a Docker Compose stack
   */
  async stopStack(stackName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" stop`;
      console.log(`[COMPOSE] Stopping stack: ${stackName}`);

      execSync(composeCommand, {
        cwd: stackDir,
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to stop compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Restart a Docker Compose stack
   */
  async restartStack(stackName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" restart`;
      console.log(`[COMPOSE] Restarting stack: ${stackName}`);

      execSync(composeCommand, {
        cwd: stackDir,
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to restart compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Remove a Docker Compose stack
   */
  async removeStack(stackName: string, removeVolumes: boolean = false): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        // Stack might already be removed, check if containers exist
        const containers = await this.getStackContainers(stackName);
        if (containers.length === 0) {
          console.log(`[COMPOSE] Stack ${stackName} not found or already removed`);
          return;
        }
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" down${removeVolumes ? ' -v' : ''}`;
      console.log(`[COMPOSE] Removing stack: ${stackName} (removeVolumes: ${removeVolumes})`);

      try {
        execSync(composeCommand, {
          cwd: stackDir,
          stdio: 'pipe'
        });
      } catch (error: any) {
        // If compose file doesn't exist but containers do, try to remove containers directly
        if (!fs.existsSync(composeFilePath)) {
          console.log(`[COMPOSE] Compose file not found, removing containers directly`);
          await this.removeStackContainers(stackName, removeVolumes);
        } else {
          throw error;
        }
      }

      // Clean up stack directory
      if (fs.existsSync(stackDir)) {
        fs.rmSync(stackDir, { recursive: true, force: true });
      }
    } catch (error) {
      throw new Error(`Failed to remove compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Docker Compose stack status
   */
  async getStackStatus(stackName: string): Promise<ComposeStackInfo> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      // Get containers for this stack
      const containers = await this.getStackContainers(stackName);

      if (containers.length === 0) {
        return {
          name: stackName,
          status: 'stopped',
          services: []
        };
      }

      // Get container statuses
      const services = await Promise.all(
        containers.map(async (container) => {
          try {
            const containerInfo = await container.inspect();
            const isRunning = containerInfo.State.Running;
            const isHealthy = containerInfo.State.Health?.Status === 'healthy' || isRunning;

            return {
              name: containerInfo.Name.replace(/^\//, '').replace(/^.*_/, ''), // Extract service name
              status: isRunning ? 'running' : 'stopped' as 'running' | 'stopped' | 'error',
              ready: isHealthy
            };
          } catch (error) {
            // Fallback: use container ID if inspect fails
            const containerId = container.id || 'unknown';
            return {
              name: containerId.substring(0, 12), // Use short container ID
              status: 'error' as 'running' | 'stopped' | 'error',
              ready: false
            };
          }
        })
      );

      // Determine overall stack status
      const runningServices = services.filter(s => s.status === 'running');
      const totalServices = services.length;
      let stackStatus = 'stopped';
      
      if (runningServices.length === totalServices && totalServices > 0) {
        stackStatus = 'running';
      } else if (runningServices.length > 0) {
        stackStatus = 'partial';
      }

      return {
        name: stackName,
        status: stackStatus,
        services
      };
    } catch (error) {
      throw new Error(`Failed to get stack status: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Docker Compose stack logs
   */
  async getStackLogs(
    stackName: string,
    options: {
      lines?: number;
      follow?: boolean;
      service?: string;
      container?: string;
    } = {}
  ): Promise<string[]> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      // If a specific container is requested, use docker logs directly
      if (options.container) {
        try {
          // Try to find the container by name (full container name from getStackContainersInfo)
          const containers = await this.docker.listContainers({ all: true });
          const container = containers.find(c => {
            const containerName = c.Names[0]?.replace(/^\//, '') || '';
            // Match exact container name
            return containerName === options.container;
          });

          if (container) {
            const dockerContainer = this.docker.getContainer(container.Id);
            const logs = await dockerContainer.logs({
              stdout: true,
              stderr: true,
              tail: options.lines || 100,
              timestamps: true
            });
            
            // Format logs with container name prefix to match compose format
            const containerName = container.Names[0]?.replace(/^\//, '') || options.container;
            const logLines = logs.toString().split('\n')
              .filter(line => line.trim().length > 0)
              .map(line => {
                // Docker logs include 8-byte header, remove it if present
                const cleanLine = line.replace(/^[\x00-\x08]/, '');
                // Add container name prefix to match compose format
                return `${containerName}  | ${cleanLine}`;
              });
            return logLines;
          }
        } catch (containerError) {
          // If container-specific logging fails, fall through to compose logs
          console.warn(`[COMPOSE] Failed to get logs for container ${options.container}, falling back to compose logs: ${this.getErrorMessage(containerError)}`);
        }
      }

      // Use docker compose logs for service-level or all logs
      let composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" logs`;
      
      if (options.lines) {
        composeCommand += ` --tail ${options.lines}`;
      }
      
      if (options.service) {
        composeCommand += ` ${options.service}`;
      }

      if (options.follow) {
        // For follow mode, we'd need to stream, but for now return recent logs
        composeCommand += ` --tail 100`;
      }

      const { stdout } = await execAsync(composeCommand, {
        cwd: stackDir
      });

      // Parse logs into array
      const logLines = stdout.split('\n').filter(line => line.trim().length > 0);
      return logLines;
    } catch (error) {
      throw new Error(`Failed to get stack logs: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Docker Compose stack metrics
   */
  async getStackMetrics(stackName: string): Promise<{
    services: Array<{
      name: string;
      cpuPercent: number;
      memoryUsed: number;
      memoryLimit: number;
      memoryPercent: number;
      networkRx: number;
      networkTx: number;
    }>;
  }> {
    try {
      const containers = await this.getStackContainers(stackName);
      
      const services = await Promise.all(
        containers.map(async (container) => {
          try {
            const containerInfo = await container.inspect();
            const stats = await container.stats({ stream: false });
            
            // Calculate CPU percentage
            const cpuPercent = this.calculateCpuPercent(stats);
            
            // Memory metrics - use container's configured limit if set
            const memoryUsed = stats.memory_stats?.usage || 0;
            let memoryLimit = stats.memory_stats?.limit || 0;
            let hasMemoryLimit = false;
            
            // Check if container has a memory limit configured
            const configuredMemoryLimit = containerInfo.HostConfig?.Memory;
            if (configuredMemoryLimit && configuredMemoryLimit > 0) {
              memoryLimit = configuredMemoryLimit;
              hasMemoryLimit = true;
            } else {
              // No limit set - return 0 to indicate unlimited
              hasMemoryLimit = false;
              memoryLimit = 0;
            }
            
            const memoryPercent = hasMemoryLimit && memoryLimit > 0 
              ? (memoryUsed / memoryLimit) * 100 
              : 0;
            
            // Network metrics
            let networkRx = 0;
            let networkTx = 0;
            if (stats.networks) {
              for (const network of Object.values(stats.networks)) {
                networkRx += (network as any).rx_bytes || 0;
                networkTx += (network as any).tx_bytes || 0;
              }
            }

            const serviceName = containerInfo.Name.replace(/^\//, '').replace(/^.*_/, '');

            return {
              name: serviceName,
              cpuPercent,
              memoryUsed,
              memoryLimit: hasMemoryLimit ? memoryLimit : 0, // Return 0 if no limit
              memoryPercent,
              networkRx,
              networkTx
            };
          } catch (error) {
            const containerInfo = await container.inspect();
            const serviceName = containerInfo.Name.replace(/^\//, '').replace(/^.*_/, '');
            
            return {
              name: serviceName,
              cpuPercent: 0,
              memoryUsed: 0,
              memoryLimit: 0,
              memoryPercent: 0,
              networkRx: 0,
              networkTx: 0
            };
          }
        })
      );

      return { services };
    } catch (error) {
      throw new Error(`Failed to get stack metrics: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get containers for a stack by project name
   */
  private async getStackContainers(stackName: string): Promise<Container[]> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const stackContainers = containers
        .filter(container => {
          // Docker Compose uses project name prefix for containers
          // Format: {project}_{service}_{number}
          const containerName = container.Names[0]?.replace(/^\//, '') || '';
          return containerName.startsWith(`${stackName}_`);
        })
        .map(container => this.docker.getContainer(container.Id));

      return stackContainers;
    } catch (error) {
      throw new Error(`Failed to list stack containers: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get container information for a stack
   * Returns list of containers with their names, IDs, and status
   */
  async getStackContainersInfo(stackName: string): Promise<Array<{
    id: string;
    name: string;
    status: string;
    service?: string;
  }>> {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const stackContainers = containers
        .filter(container => {
          const containerName = container.Names[0]?.replace(/^\//, '') || '';
          return containerName.startsWith(`${stackName}_`);
        })
        .map(container => {
          const containerName = container.Names[0]?.replace(/^\//, '') || '';
          // Extract service name from container name (format: {project}_{service}_{number})
          const parts = containerName.split('_');
          const service = parts.length > 1 ? parts.slice(1, -1).join('_') : undefined;
          
          return {
            id: container.Id,
            name: containerName,
            status: container.State || 'unknown',
            service
          };
        });

      return stackContainers;
    } catch (error) {
      throw new Error(`Failed to get stack containers info: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Remove stack containers directly (fallback when compose file is missing)
   */
  private async removeStackContainers(stackName: string, removeVolumes: boolean): Promise<void> {
    const containers = await this.getStackContainers(stackName);
    
    for (const container of containers) {
      try {
        const containerInfo = await container.inspect();
        // Stop container if running
        if (containerInfo.State.Running) {
          await container.stop();
        }
        // Remove container
        await container.remove({ v: removeVolumes });
      } catch (error) {
        console.warn(`Failed to remove container ${container.id}:`, error);
      }
    }
  }

  /**
   * Create Docker volume if it doesn't exist
   */
  private async createVolumeIfNeeded(volumeName: string): Promise<void> {
    // Check if this is a host path (starts with /) vs a Docker volume name
    if (volumeName.startsWith('/')) {
      // This is a host path (bind mount), create directory structure
      try {
        const hostDir = path.resolve(volumeName);
        if (!fs.existsSync(hostDir)) {
          console.log(`[COMPOSE] Creating host directory: ${hostDir}`);
          fs.mkdirSync(hostDir, { recursive: true, mode: 0o755 });
          
          // Set proper ownership if running as root (common in daemon environments)
          try {
            // Try to set ownership to 1000:1000 (common Docker user)
            execSync(`chown -R 1000:1000 "${hostDir}"`, { stdio: 'ignore' });
            console.log(`[COMPOSE] Set ownership of ${hostDir} to 1000:1000`);
          } catch (chownError) {
            // Continue anyway - the directory was created with proper mode
            console.warn(`[COMPOSE] Could not set ownership for ${hostDir}: ${chownError}`);
          }
        } else {
          console.log(`[COMPOSE] Host directory already exists: ${hostDir}`);
        }
      } catch (error) {
        // Don't throw - host directory creation is not critical if it fails
        // The compose command will handle it or fail with a clearer error
        console.warn(`[COMPOSE] Could not create host directory ${volumeName}:`, error);
      }
    } else {
      // This is a Docker volume name, try to create Docker volume
      try {
        const volume = this.docker.getVolume(volumeName);
        await volume.inspect();
        // Volume exists
        console.log(`[COMPOSE] Volume already exists: ${volumeName}`);
      } catch (error: any) {
        if (error.statusCode === 404) {
          // Volume doesn't exist, create it
          try {
            await this.docker.createVolume({ Name: volumeName });
            console.log(`[COMPOSE] Created Docker volume: ${volumeName}`);
          } catch (createError: any) {
            // Handle HTTP 301 and other Docker API errors gracefully
            if (createError.statusCode === 301 || createError.statusCode >= 400) {
              console.warn(`[COMPOSE] Could not create Docker volume ${volumeName}:`, createError.message);
              // Don't throw - volume creation might be handled by compose file itself
            } else {
              throw createError;
            }
          }
        } else {
          // For other errors (like 301), log but don't throw
          console.warn(`[COMPOSE] Could not inspect Docker volume ${volumeName}:`, error.message);
        }
      }
    }
  }

  /**
   * Calculate CPU percentage from Docker stats
   */
  private calculateCpuPercent(stats: any): number {
    if (!stats.cpu_stats || !stats.precpu_stats) {
      return 0;
    }

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || 1;

    if (systemDelta > 0 && cpuDelta > 0) {
      return (cpuDelta / systemDelta) * numCpus * 100;
    }

    return 0;
  }

  /**
   * Restart a specific service in a stack
   */
  async restartService(stackName: string, serviceName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" restart ${serviceName}`;
      console.log(`[COMPOSE] Restarting service ${serviceName} in stack: ${stackName}`);

      execSync(composeCommand, {
        cwd: stackDir,
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to restart service ${serviceName}: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Start a specific service in a stack
   */
  async startService(stackName: string, serviceName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" start ${serviceName}`;
      console.log(`[COMPOSE] Starting service ${serviceName} in stack: ${stackName}`);

      execSync(composeCommand, {
        cwd: stackDir,
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to start service ${serviceName}: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Stop a specific service in a stack
   */
  async stopService(stackName: string, serviceName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" stop ${serviceName}`;
      console.log(`[COMPOSE] Stopping service ${serviceName} in stack: ${stackName}`);

      execSync(composeCommand, {
        cwd: stackDir,
        stdio: 'pipe'
      });
    } catch (error) {
      throw new Error(`Failed to stop service ${serviceName}: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get list of services in a stack
   */
  async getStackServices(stackName: string): Promise<string[]> {
    try {
      const stackInfo = await this.getStackStatus(stackName);
      return stackInfo.services.map(s => s.name);
    } catch (error) {
      throw new Error(`Failed to get stack services: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Add Traefik labels to services in compose file
   */
  private addTraefikLabels(
    composeData: any, 
    domain: string, 
    subdomain: string, 
    port: number,
    traefikConfig?: Record<string, { internalPort: number; enabled: boolean }>
  ): any {
    if (!composeData.services) {
      return composeData;
    }

    const traefikNetwork = 'traefik-network';

    // Add networks section if it doesn't exist
    if (!composeData.networks) {
      composeData.networks = {};
    }
    if (!composeData.networks[traefikNetwork]) {
      composeData.networks[traefikNetwork] = {
        external: true
      };
    }

    // Handle main URL routing (if configured)
    const mainConfig = traefikConfig?.['_main'] as { serviceName?: string; internalPort?: number } | undefined;
    if (mainConfig?.serviceName && mainConfig.internalPort) {
      const mainServiceName = mainConfig.serviceName;
      const mainService = composeData.services[mainServiceName] as any;
      
      if (mainService) {
        // Initialize labels if not present
        if (!mainService.labels) {
          mainService.labels = {};
        }

        // Generate router name for main URL
        const mainRouterName = `${subdomain.replace(/[^a-z0-9]/g, '')}-main`;
        const mainFullDomain = `${subdomain}.${domain}`;

        // Add Traefik labels for main URL
        mainService.labels['traefik.enable'] = 'true';
        mainService.labels['traefik.docker.network'] = `${traefikNetwork}`;
        mainService.labels[`traefik.http.routers.${mainRouterName}.rule`] = `Host(\`${mainFullDomain}\`)`;
        mainService.labels[`traefik.http.routers.${mainRouterName}.entrypoints`] = 'websecure';
        mainService.labels[`traefik.http.routers.${mainRouterName}.tls.certresolver`] = 'letsencrypt';
        mainService.labels[`traefik.http.services.${mainRouterName}.loadbalancer.server.port`] = mainConfig.internalPort.toString();
        
        console.log(`[COMPOSE] Configured main URL routing: ${mainFullDomain} → ${mainServiceName}:${mainConfig.internalPort}`);

        // Add network to main service
        if (!mainService.networks) {
          mainService.networks = [];
        }
        if (!mainService.networks.includes(traefikNetwork)) {
          mainService.networks.push(traefikNetwork);
        }
      }
    }

    // Add Traefik labels to each service
    for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
      const service = serviceConfig as any;
      
      // Skip _main entry (it's metadata, not a service)
      if (serviceName === '_main') {
        continue;
      }
      
      // Check if service has Traefik configuration
      const serviceTraefikConfig = traefikConfig?.[serviceName];
      
      // Skip if Traefik config exists and service is disabled
      if (serviceTraefikConfig && !serviceTraefikConfig.enabled) {
        continue;
      }

      // Skip database services by default (unless explicitly enabled in traefikConfig)
      if (!serviceTraefikConfig) {
        if (serviceName.toLowerCase().includes('db') || 
            serviceName.toLowerCase().includes('database') ||
            serviceName.toLowerCase().includes('mysql') ||
            serviceName.toLowerCase().includes('postgres') ||
            serviceName.toLowerCase().includes('mongo')) {
          continue;
        }
      }

      // Initialize labels if not present
      if (!service.labels) {
        service.labels = {};
      }

      // Generate unique router name for each service
      const serviceRouterName = `${subdomain.replace(/[^a-z0-9]/g, '')}-${serviceName}`;
      const serviceFullDomain = `${serviceName}.${subdomain}.${domain}`;

      // Add Traefik labels
      service.labels['traefik.enable'] = 'true';
      service.labels['traefik.docker.network'] = `${traefikNetwork}`;
      service.labels[`traefik.http.routers.${serviceRouterName}.rule`] = `Host(\`${serviceFullDomain}\`)`;
      service.labels[`traefik.http.routers.${serviceRouterName}.entrypoints`] = 'websecure';
      service.labels[`traefik.http.routers.${serviceRouterName}.tls.certresolver`] = 'letsencrypt';
      
      // Determine service port from config or compose file
      // Priority: 1. Traefik config internalPort, 2. Compose file ports, 3. Expose directive, 4. Allocated port (last resort)
      let servicePort: number | null = null;
      
      // First priority: Use port from Traefik config (from template Traefik tab)
      if (serviceTraefikConfig?.internalPort && serviceTraefikConfig.internalPort > 0) {
        servicePort = serviceTraefikConfig.internalPort;
        console.log(`[COMPOSE] Using Traefik config port ${servicePort} for service ${serviceName}`);
      } else {
        // Second priority: Try to detect from compose file ports
        if (service.ports && Array.isArray(service.ports) && service.ports.length > 0) {
          const portMapping = service.ports[0];
          if (typeof portMapping === 'string') {
            // Format: "8000:80" (host:container) or "80" (container only)
            const parts = portMapping.split(':');
            if (parts.length === 2) {
              // Has host port mapping - use container port (right side)
              const containerPort = parseInt(parts[1]);
              if (!isNaN(containerPort) && containerPort > 0) {
                servicePort = containerPort;
                console.log(`[COMPOSE] Detected container port ${servicePort} from compose file for service ${serviceName}`);
              }
            } else if (parts.length === 1) {
              // Single port - container port
              const containerPort = parseInt(parts[0]);
              if (!isNaN(containerPort) && containerPort > 0) {
                servicePort = containerPort;
                console.log(`[COMPOSE] Detected single port ${servicePort} from compose file for service ${serviceName}`);
              }
            }
          } else if (typeof portMapping === 'object') {
            // Format: { target: 80, published: 8000, protocol: 'tcp' }
            if (portMapping.target && portMapping.target > 0) {
              servicePort = portMapping.target;
              console.log(`[COMPOSE] Detected target port ${servicePort} from compose file for service ${serviceName}`);
            } else if (portMapping.container && portMapping.container > 0) {
              servicePort = portMapping.container;
              console.log(`[COMPOSE] Detected container port ${servicePort} from compose file for service ${serviceName}`);
            }
          }
        }
        
        // Third priority: Check expose directive
        if (servicePort === null && service.expose && Array.isArray(service.expose) && service.expose.length > 0) {
          const exposedPort = parseInt(service.expose[0]);
          if (!isNaN(exposedPort) && exposedPort > 0) {
            servicePort = exposedPort;
            console.log(`[COMPOSE] Using exposed port ${servicePort} for service ${serviceName}`);
          }
        }
        
        // Last resort: Use allocated port (should rarely happen if compose file is properly configured)
        if (servicePort === null || servicePort <= 0) {
          servicePort = port;
          console.warn(`[COMPOSE] WARNING: No valid port found for service ${serviceName}, falling back to allocated port ${port}. Consider configuring the service in the Traefik tab or adding ports to the compose file.`);
        }
      }
      
      service.labels[`traefik.http.services.${serviceRouterName}.loadbalancer.server.port`] = servicePort.toString();

      // Add network to service
      if (!service.networks) {
        service.networks = [];
      }
      if (!service.networks.includes(traefikNetwork)) {
        service.networks.push(traefikNetwork);
      }
    }

    return composeData;
  }

  /**
   * Add environment variables to services in compose file
   * Note: Docker Compose automatically loads .env files, but we also add them to the service
   * environment section to ensure they're available. Variables using ${VAR} syntax in the compose
   * file will be resolved from the .env file automatically.
   */
  private addEnvironmentVariables(composeData: any, envVars: Record<string, string>): any {
    if (!composeData.services) {
      return composeData;
    }

    // Add environment variables to each service
    for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
      const service = serviceConfig as any;
      
      // Initialize environment if not present
      if (!service.environment) {
        service.environment = {};
      }

      // If environment is an array, convert to object
      if (Array.isArray(service.environment)) {
        const envObj: Record<string, string> = {};
        for (const env of service.environment) {
          if (typeof env === 'string') {
            // Handle both KEY=value and KEY=${VAR} formats
            const match = env.match(/^([^=]+)=(.*)$/);
            if (match) {
              const [, key, value] = match;
              envObj[key] = value;
            }
          }
        }
        service.environment = envObj;
      }

      // Merge environment variables
      // Use actual values (not ${VAR} syntax) so they're directly available
      // Docker Compose will still use .env file for ${VAR} interpolation in compose file itself
      service.environment = {
        ...service.environment,
        ...envVars
      };
    }

    return composeData;
  }

  /**
   * Parse memory limit string (e.g., "512m", "1g", "2048") to bytes
   */
  private parseMemoryLimit(memoryLimit: string): number {
    if (!memoryLimit) return 0;
    
    const match = memoryLimit.match(/^(\d+)([kmg]?)$/i);
    if (!match) return 0;
    
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'g':
        return value * 1024 * 1024 * 1024; // Convert GB to bytes
      case 'm':
        return value * 1024 * 1024; // Convert MB to bytes
      case 'k':
        return value * 1024; // Convert KB to bytes
      default:
        return value; // Assume bytes if no unit
    }
  }

  /**
   * Add resource limits to services in compose file
   */
  private addResourceLimits(composeData: any, config: ComposeStackConfig): any {
    if (!composeData.services) {
      return composeData;
    }

    // Add resource limits to each service
    for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
      const service = serviceConfig as any;
      
      // Initialize deploy section if not present
      if (!service.deploy) {
        service.deploy = {};
      }
      
      // Initialize resources if not present
      if (!service.deploy.resources) {
        service.deploy.resources = {};
      }
      
      // Initialize limits if not present
      if (!service.deploy.resources.limits) {
        service.deploy.resources.limits = {};
      }
      
      // Initialize reservations if not present
      if (!service.deploy.resources.reservations) {
        service.deploy.resources.reservations = {};
      }

      // Apply CPU limit
      if (config.cpuLimit !== undefined && config.cpuLimit > 0) {
        service.deploy.resources.limits.cpus = `${config.cpuLimit}`;
        console.log(`[COMPOSE] Applying CPU limit to ${serviceName}: ${config.cpuLimit} cores`);
      }

      // Apply memory limit
      if (config.memoryLimit) {
        service.deploy.resources.limits.memory = config.memoryLimit;
        console.log(`[COMPOSE] Applying memory limit to ${serviceName}: ${config.memoryLimit}`);
      }

      // Apply memory reservation (soft limit)
      if (config.memoryReservation) {
        service.deploy.resources.reservations.memory = config.memoryReservation;
        console.log(`[COMPOSE] Applying memory reservation to ${serviceName}: ${config.memoryReservation}`);
      }

      // Note: Storage limits are not directly supported in Docker Compose
      // They would need to be enforced at the volume/filesystem level
      if (config.storageLimit) {
        console.log(`[COMPOSE] Storage limit specified: ${config.storageLimit} (not applied at compose level)`);
      }
    }

    return composeData;
  }

  /**
   * Get error message from error object
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }
}


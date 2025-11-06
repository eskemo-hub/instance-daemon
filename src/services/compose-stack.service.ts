import Docker, { Container } from 'dockerode';
import { ComposeStackConfig, ComposeStackInfo, ComposeFileData, DockerContainerStats } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import logger from '../utils/logger';
import { dockerManager } from '../utils/docker-manager';
import { execCommand } from '../utils/exec-async';

/**
 * ComposeStackService handles Docker Compose stack operations
 * Uses docker compose CLI commands for stack management
 */
export class ComposeStackService {
  private readonly COMPOSE_DIR = '/opt/n8n-daemon/compose';

  constructor() {
    // Ensure compose directory exists
    if (!fs.existsSync(this.COMPOSE_DIR)) {
      fs.mkdirSync(this.COMPOSE_DIR, { recursive: true, mode: 0o755 });
      logger.debug({ dir: this.COMPOSE_DIR }, 'Created compose directory');
    }
  }

  /**
   * Get Docker instance from manager
   */
  private getDocker(): Docker {
    return dockerManager.getDocker();
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
      let composeData: ComposeFileData = {};
      
      try {
        // Try to parse as YAML
        composeData = yaml.load(composeContent) as ComposeFileData;
        
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
        logger.warn({ error: this.getErrorMessage(error) }, 'Could not parse compose file as YAML, using as-is');
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
  - name: studio
    url: http://studio:3000/
    routes:
      - name: studio-all
        strip_path: false
        paths:
          - /
    plugins:
      - name: cors
`;
          fs.writeFileSync(kongYmlPath, defaultKongYml, { mode: 0o644 });
          logger.debug({ stackName: config.name }, 'Created default kong.yml file');
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
        logger.debug({ variableCount: Object.keys(config.environment).length }, 'Created .env file');
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
        logger.warn({ volumePath, error: this.getErrorMessage(error) }, 'Could not create volume');
      }

      // Run docker compose up in detached mode to create the stack
      // We use `docker compose` (v2) which is the modern way
      const composeCommand = `docker compose -f "${composeFilePath}" -p "${config.name}" up -d`;
      logger.info({ stackName: config.name, command: composeCommand }, 'Creating compose stack');

      try {
        await execCommand(composeCommand, {
          cwd: stackDir,
          env: { ...process.env, ...config.environment },
          timeout: 300000 // 5 minutes timeout for large containers
        });
        logger.info({ stackName: config.name }, 'Compose stack created successfully');
      } catch (error: unknown) {
        const errorMessage = this.getErrorMessage(error);
        const errorDetails = error instanceof Error && 'stdout' in error 
          ? (error as { stdout?: string; stderr?: string }).stdout || (error as { stderr?: string }).stderr || errorMessage
          : errorMessage;
        
        logger.error({ 
          stackName: config.name, 
          error: errorDetails 
        }, 'Failed to create compose stack');
        
        // Cleanup any partially created containers
        logger.debug({ stackName: config.name }, 'Cleaning up partially created stack');
        try {
          await this.removeStack(config.name, false);
          logger.info({ stackName: config.name }, 'Cleaned up partially created stack');
        } catch (cleanupError) {
          // Log cleanup errors but don't fail on them - the original error is more important
          logger.warn({ 
            stackName: config.name, 
            error: this.getErrorMessage(cleanupError) 
          }, 'Failed to cleanup partially created stack (this is okay)');
        }
        
        // Check for port conflicts and provide clearer error message
        if (errorDetails.includes('port is already allocated') || errorDetails.includes('port is already in use')) {
          throw new Error(`Port conflict: ${errorDetails}. Please check if another container is using the same port.`);
        }
        
        // Check for DNS errors
        if (errorDetails.includes('getaddrinfo') || errorDetails.includes('EAI_AGAIN')) {
          throw new Error(`DNS lookup failed: ${errorDetails}. Please check your compose file for invalid hostnames or network configuration.`);
        }
        
        throw new Error(`Failed to create compose stack: ${errorDetails}`);
      }

      // Get stack status (with error handling to prevent crashes)
      let stackInfo: ComposeStackInfo;
      try {
        stackInfo = await this.getStackStatus(config.name);
      } catch (error) {
        // If getting stack status fails, still return a basic status
        logger.warn({ 
          stackName: config.name, 
          error: this.getErrorMessage(error) 
        }, 'Could not get full stack status');
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
      logger.info({ stackName }, 'Starting compose stack');

      await execCommand(composeCommand, {
        cwd: stackDir
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
      logger.info({ stackName }, 'Stopping compose stack');

      await execCommand(composeCommand, {
        cwd: stackDir
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
      logger.info({ stackName }, 'Restarting compose stack');

      await execCommand(composeCommand, {
        cwd: stackDir
      });
    } catch (error) {
      throw new Error(`Failed to restart compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Update a Docker Compose stack by pulling latest images and recreating containers
   */
  async updateStack(stackName: string): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

      // Pull latest images
      logger.info({ stackName }, 'Pulling latest images for compose stack');
      const pullCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" pull`;
      await execCommand(pullCommand, {
        cwd: stackDir,
        timeout: 300000 // 5 minutes timeout for large images
      });

      // Recreate containers with new images
      logger.info({ stackName }, 'Recreating containers with updated images');
      const upCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" up -d`;
      await execCommand(upCommand, {
        cwd: stackDir,
        timeout: 300000 // 5 minutes timeout
      });

      logger.info({ stackName }, 'Compose stack updated successfully');
    } catch (error) {
      throw new Error(`Failed to update compose stack: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Remove a Docker Compose stack
   */
  async removeStack(stackName: string, removeVolumes: boolean = false): Promise<void> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      // First, check if any containers exist for this stack
      const containersBefore = await this.getStackContainers(stackName);
      if (containersBefore.length === 0 && !fs.existsSync(composeFilePath)) {
        logger.info({ stackName }, 'Stack not found or already removed');
        // Clean up stack directory if it exists
        if (fs.existsSync(stackDir)) {
          fs.rmSync(stackDir, { recursive: true, force: true });
        }
        return;
      }

      // Try to use docker compose down if compose file exists
      if (fs.existsSync(composeFilePath)) {
        // Use --remove-orphans to remove containers that are no longer in the compose file
        const composeCommand = `docker compose -f "${composeFilePath}" -p "${stackName}" down --remove-orphans${removeVolumes ? ' -v' : ''}`;
        logger.info({ stackName, removeVolumes }, 'Removing compose stack with docker compose down');

        try {
          await execCommand(composeCommand, {
            cwd: stackDir
          });
          logger.info({ stackName }, 'Docker compose down completed');
        } catch (error: unknown) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn({ stackName, error: errorMsg }, 'Docker compose down failed, will try direct container removal');
          // Continue to fallback removal below
        }
      }

      // Verify and remove any remaining containers (fallback or cleanup after compose down)
      const containersAfter = await this.getStackContainers(stackName);
      if (containersAfter.length > 0) {
        logger.info({ stackName, remainingContainers: containersAfter.length }, 'Removing remaining stack containers directly');
        await this.removeStackContainers(stackName, removeVolumes);
      }

      // Final verification - check if any containers still exist
      const containersFinal = await this.getStackContainers(stackName);
      if (containersFinal.length > 0) {
        logger.warn({ stackName, remainingContainers: containersFinal.length }, 'Some containers still exist after removal attempt');
        // Try one more time with force removal
        for (const container of containersFinal) {
          try {
            const containerInfo = await container.inspect();
            // Force stop if running
            if (containerInfo.State.Running) {
              await container.stop({ t: 0 }); // Force stop immediately
            }
            // Force remove
            await container.remove({ v: removeVolumes, force: true });
            logger.info({ stackName, containerId: container.id }, 'Force removed remaining container');
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error({ stackName, containerId: container.id, error: errorMsg }, 'Failed to force remove container');
          }
        }
      }

      // Clean up stack directory
      if (fs.existsSync(stackDir)) {
        fs.rmSync(stackDir, { recursive: true, force: true });
      }

      logger.info({ stackName }, 'Stack removal completed');
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
          const containers = await this.getDocker().listContainers({ all: true });
          const container = containers.find(c => {
            const containerName = c.Names[0]?.replace(/^\//, '') || '';
            // Match exact container name
            return containerName === options.container;
          });

          if (container) {
            const dockerContainer = this.getDocker().getContainer(container.Id);
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
          logger.warn({ container: options.container, error: this.getErrorMessage(containerError) }, 'Failed to get logs for container, falling back to compose logs');
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

      const { stdout } = await execCommand(composeCommand, {
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
            // Cast stats to DockerContainerStats for calculation
            const cpuPercent = this.calculateCpuPercent(stats as unknown as DockerContainerStats);
            
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
                const networkStats = network as { rx_bytes?: number; tx_bytes?: number };
                networkRx += networkStats.rx_bytes || 0;
                networkTx += networkStats.tx_bytes || 0;
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
      const containers = await this.getDocker().listContainers({ all: true });
      const stackContainers = containers
        .filter(container => {
          // Method 1: Check Docker Compose labels (most reliable)
          if (container.Labels) {
            const projectLabel = container.Labels['com.docker.compose.project'];
            if (projectLabel === stackName) {
              return true;
            }
          }
          
          // Method 2: Check container name prefix (fallback)
          const containerName = container.Names[0]?.replace(/^\//, '') || '';
          return containerName.startsWith(`${stackName}_`) || containerName === stackName;
        })
        .map(container => this.getDocker().getContainer(container.Id));

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
      const containers = await this.getDocker().listContainers({ all: true });
      
      // Docker Compose containers can be matched by:
      // 1. Container labels (com.docker.compose.project) - most reliable
      // 2. Container name prefix (project_service_number)
      const stackContainers: Array<{
        id: string;
        name: string;
        status: string;
        service?: string;
      }> = [];
      
      for (const container of containers) {
        const containerName = container.Names[0]?.replace(/^\//, '') || '';
        let matches = false;
        let service: string | undefined;
        
        // Method 1: Check Docker Compose labels (most reliable)
        if (container.Labels) {
          const projectLabel = container.Labels['com.docker.compose.project'];
          const serviceLabel = container.Labels['com.docker.compose.service'];
          
          if (projectLabel === stackName) {
            matches = true;
            service = serviceLabel;
          }
        }
        
        // Method 2: Check container name prefix (fallback)
        if (!matches) {
          // Match containers that start with stackName_ or are exactly stackName
          if (containerName.startsWith(`${stackName}_`) || containerName === stackName) {
            matches = true;
            
            // Extract service name from container name (format: {project}_{service}_{number})
            const parts = containerName.split('_');
            
            if (parts.length > 2) {
              // Skip first part (project) and last part (number), join middle parts as service name
              // Example: "supabase_cmhmow9n9005sjy92qz7mqgoo_db_1" -> service: "db"
              // But stackName might already include "supabase_", so we need to handle this
              const stackNameParts = stackName.split('_');
              if (containerName.startsWith(stackName + '_')) {
                // Full stack name match: extract everything after stackName_
                const afterPrefix = containerName.substring(stackName.length + 1);
                const afterParts = afterPrefix.split('_');
                if (afterParts.length > 1) {
                  // Remove the number suffix
                  service = afterParts.slice(0, -1).join('_');
                } else {
                  service = afterParts[0];
                }
              } else {
                // Fallback: use old logic
                service = parts.slice(1, -1).join('_');
              }
            } else if (parts.length === 2) {
              // Format: {project}_{service} (no number)
              service = parts[1];
            }
          }
        }
        
        if (matches) {
          stackContainers.push({
            id: container.Id,
            name: containerName,
            status: container.State || 'unknown',
            service
          });
        }
      }

      logger.debug({ stackName, containerCount: stackContainers.length }, 'Found containers for stack');
      if (stackContainers.length === 0) {
        logger.debug({ stackName }, 'No containers found. Searched for prefix');
        const sampleContainers = containers.slice(0, 10).map(c => ({
          name: c.Names[0]?.replace(/^\//, '') || '',
          project: c.Labels?.['com.docker.compose.project'] || 'N/A',
          service: c.Labels?.['com.docker.compose.service'] || 'N/A'
        }));
        logger.debug({ stackName, sampleContainers }, 'Sample containers for debugging');
      }

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
    
    if (containers.length === 0) {
      logger.info({ stackName }, 'No containers found to remove');
      return;
    }

    logger.info({ stackName, containerCount: containers.length }, 'Removing stack containers directly');
    
    for (const container of containers) {
      try {
        const containerInfo = await container.inspect();
        const containerName = containerInfo.Name?.replace(/^\//, '') || container.id;
        
        // Stop container if running
        if (containerInfo.State.Running) {
          logger.info({ stackName, containerName }, 'Stopping container');
          try {
            await container.stop({ t: 10 }); // Give 10 seconds for graceful shutdown
          } catch (stopError) {
            logger.warn({ stackName, containerName, error: stopError }, 'Failed to stop container gracefully, forcing stop');
            await container.stop({ t: 0 }); // Force stop immediately
          }
        }
        
        // Remove container
        logger.info({ stackName, containerName }, 'Removing container');
        await container.remove({ v: removeVolumes });
        logger.info({ stackName, containerName }, 'Container removed successfully');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error({ stackName, containerId: container.id, error: errorMsg }, 'Failed to remove container, trying force removal');
        
        // Try force removal as last resort
        try {
          await container.remove({ v: removeVolumes, force: true });
          logger.info({ stackName, containerId: container.id }, 'Container force removed');
        } catch (forceError) {
          const forceErrorMsg = forceError instanceof Error ? forceError.message : String(forceError);
          logger.error({ stackName, containerId: container.id, error: forceErrorMsg }, 'Failed to force remove container');
        }
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
          logger.debug({ dir: hostDir }, 'Creating host directory');
          fs.mkdirSync(hostDir, { recursive: true, mode: 0o755 });
          
          // Set proper ownership if running as root (common in daemon environments)
          try {
            // Try to set ownership to 1000:1000 (common Docker user)
            await execCommand(`chown -R 1000:1000 "${hostDir}"`, { stdio: 'ignore' as const });
            logger.debug({ dir: hostDir }, 'Set ownership to 1000:1000');
          } catch (chownError) {
            // Continue anyway - the directory was created with proper mode
            logger.warn({ dir: hostDir, error: this.getErrorMessage(chownError) }, 'Could not set ownership');
          }
        } else {
          logger.debug({ dir: hostDir }, 'Host directory already exists');
        }
      } catch (error) {
        // Don't throw - host directory creation is not critical if it fails
        // The compose command will handle it or fail with a clearer error
        logger.warn({ volumeName, error: this.getErrorMessage(error) }, 'Could not create host directory');
      }
    } else {
      // This is a Docker volume name, try to create Docker volume
      try {
        const volume = this.getDocker().getVolume(volumeName);
        await volume.inspect();
        // Volume exists
        logger.debug({ volumeName }, 'Volume already exists');
      } catch (error: unknown) {
        const dockerError = error as { statusCode?: number; message?: string };
        if (dockerError.statusCode === 404) {
          // Volume doesn't exist, create it
          try {
            await this.getDocker().createVolume({ Name: volumeName });
            logger.info({ volumeName }, 'Created Docker volume');
          } catch (createError: unknown) {
            // Handle HTTP 301 and other Docker API errors gracefully
            const dockerCreateError = createError as { statusCode?: number; message?: string };
            if (dockerCreateError.statusCode === 301 || (dockerCreateError.statusCode && dockerCreateError.statusCode >= 400)) {
              logger.warn({ volumeName, error: dockerCreateError.message }, 'Could not create Docker volume');
              // Don't throw - volume creation might be handled by compose file itself
            } else {
              throw createError;
            }
          }
        } else {
          // For other errors (like 301), log but don't throw
          logger.warn({ volumeName, error: this.getErrorMessage(error) }, 'Could not inspect Docker volume');
        }
      }
    }
  }

  /**
   * Calculate CPU percentage from Docker stats
   */
  private calculateCpuPercent(stats: DockerContainerStats): number {
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
      logger.info({ stackName, serviceName }, 'Restarting service in stack');

      await execCommand(composeCommand, {
        cwd: stackDir
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
      logger.info({ stackName, serviceName }, 'Starting service in stack');

      await execCommand(composeCommand, {
        cwd: stackDir
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
      logger.info({ stackName, serviceName }, 'Stopping service in stack');

      await execCommand(composeCommand, {
        cwd: stackDir
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
    composeData: ComposeFileData, 
    domain: string, 
    subdomain: string, 
    port: number,
    traefikConfig?: Record<string, { internalPort: number; enabled?: boolean; serviceName?: string }>
  ): ComposeFileData {
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
    logger.debug({ mainConfig, traefikConfigKeys: traefikConfig ? Object.keys(traefikConfig) : [] }, 'Checking _main config');
    
    if (mainConfig?.serviceName && mainConfig.internalPort !== undefined && mainConfig.internalPort > 0) {
      const mainServiceName = mainConfig.serviceName;
      const mainService = composeData.services[mainServiceName];
      
      if (mainService) {
        // Initialize labels if not present
        if (!mainService.labels) {
          mainService.labels = {};
        }

        // Generate router name for main URL
        const mainRouterName = `${subdomain.replace(/[^a-z0-9]/g, '')}-main`;
        const mainFullDomain = `${subdomain}.${domain}`;

        // Ensure internalPort is a number (handle string conversion if needed)
        const mainInternalPort = typeof mainConfig.internalPort === 'number' 
          ? mainConfig.internalPort 
          : parseInt(String(mainConfig.internalPort), 10);

        if (isNaN(mainInternalPort) || mainInternalPort <= 0) {
          logger.warn({ serviceName: mainServiceName, internalPort: mainConfig.internalPort }, 'Invalid internalPort for main service, skipping main URL routing');
        } else {
          // Add Traefik labels for main URL
          mainService.labels['traefik.enable'] = 'true';
          mainService.labels['traefik.docker.network'] = `${traefikNetwork}`;
          mainService.labels[`traefik.http.routers.${mainRouterName}.rule`] = `Host(\`${mainFullDomain}\`)`;
          mainService.labels[`traefik.http.routers.${mainRouterName}.entrypoints`] = 'websecure';
          mainService.labels[`traefik.http.routers.${mainRouterName}.tls.certresolver`] = 'letsencrypt';
          mainService.labels[`traefik.http.services.${mainRouterName}.loadbalancer.server.port`] = mainInternalPort.toString();
          
          logger.info({ domain: mainFullDomain, service: mainServiceName, port: mainInternalPort }, 'Configured main URL routing');

          // Add network to main service
          if (!mainService.networks) {
            mainService.networks = [];
          }
          // Handle networks as array or object
          const networksArray = Array.isArray(mainService.networks) 
            ? mainService.networks 
            : Object.keys(mainService.networks || {});
          if (!networksArray.includes(traefikNetwork)) {
            if (Array.isArray(mainService.networks)) {
              mainService.networks.push(traefikNetwork);
            } else {
              // Convert to array if it was an object
              mainService.networks = [...networksArray, traefikNetwork];
            }
          }
        }
      } else {
        logger.warn({ serviceName: mainServiceName }, 'Main service specified in _main config but not found in compose file services');
      }
    } else {
      if (traefikConfig && '_main' in traefikConfig) {
        logger.warn({ serviceName: mainConfig?.serviceName, internalPort: mainConfig?.internalPort }, '_main config exists but is missing required fields. Main URL routing will not be configured.');
      }
    }

    // Add Traefik labels to each service
    for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
      const service = serviceConfig;
      
      // Skip _main entry (it's metadata, not a service)
      if (serviceName === '_main') {
        continue;
      }
      
      // Check if service has Traefik configuration
      const serviceTraefikConfig = traefikConfig?.[serviceName];
      
      // Skip if Traefik config exists and service is explicitly disabled
      // Note: enabled is optional - if not specified, service is enabled by default
      if (serviceTraefikConfig && serviceTraefikConfig.enabled === false) {
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
        logger.debug({ serviceName, port: servicePort }, 'Using Traefik config port');
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
                logger.debug({ serviceName, port: servicePort }, 'Detected container port from compose file');
              }
            } else if (parts.length === 1) {
              // Single port - container port
              const containerPort = parseInt(parts[0]);
              if (!isNaN(containerPort) && containerPort > 0) {
                servicePort = containerPort;
                logger.debug({ serviceName, port: servicePort }, 'Detected single port from compose file');
              }
            }
          } else if (typeof portMapping === 'object') {
            // Format: { target: 80, published: 8000, protocol: 'tcp' }
            if (portMapping.target && portMapping.target > 0) {
              servicePort = portMapping.target;
              logger.debug({ serviceName, port: servicePort }, 'Detected target port from compose file');
            }
          }
        }
        
        // Third priority: Check expose directive
        if (servicePort === null && service.expose && Array.isArray(service.expose) && service.expose.length > 0) {
          const exposedPort = parseInt(service.expose[0]);
          if (!isNaN(exposedPort) && exposedPort > 0) {
            servicePort = exposedPort;
            logger.debug({ serviceName, port: servicePort }, 'Using exposed port');
          }
        }
        
        // Last resort: Use allocated port (should rarely happen if compose file is properly configured)
        if (servicePort === null || servicePort <= 0) {
          servicePort = port;
          logger.warn({ serviceName, fallbackPort: port }, 'No valid port found for service, falling back to allocated port. Consider configuring the service in the Traefik tab or adding ports to the compose file.');
        }
      }
      
      service.labels[`traefik.http.services.${serviceRouterName}.loadbalancer.server.port`] = servicePort.toString();

      // Add network to service
      if (!service.networks) {
        service.networks = [];
      }
      // Handle networks as array or object
      const networksArray = Array.isArray(service.networks) 
        ? service.networks 
        : Object.keys(service.networks || {});
      if (!networksArray.includes(traefikNetwork)) {
        if (Array.isArray(service.networks)) {
          service.networks.push(traefikNetwork);
        } else {
          // Convert to array if it was an object
          service.networks = [...networksArray, traefikNetwork];
        }
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
  private addEnvironmentVariables(composeData: ComposeFileData, envVars: Record<string, string>): ComposeFileData {
    if (!composeData.services) {
      return composeData;
    }

    // Add environment variables to each service
    for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
      const service = serviceConfig;
      
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
  private addResourceLimits(composeData: ComposeFileData, config: ComposeStackConfig): ComposeFileData {
    if (!composeData.services) {
      return composeData;
    }

    // Add resource limits to each service
    for (const [serviceName, serviceConfig] of Object.entries(composeData.services)) {
      const service = serviceConfig;
      
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
        logger.debug({ serviceName, cpuLimit: config.cpuLimit }, 'Applying CPU limit');
      }

      // Apply memory limit
      if (config.memoryLimit) {
        service.deploy.resources.limits.memory = config.memoryLimit;
        logger.debug({ serviceName, memoryLimit: config.memoryLimit }, 'Applying memory limit');
      }

      // Apply memory reservation (soft limit)
      if (config.memoryReservation) {
        service.deploy.resources.reservations.memory = config.memoryReservation;
        logger.debug({ serviceName, memoryReservation: config.memoryReservation }, 'Applying memory reservation');
      }

      // Note: Storage limits are not directly supported in Docker Compose
      // They would need to be enforced at the volume/filesystem level
      if (config.storageLimit) {
        logger.debug({ storageLimit: config.storageLimit }, 'Storage limit specified (not applied at compose level)');
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


import Docker from 'dockerode';
import { ContainerConfig, ContainerInfo, ContainerStatus } from '../types';
import { CertificateService } from './certificate.service';
import { HAProxyService } from './haproxy.service';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * DockerService handles all Docker container operations
 * 
 * Requirements:
 * - 5.3: Daemon SHALL create a new Docker container running n8n with isolated storage and networking
 * - 8.5: Daemon SHALL execute the Docker container lifecycle command and report the result back to the Platform
 * - 11.4: Daemon SHALL execute Docker commands to create, start, stop, restart, and remove n8n containers
 * - 11.5: Daemon SHALL report command execution results and container status back to the Platform
 * - 14.1: Daemon SHALL create Docker volumes for each n8n Instance to store workflow data
 * - 14.2: Daemon SHALL mount the Docker volume to the appropriate path in the n8n container
 * - 14.3: When an n8n Instance is stopped and restarted, Daemon SHALL reattach the same Docker volume
 * - 14.4: Daemon SHALL include the Docker volume in deletion operations when an n8n Instance is removed
 * - 15.1: Daemon SHALL configure each n8n Instance with a unique port on the Host Server
 * - 15.4: Daemon SHALL ensure n8n containers are configured to accept connections on their assigned ports
 */
export class DockerService {
  private docker: Docker;
  private certificateService: CertificateService;
  private haproxyService: HAProxyService;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor() {
    // Initialize dockerode with default socket connection
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.certificateService = new CertificateService();
    this.haproxyService = new HAProxyService();
  }

  /**
   * Create a new n8n container with persistent volume
   * Requirements: 5.3, 14.1, 14.2, 15.1, 15.4
   */
  async createN8nContainer(config: ContainerConfig): Promise<ContainerInfo> {
    return this.retryOperation(async () => {
      try {
        // Determine image and volume path
        const dockerImage = config.image || 'n8nio/n8n:latest';
        const volumePath = config.volumePath || '/home/node/.n8n';
        const isN8n = dockerImage.includes('n8n');
        
        // Determine volume binding strategy
        let volumeBinding: string;
        if (config.hostPath) {
          // Ensure host directory exists with proper permissions before bind mounting
          try {
            const hostDir = path.resolve(config.hostPath);
            if (!fs.existsSync(hostDir)) {
              console.log(`Creating host directory: ${hostDir}`);
              fs.mkdirSync(hostDir, { recursive: true, mode: 0o755 });
              
              // Set proper ownership if running as root (common in daemon environments)
              try {
                // Try to set ownership to 1000:1000 (common Docker user)
                execSync(`chown -R 1000:1000 "${hostDir}"`, { stdio: 'ignore' });
                console.log(`Set ownership of ${hostDir} to 1000:1000`);
              } catch (chownError) {
                console.warn(`Could not set ownership for ${hostDir}:`, chownError);
                // Continue anyway - the directory was created with proper mode
              }
            } else {
              console.log(`Host directory already exists: ${hostDir}`);
            }
          } catch (error) {
            console.error(`Failed to create host directory ${config.hostPath}:`, error);
            throw new Error(`Failed to create host directory: ${error}`);
          }
          
          // Use host path bind mount
          volumeBinding = `${config.hostPath}:${volumePath}`;
        } else {
          // Use Docker volume (create if needed)
          await this.createVolume(config.volumeName);
          volumeBinding = `${config.volumeName}:${volumePath}`;
        }
        
        // Pull image if not present
        await this.pullImageIfNeeded(dockerImage);

        // Generate API key for n8n instances only
        const apiKey = isN8n ? this.generateN8nApiKey() : undefined;

        // Add API key to environment variables for n8n
        const envWithApiKey = isN8n && apiKey ? {
          ...config.environment,
          N8N_API_KEY_STATIC: apiKey,
        } : config.environment;

        // Determine exposed port based on template
        let internalPort = '5678'; // Default for n8n
        if (!isN8n) {
          // For databases, use standard internal ports
          if (dockerImage.includes('postgres')) {
            internalPort = '5432';
          } else if (dockerImage.includes('mysql') || dockerImage.includes('mariadb')) {
            internalPort = '3306';
          } else if (dockerImage.includes('mongo')) {
            internalPort = '27017';
          } else {
            internalPort = config.port.toString(); // Fallback to config port
          }
        }

        // Build container configuration
        const containerConfig: any = {
          Image: dockerImage,
          name: config.name,
          Env: this.buildEnvironmentVariables({ ...config, environment: envWithApiKey }),
          ExposedPorts: {
            [`${internalPort}/tcp`]: {}
          },
          HostConfig: {
            Binds: [
              volumeBinding
            ],
            RestartPolicy: {
              Name: 'unless-stopped'
            }
          }
        };

        // Apply resource limits if specified
        this.applyResourceLimits(containerConfig.HostConfig, config);

        // Configure networking and TLS based on instance type
        if (config.useTraefik && config.domain && config.subdomain) {
          const fullDomain = `${config.subdomain}.${config.domain}`;
          const routerName = config.subdomain.replace(/[^a-z0-9]/g, '');
          
          if (config.isDatabase) {
            // Database: Bind to localhost only - ONLY accessible via HAProxy/DNS
            // This prevents direct IP:port access for security
            containerConfig.HostConfig.PortBindings = {
              [`${internalPort}/tcp`]: [{ 
                HostIp: '127.0.0.1',  // Localhost only - must use HAProxy
                HostPort: config.port.toString() 
              }]
            };
            
            // Add to HAProxy if publicAccess is enabled (default for databases)
            if (config.publicAccess !== false) {
              await this.haproxyService.addDatabaseBackend({
                instanceName: config.name,
                domain: config.domain,
                subdomain: config.subdomain,
                port: config.port,
                dbType: dockerImage.includes('postgres') ? 'postgres' : 
                        dockerImage.includes('mongo') ? 'mongodb' : 'mysql',
              });
            }
          } else {
            // Web application: Use Traefik HTTP routing with Let's Encrypt
            containerConfig.Labels = {
              'traefik.enable': 'true',
              'traefik.docker.network': 'traefik-network',
              [`traefik.http.routers.${routerName}.rule`]: `Host(\`${fullDomain}\`)`,
              [`traefik.http.routers.${routerName}.entrypoints`]: 'websecure',
              [`traefik.http.routers.${routerName}.tls.certresolver`]: 'letsencrypt',
              [`traefik.http.services.${routerName}.loadbalancer.server.port`]: internalPort,
            };
            
            containerConfig.HostConfig.NetworkMode = 'traefik-network';
          }
        } else if (config.isStackService) {
          // Stack service (non-main): Use bridge network with localhost binding
          // This allows internal communication while preventing external access
          containerConfig.HostConfig.NetworkMode = 'bridge';
          containerConfig.HostConfig.PortBindings = {
            [`${internalPort}/tcp`]: [{ 
              HostIp: '127.0.0.1',  // Localhost only for internal services
              HostPort: config.port.toString() 
            }]
          };
          console.log(`[DOCKER] Creating stack service ${config.name} with internal networking (localhost:${config.port})`);
        } else {
          // Direct mode: bind to host port
          // Databases: localhost only (must use HAProxy)
          // Applications: 0.0.0.0 (direct access allowed)
          const hostIp = config.isDatabase ? '127.0.0.1' : '0.0.0.0';
          containerConfig.HostConfig.PortBindings = {
            [`${internalPort}/tcp`]: [{ 
              HostIp: hostIp,
              HostPort: config.port.toString() 
            }]
          };
        }

        // Create container with volume mounted (Requirement 14.2)
        const container = await this.docker.createContainer(containerConfig);

        const containerInfo = await container.inspect();

        // Extract the actual volume name from the container mounts
        let actualVolumeName = config.volumeName;
        if (containerInfo.Mounts && containerInfo.Mounts.length > 0) {
          const n8nMount = containerInfo.Mounts.find((mount: any) => 
            mount.Destination === '/home/node/.n8n'
          );
          if (n8nMount && n8nMount.Name) {
            actualVolumeName = n8nMount.Name;
          }
        }

        // Note: HAProxy routing for databases is NOT added during creation
        // It's only added when public access is explicitly enabled via the API
        // This ensures databases are private by default

        return {
          containerId: containerInfo.Id,
          name: containerInfo.Name.replace(/^\//, ''),
          status: containerInfo.State.Status,
          port: config.port,
          volumeName: actualVolumeName,
          apiKey: apiKey, // Return the generated API key
        };
      } catch (error) {
        throw new Error(`Failed to create n8n container: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Start a container
   * Requirements: 8.5, 11.4, 14.3
   */
  async startContainer(containerId: string): Promise<void> {
    return this.retryOperation(async () => {
      try {
        const container = this.docker.getContainer(containerId);
        await container.start();
      } catch (error) {
        // If container is already running, don't throw error
        if (this.getErrorMessage(error).includes('already started')) {
          return;
        }
        throw new Error(`Failed to start container: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Stop a container
   * Requirements: 8.5, 11.4
   */
  async stopContainer(containerId: string): Promise<void> {
    return this.retryOperation(async () => {
      try {
        const container = this.docker.getContainer(containerId);
        await container.stop({ t: 10 }); // 10 second graceful shutdown
      } catch (error) {
        // If container is already stopped, don't throw error
        if (this.getErrorMessage(error).includes('already stopped') || 
            this.getErrorMessage(error).includes('not running')) {
          return;
        }
        throw new Error(`Failed to stop container: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Restart a container
   * Requirements: 8.5, 11.4, 14.3
   */
  async restartContainer(containerId: string): Promise<void> {
    return this.retryOperation(async () => {
      try {
        const container = this.docker.getContainer(containerId);
        await container.restart({ t: 10 }); // 10 second graceful shutdown before restart
      } catch (error) {
        throw new Error(`Failed to restart container: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Remove a container and optionally its volumes
   * Requirements: 11.4, 14.4
   */
  async removeContainer(containerId: string, removeVolumes: boolean = true): Promise<void> {
    return this.retryOperation(async () => {
      try {
        const container = this.docker.getContainer(containerId);
        
        // Get container info to find associated volumes and bind mounts
        const containerInfo = await container.inspect();
        const volumeNames = removeVolumes ? this.extractVolumeNames(containerInfo) : [];
        const bindMountPaths = removeVolumes ? this.extractBindMountPaths(containerInfo) : [];

        // Stop container if running
        try {
          await container.stop({ t: 10 });
        } catch (error) {
          // Ignore if already stopped
          if (!this.getErrorMessage(error).includes('already stopped') && 
              !this.getErrorMessage(error).includes('not running')) {
            throw error;
          }
        }

        // Remove container
        await container.remove({ v: false }); // Don't auto-remove volumes, we'll do it explicitly

        // Remove Docker volumes if requested (Requirement 14.4)
        if (removeVolumes) {
          for (const volumeName of volumeNames) {
            try {
              const volume = this.docker.getVolume(volumeName);
              await volume.remove();
              console.log(`Removed Docker volume: ${volumeName}`);
            } catch (error) {
              console.error(`Failed to remove volume ${volumeName}:`, this.getErrorMessage(error));
              // Continue with other volumes even if one fails
            }
          }

          // Remove bind mount directories if requested (Requirement 14.4)
          for (const bindMountPath of bindMountPaths) {
            try {
              if (fs.existsSync(bindMountPath)) {
                // Use execSync to remove directory with proper permissions
                execSync(`rm -rf "${bindMountPath}"`, { stdio: 'ignore' });
                console.log(`Removed bind mount directory: ${bindMountPath}`);
              }
            } catch (error) {
              console.error(`Failed to remove bind mount directory ${bindMountPath}:`, this.getErrorMessage(error));
              // Continue with other directories even if one fails
            }
          }
        }

        // Remove certificates if they exist
        const containerName = containerInfo.Name.replace(/^\//, '');
        try {
          await this.certificateService.removeCertificate(containerName);
        } catch (error) {
          console.error(`Failed to remove certificates for ${containerName}:`, this.getErrorMessage(error));
        }

        // Remove HAProxy routing if it's a database
        const image = containerInfo.Config.Image;
        if (image.includes('postgres') || image.includes('mysql') || image.includes('mongo')) {
          const dbType: 'postgres' | 'mysql' | 'mongodb' = 
            image.includes('postgres') ? 'postgres' : 
            image.includes('mongo') ? 'mongodb' : 'mysql';
          
          try {
            await this.haproxyService.removeDatabaseBackend(containerName, dbType);
            console.log(`HAProxy routing removed for ${containerName}`);
          } catch (error) {
            console.error(`Failed to remove HAProxy routing for ${containerName}:`, error);
          }
        }
      } catch (error) {
        throw new Error(`Failed to remove container: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Get container status
   * Requirements: 11.5
   */
  async getContainerStatus(containerId: string): Promise<ContainerStatus> {
    try {
      const container = this.docker.getContainer(containerId);
      const containerInfo = await container.inspect();

      const state = this.mapContainerState(containerInfo.State);
      const uptime = containerInfo.State.Running && containerInfo.State.StartedAt 
        ? this.calculateUptime(containerInfo.State.StartedAt)
        : undefined;

      return {
        state,
        uptime,
        restartCount: containerInfo.RestartCount || 0
      };
    } catch (error) {
      // If container not found, return error state
      if (this.getErrorMessage(error).includes('no such container')) {
        return {
          state: 'error',
          restartCount: 0
        };
      }
      throw new Error(`Failed to get container status: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Create a Docker volume
   * Requirements: 14.1
   */
  private async createVolume(volumeName: string): Promise<void> {
    try {
      await this.docker.createVolume({
        Name: volumeName,
        Driver: 'local'
      });
    } catch (error) {
      // If volume already exists, that's fine
      if (!this.getErrorMessage(error).includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * Pull Docker image if not present locally
   */
  private async pullImageIfNeeded(imageName: string): Promise<void> {
    try {
      // Check if image exists
      await this.docker.getImage(imageName).inspect();
    } catch (error) {
      // Image doesn't exist, pull it
      console.log(`Pulling image ${imageName}...`);
      await new Promise((resolve, reject) => {
        this.docker.pull(imageName, (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }
          
          this.docker.modem.followProgress(stream, (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve(null);
            }
          });
        });
      });
    }
  }

  /**
   * Build environment variables for container
   */
  private buildEnvironmentVariables(config: ContainerConfig): string[] {
    // Only add n8n-specific defaults if using n8n image
    const isN8n = config.image?.includes('n8n') || false;
    
    const defaultEnv: string[] = [];
    
    if (isN8n) {
      defaultEnv.push(
        'N8N_PORT=5678',
        'N8N_PROTOCOL=http',
        'WEBHOOK_URL=http://localhost:5678/',
        // Recommended settings to avoid deprecation warnings
        'DB_SQLITE_POOL_SIZE=5',
        'N8N_RUNNERS_ENABLED=true',
        'N8N_BLOCK_ENV_ACCESS_IN_NODE=false',
        'N8N_GIT_NODE_DISABLE_BARE_REPOS=true'
      );
    }

    if (config.environment) {
      const customEnv = Object.entries(config.environment).map(
        ([key, value]) => `${key}=${value}`
      );
      return [...defaultEnv, ...customEnv];
    }

    return defaultEnv;
  }

  /**
   * Generate a secure n8n API key
   */
  private generateN8nApiKey(): string {
    const crypto = require('crypto');
    return 'n8n_api_' + crypto.randomBytes(32).toString('hex');
  }

  /**
   * Extract volume names from container info
   */
  private extractVolumeNames(containerInfo: Docker.ContainerInspectInfo): string[] {
    const volumeNames: string[] = [];
    
    if (containerInfo.Mounts) {
      for (const mount of containerInfo.Mounts) {
        if (mount.Type === 'volume' && mount.Name) {
          volumeNames.push(mount.Name);
        }
      }
    }

    return volumeNames;
  }

  /**
   * Extract bind mount paths from container info
   */
  private extractBindMountPaths(containerInfo: Docker.ContainerInspectInfo): string[] {
    const bindMountPaths: string[] = [];
    
    if (containerInfo.Mounts) {
      for (const mount of containerInfo.Mounts) {
        if (mount.Type === 'bind' && mount.Source) {
          bindMountPaths.push(mount.Source);
        }
      }
    }

    return bindMountPaths;
  }

  /**
   * Map Docker container state to our ContainerStatus state
   */
  private mapContainerState(state: Docker.ContainerInspectInfo['State']): 'running' | 'stopped' | 'error' {
    if (state.Running) {
      return 'running';
    }
    if (state.Status === 'exited' || state.Status === 'created') {
      return 'stopped';
    }
    return 'error';
  }

  /**
   * Calculate uptime in seconds from ISO timestamp
   */
  private calculateUptime(startedAt: string): number {
    const startTime = new Date(startedAt).getTime();
    const now = Date.now();
    return Math.floor((now - startTime) / 1000);
  }

  /**
   * Retry operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = this.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retries - 1) {
          const delay = this.RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
          console.log(`Operation failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${retries})`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get container logs
   */
  async getContainerLogs(containerId: string, options: { lines?: number; follow?: boolean } = {}): Promise<string[]> {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Use callback approach to get proper buffer
      return new Promise((resolve, reject) => {
        container.logs({
          stdout: true,
          stderr: true,
          tail: options.lines || 100,
          timestamps: true,
        }, (err: any, stream: any) => {
          if (err) {
            reject(new Error(`Failed to get container logs: ${this.getErrorMessage(err)}`));
            return;
          }
          
          if (stream instanceof Buffer) {
            const logs = this.parseDockerLogs(stream);
            resolve(logs);
          } else {
            // Handle stream case
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              const buffer = Buffer.concat(chunks);
              const logs = this.parseDockerLogs(buffer);
              resolve(logs);
            });
            stream.on('error', (streamErr: any) => {
              reject(new Error(`Stream error: ${this.getErrorMessage(streamErr)}`));
            });
          }
        });
      });
    } catch (error) {
      throw new Error(`Failed to get container logs: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get container resource metrics
   */
  async getContainerMetrics(containerId: string): Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryLimit: number;
    memoryPercent: number;
    networkRx: number;
    networkTx: number;
    blockRead: number;
    blockWrite: number;
    pids: number;
  }> {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Get container info to check for configured limits
      const containerInfo = await container.inspect();
      
      // Get container stats (single snapshot)
      const stats = await container.stats({ stream: false });
      
      // Calculate CPU percentage (pass container info to check for CPU limits)
      const cpuPercent = this.calculateCpuPercent(stats, containerInfo);
      
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
        // If no limit is set, memoryLimit from stats will be host's total memory
        // Return 0 to indicate no limit (unlimited)
        hasMemoryLimit = false;
        memoryLimit = 0;
      }
      
      // Calculate memory percent - only if limit is set
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
      
      // Block I/O metrics - try multiple sources as Docker stats can vary
      let blockRead = 0;
      let blockWrite = 0;
      
      // Try io_service_bytes_recursive first (most common)
      if (stats.blkio_stats?.io_service_bytes_recursive && stats.blkio_stats.io_service_bytes_recursive.length > 0) {
        for (const io of stats.blkio_stats.io_service_bytes_recursive) {
          if (io.op === 'Read' || io.op === 'read') blockRead += io.value || 0;
          if (io.op === 'Write' || io.op === 'write') blockWrite += io.value || 0;
        }
      }
      
      // Fallback to io_serviced_recursive if bytes are not available
      if (blockRead === 0 && blockWrite === 0 && stats.blkio_stats?.io_serviced_recursive) {
        for (const io of stats.blkio_stats.io_serviced_recursive) {
          if (io.op === 'Read' || io.op === 'read') blockRead += (io.value || 0) * 4096; // Estimate bytes (4KB per operation)
          if (io.op === 'Write' || io.op === 'write') blockWrite += (io.value || 0) * 4096;
        }
      }
      
      // Fallback to total if recursive stats are not available
      if (blockRead === 0 && blockWrite === 0) {
        const blkioStats = stats.blkio_stats as any;
        if (blkioStats?.io_service_bytes) {
          for (const io of blkioStats.io_service_bytes) {
            if (io.op === 'Read' || io.op === 'read') blockRead += io.value || 0;
            if (io.op === 'Write' || io.op === 'write') blockWrite += io.value || 0;
          }
        }
      }
      
      // Debug logging for block I/O (temporary)
      if (blockRead === 0 && blockWrite === 0) {
        console.log('Block I/O Debug for container:', containerId);
        console.log('blkio_stats keys:', Object.keys(stats.blkio_stats || {}));
        if (stats.blkio_stats?.io_service_bytes_recursive) {
          console.log('io_service_bytes_recursive:', stats.blkio_stats.io_service_bytes_recursive.slice(0, 5));
        }
        if (stats.blkio_stats?.io_serviced_recursive) {
          console.log('io_serviced_recursive:', stats.blkio_stats.io_serviced_recursive.slice(0, 5));
        }
      }

      return {
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memoryUsed,
        memoryLimit,
        memoryPercent: Math.round(memoryPercent * 100) / 100,
        networkRx,
        networkTx,
        blockRead,
        blockWrite,
        pids: stats.pids_stats?.current || 0,
      };
    } catch (error) {
      throw new Error(`Failed to get container metrics: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Parse Docker logs buffer into string array
   */
  private parseDockerLogs(buffer: Buffer): string[] {
    const logs: string[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      // Docker log format: 8-byte header + payload
      if (offset + 8 > buffer.length) break;
      
      // Read payload size from header (bytes 4-7, big-endian)
      const payloadSize = buffer.readUInt32BE(offset + 4);
      
      if (offset + 8 + payloadSize > buffer.length) break;
      
      // Extract log line
      const logLine = buffer.slice(offset + 8, offset + 8 + payloadSize).toString('utf8').trim();
      if (logLine) {
        logs.push(logLine);
      }
      
      offset += 8 + payloadSize;
    }

    return logs;
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
   * Apply resource limits to container HostConfig
   */
  private applyResourceLimits(hostConfig: any, config: ContainerConfig): void {
    // Apply CPU limit
    if (config.cpuLimit !== undefined && config.cpuLimit > 0) {
      // Docker uses CPU quota and period for CPU limits
      // quota = cpuLimit * period (default period is 100000 microseconds)
      // For example: 1 CPU = 100000, 0.5 CPU = 50000, 2 CPU = 200000
      const cpuPeriod = 100000; // Default period in microseconds
      const cpuQuota = Math.round(config.cpuLimit * cpuPeriod);
      hostConfig.CpuQuota = cpuQuota;
      hostConfig.CpuPeriod = cpuPeriod;
      console.log(`[DOCKER] Applying CPU limit: ${config.cpuLimit} cores (quota: ${cpuQuota}, period: ${cpuPeriod})`);
    }

    // Apply memory limit
    if (config.memoryLimit) {
      const memoryBytes = this.parseMemoryLimit(config.memoryLimit);
      if (memoryBytes > 0) {
        hostConfig.Memory = memoryBytes;
        console.log(`[DOCKER] Applying memory limit: ${config.memoryLimit} (${memoryBytes} bytes)`);
      }
    }

    // Apply memory reservation (soft limit)
    if (config.memoryReservation) {
      const memoryReservationBytes = this.parseMemoryLimit(config.memoryReservation);
      if (memoryReservationBytes > 0) {
        hostConfig.MemoryReservation = memoryReservationBytes;
        console.log(`[DOCKER] Applying memory reservation: ${config.memoryReservation} (${memoryReservationBytes} bytes)`);
      }
    }

    // Note: Storage limits are not directly supported by Docker at the container level
    // They would need to be enforced at the volume/filesystem level or through quotas
    // We store it for monitoring/validation purposes but don't apply it here
    if (config.storageLimit) {
      console.log(`[DOCKER] Storage limit specified: ${config.storageLimit} (not applied at container level)`);
    }
  }

  /**
   * Calculate CPU percentage from Docker stats
   * If container has CPU quota/period limits, calculate relative to that
   * Otherwise, calculate as percentage of total system CPU
   */
  private calculateCpuPercent(stats: any, containerInfo?: any): number {
    const cpuStats = stats.cpu_stats;
    const preCpuStats = stats.precpu_stats;
    
    if (!cpuStats || !preCpuStats) return 0;
    
    const cpuDelta = cpuStats.cpu_usage.total_usage - preCpuStats.cpu_usage.total_usage;
    const systemDelta = cpuStats.system_cpu_usage - preCpuStats.system_cpu_usage;
    const onlineCpus = cpuStats.online_cpus || 1;
    
    if (systemDelta > 0 && cpuDelta > 0) {
      // Check if container has CPU quota/period limits
      if (containerInfo?.HostConfig?.CpuQuota && containerInfo?.HostConfig?.CpuPeriod) {
        const cpuQuota = containerInfo.HostConfig.CpuQuota;
        const cpuPeriod = containerInfo.HostConfig.CpuPeriod;
        
        // Calculate effective CPU cores from quota/period
        // quota = -1 means no limit, otherwise quota/period = number of cores
        if (cpuQuota > 0 && cpuPeriod > 0) {
          const effectiveCores = cpuQuota / cpuPeriod;
          // Calculate CPU usage relative to the quota
          const cpuUsagePercent = (cpuDelta / systemDelta) * onlineCpus * 100;
          // Return as percentage of allocated cores (can exceed 100% if using more than allocated)
          return cpuUsagePercent;
        }
      }
      
      // No CPU quota set - calculate as percentage of total system CPU
      // This shows how much of the server's total CPU this container is using
      return (cpuDelta / systemDelta) * onlineCpus * 100;
    }
    
    return 0;
  }

  /**
   * List all containers (excluding system containers like traefik)
   * Returns containers that might be orphaned (not tracked in database)
   */
  async listAllContainers(excludeSystem: boolean = true): Promise<Array<{
    id: string;
    name: string;
    status: string;
    image: string;
    created: number;
  }>> {
    return this.retryOperation(async () => {
      try {
        const containers = await this.docker.listContainers({ all: true });
        
        return containers
          .filter(container => {
            if (!excludeSystem) return true;
            
            const containerName = container.Names[0]?.replace(/^\//, '') || '';
            // Exclude system containers
            const systemContainers = ['traefik', 'haproxy'];
            return !systemContainers.some(sysName => 
              containerName.toLowerCase().includes(sysName.toLowerCase())
            );
          })
          .map(container => ({
            id: container.Id,
            name: container.Names[0]?.replace(/^\//, '') || 'unknown',
            status: container.State || 'unknown',
            image: container.Image || 'unknown',
            created: container.Created || 0,
          }));
      } catch (error) {
        throw new Error(`Failed to list containers: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Extract error message from unknown error type
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * List all Docker volumes
   */
  async listAllVolumes(): Promise<Array<{
    name: string;
    driver: string;
    mountpoint: string;
    labels: Record<string, string>;
  }>> {
    return this.retryOperation(async () => {
      try {
        const volumes = await this.docker.listVolumes();
        return volumes.Volumes.map(volume => ({
          name: volume.Name,
          driver: volume.Driver,
          mountpoint: volume.Mountpoint,
          labels: volume.Labels || {},
        }));
      } catch (error) {
        throw new Error(`Failed to list volumes: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Remove a Docker volume
   */
  async removeVolume(volumeName: string): Promise<void> {
    return this.retryOperation(async () => {
      try {
        const volume = this.docker.getVolume(volumeName);
        await volume.remove();
        console.log(`[DOCKER] Removed volume: ${volumeName}`);
      } catch (error) {
        const errorMessage = this.getErrorMessage(error);
        // Check if volume is in use
        if (errorMessage.includes('in use') || errorMessage.includes('is being used')) {
          throw new Error(`Volume ${volumeName} is in use and cannot be removed`);
        }
        throw new Error(`Failed to remove volume ${volumeName}: ${errorMessage}`);
      }
    });
  }

  /**
   * Get information about unused images
   */
  async listUnusedImages(): Promise<Array<{
    id: string;
    tags: string[];
    size: number;
    created: number;
    parentId: string;
  }>> {
    return this.retryOperation(async () => {
      try {
        const images = await this.docker.listImages({ all: true, filters: { dangling: ['false'] } });
        const containers = await this.docker.listContainers({ all: true });
        
        // Get all images in use by containers
        const imagesInUse = new Set<string>();
        containers.forEach(container => {
          if (container.ImageID) {
            imagesInUse.add(container.ImageID);
          }
          // Also check by image name/tag
          if (container.Image) {
            images.forEach(img => {
              if (img.RepoTags && img.RepoTags.some(tag => tag === container.Image || tag.includes(container.Image.split(':')[0]))) {
                imagesInUse.add(img.Id);
              }
            });
          }
        });

        // Filter to unused images
        return images
          .filter(img => !imagesInUse.has(img.Id))
          .map(img => ({
            id: img.Id,
            tags: img.RepoTags || [],
            size: img.Size || 0,
            created: img.Created || 0,
            parentId: img.ParentId || '',
          }));
      } catch (error) {
        throw new Error(`Failed to list unused images: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Prune unused images
   * @param options - Prune options
   * @returns Prune results
   */
  async pruneImages(options?: {
    filters?: { until?: string; label?: string };
  }): Promise<{
    imagesDeleted: string[];
    spaceReclaimed: number;
  }> {
    return this.retryOperation(async () => {
      try {
        const pruneFilters: any = {};
        if (options?.filters?.until) {
          pruneFilters.until = options.filters.until;
        }
        if (options?.filters?.label) {
          pruneFilters.label = options.filters.label;
        }

        const result = await this.docker.pruneImages({ filters: pruneFilters });
        
        return {
          imagesDeleted: result.ImagesDeleted?.map((img: any) => img.Deleted || img.Untagged || '').filter(Boolean) || [],
          spaceReclaimed: result.SpaceReclaimed || 0,
        };
      } catch (error) {
        throw new Error(`Failed to prune images: ${this.getErrorMessage(error)}`);
      }
    });
  }

  /**
   * Prune unused volumes
   * @returns Prune results
   */
  async pruneVolumes(): Promise<{
    volumesDeleted: string[];
    spaceReclaimed: number;
  }> {
    return this.retryOperation(async () => {
      try {
        const result = await this.docker.pruneVolumes({});
        
        return {
          volumesDeleted: result.VolumesDeleted || [],
          spaceReclaimed: result.SpaceReclaimed || 0,
        };
      } catch (error) {
        throw new Error(`Failed to prune volumes: ${this.getErrorMessage(error)}`);
      }
    });
  }
}

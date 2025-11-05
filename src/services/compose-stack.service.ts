import Docker, { Container } from 'dockerode';
import { ComposeStackConfig, ComposeStackInfo } from '../types';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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

      // Write compose file
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');
      fs.writeFileSync(composeFilePath, config.composeFile, { mode: 0o644 });

      // Process environment variables and create .env file if needed
      if (config.environment && Object.keys(config.environment).length > 0) {
        const envContent = Object.entries(config.environment)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n');
        const envFilePath = path.join(stackDir, '.env');
        fs.writeFileSync(envFilePath, envContent, { mode: 0o644 });
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
          env: { ...process.env, ...config.environment }
        });
      } catch (error: any) {
        const errorMessage = error.stdout?.toString() || error.stderr?.toString() || error.message;
        throw new Error(`Failed to create compose stack: ${errorMessage}`);
      }

      // Get stack status
      const stackInfo = await this.getStackStatus(config.name);
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
    } = {}
  ): Promise<string[]> {
    try {
      const stackDir = path.join(this.COMPOSE_DIR, stackName);
      const composeFilePath = path.join(stackDir, 'docker-compose.yml');

      if (!fs.existsSync(composeFilePath)) {
        throw new Error(`Compose stack not found: ${stackName}`);
      }

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
            const stats = await container.stats({ stream: false });
            
            // Calculate CPU percentage
            const cpuPercent = this.calculateCpuPercent(stats);
            
            // Memory metrics
            const memoryUsed = stats.memory_stats?.usage || 0;
            const memoryLimit = stats.memory_stats?.limit || 0;
            const memoryPercent = memoryLimit > 0 ? (memoryUsed / memoryLimit) * 100 : 0;
            
            // Network metrics
            let networkRx = 0;
            let networkTx = 0;
            if (stats.networks) {
              for (const network of Object.values(stats.networks)) {
                networkRx += (network as any).rx_bytes || 0;
                networkTx += (network as any).tx_bytes || 0;
              }
            }

            const containerInfo = await container.inspect();
            const serviceName = containerInfo.Name.replace(/^\//, '').replace(/^.*_/, '');

            return {
              name: serviceName,
              cpuPercent,
              memoryUsed,
              memoryLimit,
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
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.inspect();
      // Volume exists
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Volume doesn't exist, create it
        await this.docker.createVolume({ Name: volumeName });
        console.log(`[COMPOSE] Created volume: ${volumeName}`);
      } else {
        throw error;
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


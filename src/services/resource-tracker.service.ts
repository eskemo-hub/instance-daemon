import { dockerManager } from '../utils/docker-manager';
import Docker from 'dockerode';
import logger from '../utils/logger';
import { databaseService } from './database.service';

/**
 * Resource limits
 */
export interface ResourceLimits {
  cpuLimit?: string; // e.g., "1.5" for 1.5 cores
  memoryLimit?: number; // bytes
  memoryReservation?: number; // bytes
}

/**
 * Resource usage
 */
export interface ResourceUsage {
  containerId: string;
  containerName: string;
  cpuUsage: number; // percentage
  memoryUsage: number; // bytes
  memoryLimit?: number; // bytes
  networkRx: number; // bytes
  networkTx: number; // bytes
  timestamp: number;
}

/**
 * Resource Tracker Service
 * Tracks and enforces resource limits per container
 */
export class ResourceTrackerService {
  private trackingInterval: NodeJS.Timeout | null = null;
  private resourceLimits: Map<string, ResourceLimits> = new Map();
  private usageHistory: Map<string, ResourceUsage[]> = new Map();
  private maxHistorySize: number = 100;

  /**
   * Set resource limits for a container
   */
  setLimits(containerId: string, limits: ResourceLimits): void {
    this.resourceLimits.set(containerId, limits);
    logger.info({ containerId, limits }, 'Resource limits set');
  }

  /**
   * Get resource limits for a container
   */
  getLimits(containerId: string): ResourceLimits | undefined {
    return this.resourceLimits.get(containerId);
  }

  /**
   * Remove resource limits for a container
   */
  removeLimits(containerId: string): void {
    this.resourceLimits.delete(containerId);
    this.usageHistory.delete(containerId);
  }

  /**
   * Start tracking resources
   */
  start(intervalSeconds: number = 60): void {
    if (this.trackingInterval) {
      logger.warn('Resource tracker already running');
      return;
    }

    logger.info({ intervalSeconds }, 'Starting resource tracker');

    // Track immediately
    this.trackResources();

    // Then track at intervals
    this.trackingInterval = setInterval(() => {
      this.trackResources();
    }, intervalSeconds * 1000);
  }

  /**
   * Stop tracking resources
   */
  stop(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
      logger.info('Resource tracker stopped');
    }
  }

  /**
   * Track resource usage for all containers
   */
  private async trackResources(): Promise<void> {
    try {
      const docker = dockerManager.getDocker();
      const containers = await docker.listContainers({ all: true });

      for (const containerInfo of containers) {
        const containerId = containerInfo.Id;
        const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';

        // Only track containers with limits set
        if (!this.resourceLimits.has(containerId)) {
          continue;
        }

        try {
          const usage = await this.getContainerUsage(containerId, containerName);
          this.recordUsage(containerId, usage);
          this.checkLimits(containerId, usage);
        } catch (error) {
          logger.error(
            { containerId, error: error instanceof Error ? error.message : String(error) },
            'Failed to track container resources'
          );
        }
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to track resources'
      );
    }
  }

  /**
   * Get container resource usage
   */
  private async getContainerUsage(containerId: string, containerName: string): Promise<ResourceUsage> {
    const docker = dockerManager.getDocker();
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    // Calculate CPU usage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuUsage = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

    // Memory usage
    const memoryUsage = stats.memory_stats.usage || 0;
    const memoryLimit = stats.memory_stats.limit;

    // Network usage
    const networks = stats.networks || {};
    let networkRx = 0;
    let networkTx = 0;

    for (const network of Object.values(networks)) {
      networkRx += (network as any).rx_bytes || 0;
      networkTx += (network as any).tx_bytes || 0;
    }

    return {
      containerId,
      containerName,
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      memoryUsage,
      memoryLimit,
      networkRx,
      networkTx,
      timestamp: Date.now()
    };
  }

  /**
   * Record usage in history
   */
  private recordUsage(containerId: string, usage: ResourceUsage): void {
    if (!this.usageHistory.has(containerId)) {
      this.usageHistory.set(containerId, []);
    }

    const history = this.usageHistory.get(containerId)!;
    history.push(usage);

    // Limit history size
    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    // Store in database
    this.storeUsage(usage);
  }

  /**
   * Store usage in database
   */
  private storeUsage(usage: ResourceUsage): void {
    try {
      const db = databaseService.getDatabase();
      db.prepare(`
        INSERT INTO metrics_cache (container_id, metric_type, value, timestamp)
        VALUES (?, ?, ?, ?)
      `).run(
        usage.containerId,
        'resource_usage',
        JSON.stringify(usage),
        usage.timestamp
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to store resource usage'
      );
    }
  }

  /**
   * Check if container exceeds limits
   */
  private checkLimits(containerId: string, usage: ResourceUsage): void {
    const limits = this.resourceLimits.get(containerId);
    if (!limits) {
      return;
    }

    const violations: string[] = [];

    // Check CPU limit
    if (limits.cpuLimit) {
      const cpuLimitNum = parseFloat(limits.cpuLimit);
      if (usage.cpuUsage > cpuLimitNum * 100) {
        violations.push(`CPU usage ${usage.cpuUsage.toFixed(2)}% exceeds limit ${cpuLimitNum * 100}%`);
      }
    }

    // Check memory limit
    if (limits.memoryLimit && usage.memoryUsage > limits.memoryLimit) {
      violations.push(
        `Memory usage ${(usage.memoryUsage / 1024 / 1024).toFixed(2)}MB exceeds limit ${(limits.memoryLimit / 1024 / 1024).toFixed(2)}MB`
      );
    }

    if (violations.length > 0) {
      logger.warn(
        { containerId, violations },
        'Container resource limits exceeded'
      );
    }
  }

  /**
   * Get usage history for a container
   */
  getUsageHistory(containerId: string, hours: number = 24): ResourceUsage[] {
    const history = this.usageHistory.get(containerId) || [];
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    return history.filter(usage => usage.timestamp >= cutoff);
  }

  /**
   * Get current usage for a container
   */
  async getCurrentUsage(containerId: string): Promise<ResourceUsage | null> {
    try {
      const docker = dockerManager.getDocker();
      const container = docker.getContainer(containerId);
      const info = await container.inspect();
      const containerName = info.Name.replace(/^\//, '');

      return await this.getContainerUsage(containerId, containerName);
    } catch (error) {
      logger.error(
        { containerId, error: error instanceof Error ? error.message : String(error) },
        'Failed to get current usage'
      );
      return null;
    }
  }

  /**
   * Get all tracked containers
   */
  getTrackedContainers(): string[] {
    return Array.from(this.resourceLimits.keys());
  }
}

export const resourceTracker = new ResourceTrackerService();


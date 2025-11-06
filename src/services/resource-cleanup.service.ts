import { dockerManager } from '../utils/docker-manager';
import Docker from 'dockerode';
import logger from '../utils/logger';
import { execCommand } from '../utils/exec-async';

/**
 * Resource Cleanup Service
 * Automatically cleans up stopped containers, orphaned volumes, and monitors disk space
 */
export class ResourceCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private diskCheckInterval: NodeJS.Timeout | null = null;
  private readonly maxStoppedContainerAge: number; // milliseconds
  private readonly diskUsageThreshold: number; // percentage
  private readonly cleanupEnabled: boolean;

  constructor() {
    this.maxStoppedContainerAge = parseInt(
      process.env.CLEANUP_MAX_STOPPED_AGE_MS || String(7 * 24 * 60 * 60 * 1000),
      10
    ); // 7 days default
    this.diskUsageThreshold = parseInt(
      process.env.CLEANUP_DISK_THRESHOLD || '85',
      10
    ); // 85% default
    this.cleanupEnabled = process.env.CLEANUP_ENABLED !== 'false';
  }

  /**
   * Start automatic cleanup
   */
  start(cleanupIntervalHours: number = 24, diskCheckIntervalHours: number = 1): void {
    if (!this.cleanupEnabled) {
      logger.info('Resource cleanup is disabled');
      return;
    }

    if (this.cleanupInterval) {
      logger.warn('Resource cleanup already running');
      return;
    }

    logger.info(
      { cleanupIntervalHours, diskCheckIntervalHours },
      'Starting resource cleanup service'
    );

    // Run cleanup immediately
    this.performCleanup();

    // Then run at intervals
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, cleanupIntervalHours * 60 * 60 * 1000);

    // Check disk usage more frequently
    this.diskCheckInterval = setInterval(() => {
      this.checkDiskUsage();
    }, diskCheckIntervalHours * 60 * 60 * 1000);
  }

  /**
   * Stop automatic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.diskCheckInterval) {
      clearInterval(this.diskCheckInterval);
      this.diskCheckInterval = null;
    }

    logger.info('Resource cleanup stopped');
  }

  /**
   * Perform cleanup operations
   */
  async performCleanup(): Promise<void> {
    if (!this.cleanupEnabled) {
      return;
    }

    logger.info('Starting resource cleanup');

    try {
      const results = {
        stoppedContainers: await this.cleanupStoppedContainers(),
        orphanedVolumes: await this.cleanupOrphanedVolumes(),
        danglingImages: await this.cleanupDanglingImages(),
        unusedNetworks: await this.cleanupUnusedNetworks()
      };

      logger.info(results, 'Resource cleanup completed');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Resource cleanup failed'
      );
    }
  }

  /**
   * Cleanup stopped containers older than threshold
   */
  private async cleanupStoppedContainers(): Promise<number> {
    try {
      const docker = dockerManager.getDocker();
      const containers = await docker.listContainers({ all: true });
      const now = Date.now();
      let cleaned = 0;

      for (const containerInfo of containers) {
        if (containerInfo.State === 'exited' || containerInfo.State === 'dead') {
          const container = docker.getContainer(containerInfo.Id);
          const inspect = await container.inspect();

          // Check container age
          const finishedAt = inspect.State.FinishedAt
            ? new Date(inspect.State.FinishedAt).getTime()
            : 0;

          if (finishedAt > 0 && (now - finishedAt) > this.maxStoppedContainerAge) {
            try {
              await container.remove({ force: true });
              cleaned++;
              logger.debug({ id: containerInfo.Id, name: containerInfo.Names[0] }, 'Removed stopped container');
            } catch (error) {
              logger.warn(
                { id: containerInfo.Id, error: error instanceof Error ? error.message : String(error) },
                'Failed to remove stopped container'
              );
            }
          }
        }
      }

      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up stopped containers');
      }

      return cleaned;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to cleanup stopped containers'
      );
      return 0;
    }
  }

  /**
   * Cleanup orphaned volumes
   */
  private async cleanupOrphanedVolumes(): Promise<number> {
    try {
      // Use docker system prune for volumes
      const result = await execCommand('docker volume prune -f');
      const output = result.stdout || result.stderr || '';
      
      // Parse output to count cleaned volumes
      const match = output.match(/(\d+)\s+volumes?/i);
      const cleaned = match ? parseInt(match[1], 10) : 0;

      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up orphaned volumes');
      }

      return cleaned;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to cleanup orphaned volumes'
      );
      return 0;
    }
  }

  /**
   * Cleanup dangling images
   */
  private async cleanupDanglingImages(): Promise<number> {
    try {
      const result = await execCommand('docker image prune -f');
      const output = result.stdout || result.stderr || '';
      
      const match = output.match(/(\d+)\s+images?/i);
      const cleaned = match ? parseInt(match[1], 10) : 0;

      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up dangling images');
      }

      return cleaned;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to cleanup dangling images'
      );
      return 0;
    }
  }

  /**
   * Cleanup unused networks
   */
  private async cleanupUnusedNetworks(): Promise<number> {
    try {
      const result = await execCommand('docker network prune -f');
      const output = result.stdout || result.stderr || '';
      
      const match = output.match(/(\d+)\s+networks?/i);
      const cleaned = match ? parseInt(match[1], 10) : 0;

      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up unused networks');
      }

      return cleaned;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to cleanup unused networks'
      );
      return 0;
    }
  }

  /**
   * Check disk usage and trigger cleanup if needed
   */
  private async checkDiskUsage(): Promise<void> {
    try {
      const { stdout } = await execCommand("df -h / | tail -1 | awk '{print $5}' | sed 's/%//'");
      const usage = parseInt(stdout.trim(), 10);

      if (usage > this.diskUsageThreshold) {
        logger.warn(
          { usage, threshold: this.diskUsageThreshold },
          'Disk usage exceeds threshold, performing aggressive cleanup'
        );
        
        // Perform more aggressive cleanup
        await this.performAggressiveCleanup();
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to check disk usage'
      );
    }
  }

  /**
   * Perform aggressive cleanup when disk is full
   */
  private async performAggressiveCleanup(): Promise<void> {
    try {
      // Remove all stopped containers regardless of age
      const docker = dockerManager.getDocker();
      const containers = await docker.listContainers({ all: true });
      let cleaned = 0;

      for (const containerInfo of containers) {
        if (containerInfo.State === 'exited' || containerInfo.State === 'dead') {
          try {
            const container = docker.getContainer(containerInfo.Id);
            await container.remove({ force: true });
            cleaned++;
          } catch (error) {
            // Continue with next container
          }
        }
      }

      // Prune system
      await execCommand('docker system prune -af --volumes');

      logger.info({ cleaned }, 'Aggressive cleanup completed');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Aggressive cleanup failed'
      );
    }
  }

  /**
   * Manual cleanup trigger
   */
  async manualCleanup(options: {
    stoppedContainers?: boolean;
    orphanedVolumes?: boolean;
    danglingImages?: boolean;
    unusedNetworks?: boolean;
  } = {}): Promise<{
    stoppedContainers: number;
    orphanedVolumes: number;
    danglingImages: number;
    unusedNetworks: number;
  }> {
    const results = {
      stoppedContainers: 0,
      orphanedVolumes: 0,
      danglingImages: 0,
      unusedNetworks: 0
    };

    if (options.stoppedContainers !== false) {
      results.stoppedContainers = await this.cleanupStoppedContainers();
    }

    if (options.orphanedVolumes !== false) {
      results.orphanedVolumes = await this.cleanupOrphanedVolumes();
    }

    if (options.danglingImages !== false) {
      results.danglingImages = await this.cleanupDanglingImages();
    }

    if (options.unusedNetworks !== false) {
      results.unusedNetworks = await this.cleanupUnusedNetworks();
    }

    return results;
  }
}

export const resourceCleanupService = new ResourceCleanupService();


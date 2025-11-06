import Docker from 'dockerode';
import logger from './logger';

/**
 * Docker connection manager with connection pooling
 * Reuses Docker connections to improve performance
 */
class DockerManager {
  private docker: Docker | null = null;
  private readonly socketPath = '/var/run/docker.sock';

  /**
   * Get or create Docker connection
   * Reuses existing connection if available
   */
  getDocker(): Docker {
    if (!this.docker) {
      logger.debug({ socketPath: this.socketPath }, 'Creating new Docker connection');
      this.docker = new Docker({ socketPath: this.socketPath });
    }
    return this.docker;
  }

  /**
   * Test Docker connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const docker = this.getDocker();
      await docker.ping();
      logger.debug('Docker connection test successful');
      return true;
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Docker connection test failed');
      return false;
    }
  }

  /**
   * Reset Docker connection (useful for recovery)
   */
  resetConnection(): void {
    logger.debug('Resetting Docker connection');
    this.docker = null;
  }

  /**
   * Get Docker info
   */
  async getInfo(): Promise<Docker.DockerInfo> {
    const docker = this.getDocker();
    return await docker.info();
  }
}

// Export singleton instance
export const dockerManager = new DockerManager();


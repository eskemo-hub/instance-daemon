import Docker from 'dockerode';

/**
 * ContainerLogsService handles Docker container log retrieval
 */

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export class ContainerLogsService {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * Get container logs
   */
  async getContainerLogs(
    containerId: string,
    options: {
      tail?: number;
      since?: number;
      timestamps?: boolean;
    } = {}
  ): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: options.timestamps ?? true,
        tail: options.tail ?? 100,
        since: options.since,
        follow: false,
      });

      // Convert buffer to string
      return logBuffer.toString();
    } catch (error) {
      throw new Error(`Failed to get logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse log lines and extract level
   */
  parseLogLines(logs: string): LogEntry[] {
    const lines = logs.split('\n').filter(line => line.trim());
    
    return lines.map(line => {
      // Remove Docker stream headers (8 bytes)
      const cleanLine = line.replace(/^[\x00-\x08]/, '');
      
      // Extract timestamp if present
      const timestampMatch = cleanLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.+)$/);
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
      const message = timestampMatch ? timestampMatch[2] : cleanLine;

      // Detect log level
      let level: 'info' | 'warn' | 'error' | 'debug' = 'info';
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('fail')) {
        level = 'error';
      } else if (message.toLowerCase().includes('warn')) {
        level = 'warn';
      } else if (message.toLowerCase().includes('debug')) {
        level = 'debug';
      }

      return {
        timestamp,
        level,
        message: message.trim(),
      };
    });
  }

  /**
   * Get logs filtered by level
   */
  async getFilteredLogs(
    containerId: string,
    level: 'info' | 'warn' | 'error' | 'debug' | 'all',
    tail: number = 100
  ): Promise<LogEntry[]> {
    const logs = await this.getContainerLogs(containerId, { tail, timestamps: true });
    const parsed = this.parseLogLines(logs);

    if (level === 'all') {
      return parsed;
    }

    return parsed.filter(entry => entry.level === level);
  }

  /**
   * Search logs for a specific term
   */
  async searchLogs(
    containerId: string,
    searchTerm: string,
    tail: number = 500
  ): Promise<LogEntry[]> {
    const logs = await this.getContainerLogs(containerId, { tail, timestamps: true });
    const parsed = this.parseLogLines(logs);

    const lowerSearch = searchTerm.toLowerCase();
    return parsed.filter(entry => 
      entry.message.toLowerCase().includes(lowerSearch)
    );
  }

  /**
   * Get logs since a specific timestamp
   */
  async getLogsSince(
    containerId: string,
    sinceTimestamp: number
  ): Promise<LogEntry[]> {
    const logs = await this.getContainerLogs(containerId, { 
      since: sinceTimestamp,
      timestamps: true 
    });
    return this.parseLogLines(logs);
  }
}

// Export singleton instance
export const containerLogsService = new ContainerLogsService();

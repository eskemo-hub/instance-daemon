import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Log rotation configuration
 */
export interface LogRotationConfig {
  maxSize: number; // Max file size in bytes
  maxFiles: number; // Number of rotated files to keep
  retentionDays: number; // Days to keep logs
  logDir: string; // Log directory
  compress: boolean; // Compress old logs
}

/**
 * Log Rotation Service
 * Manages log file rotation and retention
 */
export class LogRotationService {
  private rotationInterval: NodeJS.Timeout | null = null;
  private config: LogRotationConfig;

  constructor(config: Partial<LogRotationConfig> = {}) {
    this.config = {
      maxSize: config.maxSize || 10 * 1024 * 1024, // 10MB default
      maxFiles: config.maxFiles || 5,
      retentionDays: config.retentionDays || 7,
      logDir: config.logDir || '/opt/n8n-daemon/logs',
      compress: config.compress || false
    };

    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Start automatic log rotation
   */
  start(intervalHours: number = 24): void {
    if (this.rotationInterval) {
      logger.warn('Log rotation already running');
      return;
    }

    logger.info({ intervalHours }, 'Starting log rotation service');

    // Rotate immediately
    this.rotate();

    // Then rotate at intervals
    this.rotationInterval = setInterval(() => {
      this.rotate();
    }, intervalHours * 60 * 60 * 1000);
  }

  /**
   * Stop log rotation
   */
  stop(): void {
    if (this.rotationInterval) {
      clearInterval(this.rotationInterval);
      this.rotationInterval = null;
      logger.info('Log rotation stopped');
    }
  }

  /**
   * Rotate logs
   */
  rotate(): void {
    try {
      logger.info('Starting log rotation');

      // Rotate daemon logs
      this.rotateLogFile('daemon.log');
      
      // Rotate audit logs
      this.rotateLogFile('audit.log');

      // Clean old logs
      this.cleanOldLogs();

      logger.info('Log rotation completed');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Log rotation failed'
      );
    }
  }

  /**
   * Rotate a specific log file
   */
  private rotateLogFile(filename: string): void {
    const logPath = path.join(this.config.logDir, filename);

    if (!fs.existsSync(logPath)) {
      return;
    }

    const stats = fs.statSync(logPath);
    
    // Check if rotation is needed
    if (stats.size < this.config.maxSize) {
      return;
    }

    // Find next rotation number
    let rotationNumber = 1;
    while (rotationNumber <= this.config.maxFiles) {
      const rotatedPath = `${logPath}.${rotationNumber}`;
      if (!fs.existsSync(rotatedPath)) {
        break;
      }
      rotationNumber++;
    }

    // If we've exceeded max files, remove oldest
    if (rotationNumber > this.config.maxFiles) {
      const oldestPath = `${logPath}.${this.config.maxFiles}`;
      if (fs.existsSync(oldestPath)) {
        fs.unlinkSync(oldestPath);
      }
      rotationNumber = this.config.maxFiles;
    }

    // Shift existing rotated files
    for (let i = rotationNumber - 1; i >= 1; i--) {
      const oldPath = `${logPath}.${i}`;
      const newPath = `${logPath}.${i + 1}`;
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }

    // Rotate current log
    const rotatedPath = `${logPath}.1`;
    fs.renameSync(logPath, rotatedPath);

    // Compress if enabled
    if (this.config.compress && rotatedPath.endsWith('.1')) {
      // Compression would be implemented with zlib or external tool
      logger.debug({ path: rotatedPath }, 'Log file rotated (compression not implemented)');
    }

    logger.info({ filename, size: stats.size, rotatedTo: rotatedPath }, 'Log file rotated');
  }

  /**
   * Clean old logs based on retention policy
   */
  private cleanOldLogs(): void {
    const cutoff = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
    let cleaned = 0;

    try {
      const files = fs.readdirSync(this.config.logDir);

      for (const file of files) {
        const filePath = path.join(this.config.logDir, file);
        const stats = fs.statSync(filePath);

        // Check if file is older than retention period
        if (stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned old log files');
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to clean old logs'
      );
    }
  }

  /**
   * Get log statistics
   */
  getStats(): {
    logDir: string;
    totalSize: number;
    fileCount: number;
    oldestLog: number | null;
    newestLog: number | null;
  } {
    let totalSize = 0;
    let fileCount = 0;
    let oldestLog: number | null = null;
    let newestLog: number | null = null;

    try {
      const files = fs.readdirSync(this.config.logDir);

      for (const file of files) {
        const filePath = path.join(this.config.logDir, file);
        const stats = fs.statSync(filePath);

        totalSize += stats.size;
        fileCount++;

        if (oldestLog === null || stats.mtimeMs < oldestLog) {
          oldestLog = stats.mtimeMs;
        }
        if (newestLog === null || stats.mtimeMs > newestLog) {
          newestLog = stats.mtimeMs;
        }
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to get log statistics'
      );
    }

    return {
      logDir: this.config.logDir,
      totalSize,
      fileCount,
      oldestLog,
      newestLog
    };
  }
}

export const logRotationService = new LogRotationService();


import { Request, Response, NextFunction } from 'express';
import { dockerManager } from '../utils/docker-manager';
import logger from '../utils/logger';
import { configManager } from '../services/config-manager.service';
import { databaseService } from '../services/database.service';

/**
 * Service health status
 */
interface ServiceHealth {
  docker: boolean;
  database: boolean;
  disk: boolean;
}

/**
 * Degradation mode
 */
export type DegradationMode = 'normal' | 'read-only' | 'degraded' | 'maintenance';

/**
 * Graceful degradation middleware
 * Handles fallback modes and degraded operation support
 */
export class GracefulDegradationService {
  private mode: DegradationMode = 'normal';
  private serviceHealth: ServiceHealth = {
    docker: true,
    database: true,
    disk: true
  };
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHealthMonitoring();
  }

  /**
   * Start monitoring service health
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.checkServiceHealth();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Check service health
   */
  private async checkServiceHealth(): Promise<void> {
    const health: ServiceHealth = {
      docker: await this.checkDocker(),
      database: await this.checkDatabase(),
      disk: await this.checkDisk()
    };

    this.serviceHealth = health;

    // Determine degradation mode
    if (!health.docker && !health.database) {
      this.setMode('maintenance');
    } else if (!health.docker || !health.database) {
      this.setMode('degraded');
    } else if (!health.disk) {
      this.setMode('read-only');
    } else {
      this.setMode('normal');
    }
  }

  /**
   * Check Docker service
   */
  private async checkDocker(): Promise<boolean> {
    try {
      return await dockerManager.testConnection();
    } catch (error) {
      return false;
    }
  }

  /**
   * Check database service
   */
  private async checkDatabase(): Promise<boolean> {
    try {
      const db = databaseService.getDatabase();
      db.prepare('SELECT 1').get();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check disk space
   */
  private async checkDisk(): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $5}' | sed 's/%//'");
      const usage = parseInt(stdout.trim(), 10);
      return usage < 95; // Disk is healthy if usage < 95%
    } catch (error) {
      return false;
    }
  }

  /**
   * Set degradation mode
   */
  setMode(mode: DegradationMode): void {
    if (this.mode !== mode) {
      logger.warn({ from: this.mode, to: mode }, 'Degradation mode changed');
      this.mode = mode;
      configManager.set('degradation_mode', mode);
    }
  }

  /**
   * Get current mode
   */
  getMode(): DegradationMode {
    return this.mode;
  }

  /**
   * Get service health
   */
  getServiceHealth(): ServiceHealth {
    return { ...this.serviceHealth };
  }

  /**
   * Check if operation is allowed in current mode
   */
  isOperationAllowed(method: string, path: string): boolean {
    if (this.mode === 'maintenance') {
      return path === '/api/health'; // Only health checks allowed
    }

    if (this.mode === 'read-only') {
      // Only GET requests allowed
      return method === 'GET' || path === '/api/health';
    }

    if (this.mode === 'degraded') {
      // Read operations and critical writes allowed
      if (method === 'GET') {
        return true;
      }
      // Allow critical operations even in degraded mode
      const criticalPaths = ['/api/containers/:id/stop', '/api/compose/:stackName/stop'];
      return criticalPaths.some(critical => path.includes(critical.split(':')[0]));
    }

    return true; // Normal mode - all operations allowed
  }

  /**
   * Get degraded response
   */
  getDegradedResponse(): { mode: DegradationMode; message: string; allowedOperations: string[] } {
    const allowedOperations: string[] = [];

    if (this.mode === 'read-only') {
      allowedOperations.push('GET requests', 'Health checks');
    } else if (this.mode === 'degraded') {
      allowedOperations.push('GET requests', 'Critical stop operations', 'Health checks');
    } else if (this.mode === 'maintenance') {
      allowedOperations.push('Health checks only');
    } else {
      allowedOperations.push('All operations');
    }

    return {
      mode: this.mode,
      message: `Service is operating in ${this.mode} mode`,
      allowedOperations
    };
  }
}

export const gracefulDegradation = new GracefulDegradationService();

/**
 * Graceful degradation middleware
 */
export function gracefulDegradationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip for health checks
  if (req.path === '/api/health') {
    return next();
  }

  const allowed = gracefulDegradation.isOperationAllowed(req.method, req.path);

  if (!allowed) {
    const degraded = gracefulDegradation.getDegradedResponse();
    return res.status(503).json({
      success: false,
      error: 'ServiceUnavailable',
      message: degraded.message,
      mode: degraded.mode,
      allowedOperations: degraded.allowedOperations
    });
  }

  next();
}


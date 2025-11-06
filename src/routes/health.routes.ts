import { Router, Request, Response, NextFunction } from 'express';
import { HealthService } from '../services/health.service';
import { createCacheMiddleware } from '../middleware/cache.middleware';
import { healthMetricsCache } from '../utils/cache';

/**
 * Health check routes
 * Requirements: 13.1, 13.2
 */
export const healthRoutes = Router();

const healthService = new HealthService();

// Apply caching middleware (30 second TTL)
healthRoutes.use(createCacheMiddleware({
  cache: healthMetricsCache,
  ttl: 30000
}));

/**
 * GET /api/health
 * Get system health metrics
 * Requirements: 13.1, 13.2
 */
healthRoutes.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Collect all health metrics (Requirement 13.2)
    const [cpuUsage, memoryUsage, diskUsage, dockerStatus] = await Promise.all([
      healthService.getCpuUsage(),
      healthService.getMemoryUsage(),
      healthService.getDiskUsage(),
      healthService.getDockerStatus()
    ]);

    // Get version from package.json
    const packageJson = require('../../package.json');
    
    const healthMetrics = {
      cpuUsage,
      memoryUsed: memoryUsage.used,
      memoryTotal: memoryUsage.total,
      diskUsed: diskUsage.used,
      diskTotal: diskUsage.total,
      dockerStatus,
      version: packageJson.version,
      timestamp: new Date().toISOString()
    };

    res.status(200).json({
      success: true,
      data: healthMetrics
    });
  } catch (error) {
    next(error);
  }
});

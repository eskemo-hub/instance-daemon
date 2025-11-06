import { Router, Request, Response, NextFunction } from 'express';
import { gracefulDegradation } from '../middleware/graceful-degradation.middleware';
import { getPerformanceStats } from '../middleware/performance.middleware';
import { eventBus } from '../services/event-bus.service';
import { jobQueueService } from '../services/job-queue.service';
import { resourceCleanupService } from '../services/resource-cleanup.service';
import { logRotationService } from '../services/log-rotation.service';

export const statusRoutes = Router();

/**
 * GET /api/status
 * Get comprehensive system status
 */
statusRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const degradation = gracefulDegradation.getDegradedResponse();
    const serviceHealth = gracefulDegradation.getServiceHealth();
    const performance = getPerformanceStats({ limit: 1000 });
    const jobStats = jobQueueService.getStats();

    return res.status(200).json({
      success: true,
      data: {
        degradation,
        serviceHealth,
        performance,
        jobs: jobStats,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/status/degradation
 * Get degradation mode information
 */
statusRoutes.get('/degradation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const degradation = gracefulDegradation.getDegradedResponse();
    const serviceHealth = gracefulDegradation.getServiceHealth();

    return res.status(200).json({
      success: true,
      data: {
        ...degradation,
        serviceHealth
      }
    });
  } catch (error) {
    next(error);
  }
});


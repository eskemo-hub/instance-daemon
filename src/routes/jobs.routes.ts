import { Router, Request, Response, NextFunction } from 'express';
import { jobQueueService } from '../services/job-queue.service';
import { ValidationError } from '../middleware/error.middleware';

export const jobsRoutes = Router();

/**
 * GET /api/jobs/:id
 * Get job status
 */
jobsRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Job ID is required');
    }

    const job = jobQueueService.getJob(id);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: job
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs
 * List jobs by status
 */
jobsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string) || 100;

    const jobs = jobQueueService.getJobsByStatus(
      status as any || 'pending',
      limit
    );

    return res.status(200).json({
      success: true,
      data: jobs,
      count: jobs.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs/stats
 * Get job queue statistics
 */
jobsRoutes.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = jobQueueService.getStats();

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
});


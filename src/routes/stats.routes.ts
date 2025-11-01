import { Router, Request, Response } from 'express';
import { containerStatsService } from '../services/container-stats.service';
import { apiSuccess, apiError } from '../utils/api-response';

const router = Router();

/**
 * Get stats for a specific container
 * POST /api/stats/container
 */
router.post('/container', async (req: Request, res: Response) => {
  try {
    const { containerId } = req.body;

    if (!containerId) {
      return res.status(400).json(apiError('Container ID is required'));
    }

    const stats = await containerStatsService.getContainerStats(containerId);

    return res.json(apiSuccess(stats));
  } catch (error) {
    console.error('Failed to get container stats:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get container stats'
    ));
  }
});

/**
 * Get stats for multiple containers
 * POST /api/stats/containers
 */
router.post('/containers', async (req: Request, res: Response) => {
  try {
    const { containerIds } = req.body;

    if (!containerIds || !Array.isArray(containerIds)) {
      return res.status(400).json(apiError('Container IDs array is required'));
    }

    const stats = await containerStatsService.getMultipleContainerStats(containerIds);

    return res.json(apiSuccess({
      stats,
      count: stats.length,
    }));
  } catch (error) {
    console.error('Failed to get container stats:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get container stats'
    ));
  }
});

/**
 * List all n8n containers
 * GET /api/stats/list
 */
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const containers = await containerStatsService.listN8nContainers();

    return res.json(apiSuccess({
      containers,
      count: containers.length,
    }));
  } catch (error) {
    console.error('Failed to list containers:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to list containers'
    ));
  }
});

export default router;

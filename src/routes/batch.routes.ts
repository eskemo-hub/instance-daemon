import { Router, Request, Response, NextFunction } from 'express';
import { DockerService } from '../services/docker.service';
import { ComposeStackService } from '../services/compose-stack.service';
import { ValidationError } from '../middleware/error.middleware';
import logger from '../utils/logger';

export const batchRoutes = Router();

const dockerService = new DockerService();
const composeStackService = new ComposeStackService();

/**
 * POST /api/batch/containers/start
 * Start multiple containers in parallel
 */
batchRoutes.post('/containers/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { containerIds } = req.body;

    if (!Array.isArray(containerIds) || containerIds.length === 0) {
      throw new ValidationError('containerIds must be a non-empty array');
    }

    if (containerIds.length > 50) {
      throw new ValidationError('Maximum 50 containers per batch operation');
    }

    logger.info({ count: containerIds.length }, 'Starting batch container start');

    // Execute in parallel with concurrency limit
    const results = await executeBatch(
      containerIds,
      async (id: string) => {
        try {
          await dockerService.startContainer(id);
          return { id, success: true };
        } catch (error) {
          return {
            id,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      10 // Max 10 concurrent operations
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      data: {
        total: containerIds.length,
        successful,
        failed,
        results
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/batch/containers/stop
 * Stop multiple containers in parallel
 */
batchRoutes.post('/containers/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { containerIds } = req.body;

    if (!Array.isArray(containerIds) || containerIds.length === 0) {
      throw new ValidationError('containerIds must be a non-empty array');
    }

    if (containerIds.length > 50) {
      throw new ValidationError('Maximum 50 containers per batch operation');
    }

    logger.info({ count: containerIds.length }, 'Starting batch container stop');

    const results = await executeBatch(
      containerIds,
      async (id: string) => {
        try {
          await dockerService.stopContainer(id);
          return { id, success: true };
        } catch (error) {
          return {
            id,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      10
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      data: {
        total: containerIds.length,
        successful,
        failed,
        results
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/batch/containers/restart
 * Restart multiple containers in parallel
 */
batchRoutes.post('/containers/restart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { containerIds } = req.body;

    if (!Array.isArray(containerIds) || containerIds.length === 0) {
      throw new ValidationError('containerIds must be a non-empty array');
    }

    if (containerIds.length > 50) {
      throw new ValidationError('Maximum 50 containers per batch operation');
    }

    logger.info({ count: containerIds.length }, 'Starting batch container restart');

    const results = await executeBatch(
      containerIds,
      async (id: string) => {
        try {
          await dockerService.restartContainer(id);
          return { id, success: true };
        } catch (error) {
          return {
            id,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      10
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      data: {
        total: containerIds.length,
        successful,
        failed,
        results
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/batch/containers/status
 * Get status for multiple containers
 */
batchRoutes.post('/containers/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { containerIds } = req.body;

    if (!Array.isArray(containerIds) || containerIds.length === 0) {
      throw new ValidationError('containerIds must be a non-empty array');
    }

    if (containerIds.length > 100) {
      throw new ValidationError('Maximum 100 containers per status check');
    }

    const results = await executeBatch(
      containerIds,
      async (id: string) => {
        try {
          const status = await dockerService.getContainerStatus(id);
          return { id, success: true, data: status };
        } catch (error) {
          return {
            id,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      20 // Higher concurrency for read operations
    );

    res.status(200).json({
      success: true,
      data: {
        total: containerIds.length,
        results
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/batch/compose/start
 * Start multiple compose stacks
 */
batchRoutes.post('/compose/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackNames } = req.body;

    if (!Array.isArray(stackNames) || stackNames.length === 0) {
      throw new ValidationError('stackNames must be a non-empty array');
    }

    if (stackNames.length > 20) {
      throw new ValidationError('Maximum 20 stacks per batch operation');
    }

    logger.info({ count: stackNames.length }, 'Starting batch compose start');

    const results = await executeBatch(
      stackNames,
      async (name: string) => {
        try {
          await composeStackService.startStack(name);
          return { id: name, success: true };
        } catch (error) {
          return {
            id: name,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      },
      5 // Lower concurrency for compose operations
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      data: {
        total: stackNames.length,
        successful,
        failed,
        results
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Execute batch operations with concurrency limit
 */
async function executeBatch<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = operation(item).then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }

  // Wait for remaining operations
  await Promise.all(executing);

  return results;
}


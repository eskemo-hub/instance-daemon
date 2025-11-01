import { Router, Request, Response, NextFunction } from 'express';
import { DockerService } from '../services/docker.service';
import { ContainerConfig } from '../types';
import { ValidationError } from '../middleware/error.middleware';

/**
 * Container management routes
 * Requirements: 5.2, 5.3, 5.4, 8.2, 8.3, 8.4, 8.5, 9.4, 10.2, 10.3, 10.4, 14.4, 6.2, 7.2
 */
export const containerRoutes = Router();

const dockerService = new DockerService();

/**
 * POST /api/containers
 * Create a new n8n container
 * Requirements: 5.2, 5.3, 5.4
 */
containerRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config: ContainerConfig = req.body;

    // Validate required fields
    if (!config.name || !config.port || !config.volumeName) {
      throw new ValidationError('Missing required fields: name, port, volumeName');
    }

    // Validate port is a number
    if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
      throw new ValidationError('Port must be a number between 1 and 65535');
    }

    const containerInfo = await dockerService.createN8nContainer(config);
    
    res.status(201).json({
      success: true,
      data: containerInfo
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/containers/:id/start
 * Start a container
 * Requirements: 8.2, 8.5, 9.4
 */
containerRoutes.post('/:id/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    await dockerService.startContainer(id);
    
    res.status(200).json({
      success: true,
      message: 'Container started successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/containers/:id/stop
 * Stop a container
 * Requirements: 8.3, 8.5, 9.4
 */
containerRoutes.post('/:id/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    await dockerService.stopContainer(id);
    
    res.status(200).json({
      success: true,
      message: 'Container stopped successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/containers/:id/restart
 * Restart a container
 * Requirements: 8.4, 8.5, 9.4
 */
containerRoutes.post('/:id/restart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    await dockerService.restartContainer(id);
    
    res.status(200).json({
      success: true,
      message: 'Container restarted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/containers/:id
 * Remove a container and its volumes
 * Requirements: 10.2, 10.3, 10.4, 14.4
 */
containerRoutes.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    // Remove container with volumes (Requirement 14.4)
    await dockerService.removeContainer(id, true);
    
    res.status(200).json({
      success: true,
      message: 'Container and volumes removed successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/containers/:id/status
 * Get container status
 * Requirements: 6.2, 7.2
 */
containerRoutes.get('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    const status = await dockerService.getContainerStatus(id);
    
    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/containers/:id/logs
 * Get container logs
 */
containerRoutes.get('/:id/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { lines = '100', follow = 'false' } = req.query;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    const logs = await dockerService.getContainerLogs(id, {
      lines: parseInt(lines as string) || 100,
      follow: follow === 'true',
    });
    
    res.status(200).json({
      success: true,
      data: { logs }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/containers/:id/metrics
 * Get container resource metrics
 */
containerRoutes.get('/:id/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Container ID is required');
    }

    const metrics = await dockerService.getContainerMetrics(id);
    
    res.status(200).json({
      success: true,
      data: metrics
    });
  } catch (error) {
    next(error);
  }
});

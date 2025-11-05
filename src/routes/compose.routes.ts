import { Router, Request, Response, NextFunction } from 'express';
import { ComposeStackService } from '../services/compose-stack.service';
import { ComposeStackConfig } from '../types';
import { ValidationError } from '../middleware/error.middleware';

export const composeRoutes = Router();
const composeStackService = new ComposeStackService();

/**
 * POST /api/compose
 * Create a new Docker Compose stack
 */
composeRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = req.body as ComposeStackConfig;

    // Validate required fields
    if (!config.name) {
      throw new ValidationError('Missing required field: name');
    }
    if (!config.composeFile) {
      throw new ValidationError('Missing required field: composeFile');
    }
    if (!config.volumeName) {
      throw new ValidationError('Missing required field: volumeName');
    }
    if (!config.port || typeof config.port !== 'number') {
      throw new ValidationError('Missing or invalid required field: port');
    }

    const stackInfo = await composeStackService.createStack(config);
    
    return res.status(201).json({
      success: true,
      data: {
        stackName: stackInfo.name,
        name: stackInfo.name,
        status: stackInfo.status,
        services: stackInfo.services
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/compose/:stackName/start
 * Start a Docker Compose stack
 */
composeRoutes.post('/:stackName/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    await composeStackService.startStack(stackName);
    
    return res.json({
      success: true,
      message: `Stack ${stackName} started successfully`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/compose/:stackName/stop
 * Stop a Docker Compose stack
 */
composeRoutes.post('/:stackName/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    await composeStackService.stopStack(stackName);
    
    return res.json({
      success: true,
      message: `Stack ${stackName} stopped successfully`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/compose/:stackName/restart
 * Restart a Docker Compose stack
 */
composeRoutes.post('/:stackName/restart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    await composeStackService.restartStack(stackName);
    
    return res.json({
      success: true,
      message: `Stack ${stackName} restarted successfully`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/compose/:stackName
 * Remove a Docker Compose stack
 */
composeRoutes.delete('/:stackName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;
    const removeVolumes = req.query.removeVolumes === 'true';

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    await composeStackService.removeStack(stackName, removeVolumes);
    
    return res.json({
      success: true,
      message: `Stack ${stackName} removed successfully`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/compose/:stackName/status
 * Get Docker Compose stack status
 */
composeRoutes.get('/:stackName/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    const stackInfo = await composeStackService.getStackStatus(stackName);
    
    return res.json({
      success: true,
      data: stackInfo
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/compose/:stackName/logs
 * Get Docker Compose stack logs
 */
composeRoutes.get('/:stackName/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;
    const lines = req.query.lines ? parseInt(req.query.lines as string, 10) : undefined;
    const follow = req.query.follow === 'true';
    const service = req.query.service as string | undefined;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    const logs = await composeStackService.getStackLogs(stackName, {
      lines,
      follow,
      service
    });
    
    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/compose/:stackName/metrics
 * Get Docker Compose stack metrics
 */
composeRoutes.get('/:stackName/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    const metrics = await composeStackService.getStackMetrics(stackName);
    
    return res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/compose/:stackName/services
 * Get list of services in a stack
 */
composeRoutes.get('/:stackName/services', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }

    const services = await composeStackService.getStackServices(stackName);
    
    return res.json({
      success: true,
      data: services
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/compose/:stackName/services/:serviceName/restart
 * Restart a specific service in a stack
 */
composeRoutes.post('/:stackName/services/:serviceName/restart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stackName, serviceName } = req.params;

    if (!stackName) {
      throw new ValidationError('Missing required parameter: stackName');
    }
    if (!serviceName) {
      throw new ValidationError('Missing required parameter: serviceName');
    }

    await composeStackService.restartService(stackName, serviceName);
    
    return res.json({
      success: true,
      message: `Service ${serviceName} in stack ${stackName} restarted successfully`
    });
  } catch (error) {
    next(error);
  }
});

export default composeRoutes;

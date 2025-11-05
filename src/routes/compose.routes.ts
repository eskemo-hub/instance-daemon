import { Router, Request, Response, NextFunction } from 'express';
import { DockerService } from '../services/docker.service';
import { ContainerConfig } from '../types';
import { ValidationError } from '../middleware/error.middleware';

export const composeRoutes = Router();
const dockerService = new DockerService();

/**
 * POST /api/compose
 * Minimal compose endpoint: accepts a single ContainerConfig or an array.
 * For arrays, creates each container sequentially and returns results.
 */
composeRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as unknown;

    // Handle multiple services
    if (Array.isArray(body)) {
      const configs = body as ContainerConfig[];
      if (configs.length === 0) {
        throw new ValidationError('At least one service configuration is required');
      }
      const results = [] as Array<{ name: string; containerId: string; port: number; volumeName?: string; apiKey?: string }>; 
      for (const config of configs) {
        if (!config.name || !config.port || !config.volumeName) {
          throw new ValidationError('Missing required fields in one of the service configs: name, port, volumeName');
        }
        // Stack services use internal networking when flagged
        const info = await dockerService.createN8nContainer({ ...config, isStackService: config.isStackService === true });
        results.push({ name: info.name, containerId: info.containerId, port: info.port, volumeName: info.volumeName, apiKey: info.apiKey });
      }
      return res.status(201).json({ success: true, data: results });
    }

    // Handle single service
    const config = body as ContainerConfig;
    if (!config || !config.name || !config.port || !config.volumeName) {
      throw new ValidationError('Missing required fields: name, port, volumeName');
    }
    const info = await dockerService.createN8nContainer({ ...config, isStackService: config.isStackService === true });
    return res.status(201).json({ success: true, data: info });
  } catch (error) {
    next(error);
  }
});

export default composeRoutes;
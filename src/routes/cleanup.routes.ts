import { Router, Request, Response, NextFunction } from 'express';
import { DockerService } from '../services/docker.service';
import { ValidationError } from '../middleware/error.middleware';

/**
 * Cleanup routes for volumes and images
 */
export const cleanupRoutes = Router();

const dockerService = new DockerService();

/**
 * GET /api/cleanup/volumes
 * List all volumes
 */
cleanupRoutes.get('/volumes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const volumes = await dockerService.listAllVolumes();
    
    res.status(200).json({
      success: true,
      data: volumes,
      count: volumes.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/cleanup/volumes/:volumeName
 * Remove a specific volume
 */
cleanupRoutes.delete('/volumes/:volumeName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { volumeName } = req.params;

    if (!volumeName) {
      throw new ValidationError('Volume name is required');
    }

    await dockerService.removeVolume(volumeName);
    
    res.status(200).json({
      success: true,
      message: `Volume ${volumeName} removed successfully`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cleanup/volumes/prune
 * Prune unused volumes
 */
cleanupRoutes.post('/volumes/prune', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dockerService.pruneVolumes();
    
    res.status(200).json({
      success: true,
      data: result,
      message: `Pruned ${result.volumesDeleted.length} volumes, reclaimed ${result.spaceReclaimed} bytes`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/cleanup/images/unused
 * List unused images
 */
cleanupRoutes.get('/images/unused', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const images = await dockerService.listUnusedImages();
    
    res.status(200).json({
      success: true,
      data: images,
      count: images.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/cleanup/images/prune
 * Prune unused images
 */
cleanupRoutes.post('/images/prune', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { until, label } = req.body;
    
    const result = await dockerService.pruneImages({
      filters: {
        ...(until && { until }),
        ...(label && { label }),
      }
    });
    
    res.status(200).json({
      success: true,
      data: result,
      message: `Pruned ${result.imagesDeleted.length} images, reclaimed ${result.spaceReclaimed} bytes`
    });
  } catch (error) {
    next(error);
  }
});


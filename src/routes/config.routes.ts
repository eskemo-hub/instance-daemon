import { Router, Request, Response, NextFunction } from 'express';
import { configManager } from '../services/config-manager.service';
import { ValidationError } from '../middleware/error.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

export const configRoutes = Router();

/**
 * GET /api/config
 * Get all configuration
 */
configRoutes.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = configManager.getAll();
    return res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/config/:key
 * Get specific configuration value
 */
configRoutes.get('/:key', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const includeMetadata = req.query.metadata === 'true';

    if (includeMetadata) {
      const entry = configManager.getWithMetadata(key);
      if (!entry) {
        return res.status(404).json({
          success: false,
          error: 'Configuration not found'
        });
      }
      return res.status(200).json({
        success: true,
        data: entry
      });
    }

    const value = configManager.get(key);
    if (value === undefined) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: { key, value }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/config/:key
 * Set configuration value
 */
configRoutes.put('/:key', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const { value, validate } = req.body;

    if (value === undefined) {
      throw new ValidationError('Value is required');
    }

    configManager.set(key, value, req.headers['x-user-id'] as string);

    return res.status(200).json({
      success: true,
      message: 'Configuration updated',
      data: { key, value }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/config/:key
 * Delete configuration value
 */
configRoutes.delete('/:key', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const deleted = configManager.delete(key);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Configuration not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Configuration deleted'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/config/import
 * Import configuration
 */
configRoutes.post('/import', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { config, validate } = req.body;

    if (!config) {
      throw new ValidationError('Configuration data is required');
    }

    const result = configManager.import(
      typeof config === 'string' ? config : JSON.stringify(config),
      validate !== false
    );

    return res.status(result.success ? 200 : 400).json({
      success: result.success,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/config/export
 * Export configuration
 */
configRoutes.get('/export', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = configManager.export();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=config.json');
    return res.send(config);
  } catch (error) {
    next(error);
  }
});


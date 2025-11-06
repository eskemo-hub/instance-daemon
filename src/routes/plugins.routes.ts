import { Router, Request, Response, NextFunction } from 'express';
import { pluginManager } from '../services/plugin-manager.service';
import { ValidationError } from '../middleware/error.middleware';
import { authMiddleware } from '../middleware/auth.middleware';

export const pluginsRoutes = Router();

/**
 * GET /api/plugins
 * Get all plugins
 */
pluginsRoutes.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plugins = pluginManager.getAllPlugins();
    return res.status(200).json({
      success: true,
      data: plugins
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/plugins/:name
 * Get specific plugin
 */
pluginsRoutes.get('/:name', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const plugin = pluginManager.getPlugin(name);

    if (!plugin) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: plugin
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/plugins/:name/enable
 * Enable a plugin
 */
pluginsRoutes.post('/:name/enable', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const enabled = pluginManager.enable(name);

    if (!enabled) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Plugin enabled'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/plugins/:name/disable
 * Disable a plugin
 */
pluginsRoutes.post('/:name/disable', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const disabled = pluginManager.disable(name);

    if (!disabled) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Plugin disabled'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/plugins/:name
 * Unregister a plugin
 */
pluginsRoutes.delete('/:name', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const unregistered = pluginManager.unregister(name);

    if (!unregistered) {
      return res.status(404).json({
        success: false,
        error: 'Plugin not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Plugin unregistered'
    });
  } catch (error) {
    next(error);
  }
});


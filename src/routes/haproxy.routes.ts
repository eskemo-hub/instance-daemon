import { Router } from 'express';
import { haproxyService } from '../services/haproxy.service';
import { authMiddleware } from '../middleware/auth.middleware';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/haproxy/regenerate
 * Regenerate HAProxy configuration from existing backends
 * Useful for fixing config after manual changes or daemon updates
 */
router.post('/regenerate', authMiddleware, async (req, res) => {
  try {
    logger.info('Regenerating HAProxy configuration...');
    await haproxyService.regenerateConfig();
    logger.info('HAProxy configuration regenerated successfully');
    res.json({ 
      success: true, 
      message: 'HAProxy configuration regenerated successfully' 
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to regenerate HAProxy config');
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to regenerate HAProxy configuration' 
    });
  }
});

/**
 * GET /api/haproxy/status
 * Get HAProxy status and availability
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const isAvailable = await haproxyService.isAvailable();
    const stats = isAvailable ? await haproxyService.getStats() : null;
    
    res.json({ 
      available: isAvailable,
      stats: stats || null
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to get HAProxy status');
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get HAProxy status' 
    });
  }
});

/**
 * GET /api/haproxy/database/:instanceName/port
 * Get HAProxy port for a specific database instance
 */
router.get('/database/:instanceName/port', authMiddleware, async (req, res) => {
  try {
    const { instanceName } = req.params;
    const port = await haproxyService.getDatabasePort(instanceName);
    
    res.json({ 
      success: true,
      instanceName,
      port: port,
      // If port is null, uses standard port 5432 (TLS or single database)
      usesStandardPort: port === null
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to get database port');
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get database port' 
    });
  }
});

/**
 * GET /api/haproxy/backends
 * Get all database backends with their port information
 */
router.get('/backends', authMiddleware, async (req, res) => {
  try {
    const backends = await haproxyService.getDatabaseBackends();
    
    res.json({ 
      success: true,
      backends: backends
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to get backends');
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get backends' 
    });
  }
});

export { router as haproxyRoutes };


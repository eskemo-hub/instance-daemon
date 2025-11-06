import { Router, Request, Response, NextFunction } from 'express';
import { connectionPoolManager } from '../utils/connection-pool';
import { authMiddleware } from '../middleware/auth.middleware';

export const poolRoutes = Router();

/**
 * GET /api/pool/stats
 * Get connection pool statistics
 */
poolRoutes.get('/stats', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = connectionPoolManager.getStats();
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
});


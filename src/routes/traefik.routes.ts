import { Router, Request, Response, NextFunction } from 'express';
import { TraefikService } from '../services/traefik.service';
import { ValidationError } from '../middleware/error.middleware';

export const traefikRoutes = Router();
const traefikService = new TraefikService();

/**
 * GET /api/traefik/status
 * Check if Traefik is installed and running
 */
traefikRoutes.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const isRunning = await traefikService.isTraefikRunning();
    
    res.status(200).json({
      success: true,
      data: {
        installed: isRunning,
        running: isRunning,
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/traefik/install
 * Install and start Traefik
 * Supports both DNS-01 (Cloudflare) and HTTP-01 challenges
 */
traefikRoutes.post('/install', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, domain, cloudflareApiToken } = req.body;

    if (!email || !domain) {
      throw new ValidationError('Email and domain are required');
    }

    // cloudflareApiToken is optional - if not provided, uses HTTP-01 challenge
    await traefikService.installTraefik(email, domain, cloudflareApiToken);
    
    const challengeType = cloudflareApiToken ? 'DNS-01 (Cloudflare)' : 'HTTP-01';
    res.status(201).json({
      success: true,
      message: `Traefik installed and started successfully with ${challengeType} challenge`
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/traefik
 * Uninstall Traefik
 */
traefikRoutes.delete('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await traefikService.uninstallTraefik();
    
    res.status(200).json({
      success: true,
      message: 'Traefik uninstalled successfully'
    });
  } catch (error) {
    next(error);
  }
});

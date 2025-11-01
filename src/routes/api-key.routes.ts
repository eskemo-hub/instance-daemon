import { Router, Request, Response } from 'express';
import { n8nApiKeyService } from '../services/n8n-api-key.service';
import { apiSuccess, apiError } from '../utils/api-response';

const router = Router();

/**
 * Create an API key for an n8n instance
 * POST /api/api-keys/create
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { volumeName, label } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('volumeName is required'));
    }

    const apiKey = await n8nApiKeyService.createApiKey(
      volumeName,
      label || 'Platform Auto-Generated'
    );

    return res.json(apiSuccess({
      apiKey,
      message: 'API key created successfully',
    }));
  } catch (error) {
    console.error('Failed to create API key:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to create API key'
    ));
  }
});

/**
 * Check if instance has API key
 * POST /api/api-keys/check
 */
router.post('/check', async (req: Request, res: Response) => {
  try {
    const { volumeName } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('volumeName is required'));
    }

    const hasKey = await n8nApiKeyService.hasApiKey(volumeName);

    return res.json(apiSuccess({
      hasApiKey: hasKey,
    }));
  } catch (error) {
    console.error('Failed to check API key:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to check API key'
    ));
  }
});

/**
 * List API keys for an instance
 * POST /api/api-keys/list
 */
router.post('/list', async (req: Request, res: Response) => {
  try {
    const { volumeName } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('volumeName is required'));
    }

    const keys = await n8nApiKeyService.listApiKeys(volumeName);

    return res.json(apiSuccess({
      keys,
      count: keys.length,
    }));
  } catch (error) {
    console.error('Failed to list API keys:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to list API keys'
    ));
  }
});

/**
 * Rotate API key
 * POST /api/api-keys/rotate
 */
router.post('/rotate', async (req: Request, res: Response) => {
  try {
    const { volumeName, oldKeyId } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('volumeName is required'));
    }

    const newApiKey = await n8nApiKeyService.rotateApiKey(volumeName, oldKeyId);

    return res.json(apiSuccess({
      apiKey: newApiKey,
      message: 'API key rotated successfully',
    }));
  } catch (error) {
    console.error('Failed to rotate API key:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to rotate API key'
    ));
  }
});

export default router;

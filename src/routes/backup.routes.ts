import { Router, Request, Response } from 'express';
import { backupService } from '../services/backup.service';
import { apiSuccess, apiError } from '../utils/api-response';

const router = Router();

/**
 * Extract workflows from an n8n instance
 * POST /api/backup/workflows
 */
router.post('/workflows', async (req: Request, res: Response) => {
  try {
    const { volumeName } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('Volume name is required'));
    }

    const workflows = await backupService.extractWorkflows(volumeName);

    return res.json(apiSuccess({
      workflows,
      count: workflows.length,
    }));
  } catch (error) {
    console.error('Failed to extract workflows:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to extract workflows'
    ));
  }
});

/**
 * Extract execution statistics from an n8n instance
 * POST /api/backup/execution-stats
 */
router.post('/execution-stats', async (req: Request, res: Response) => {
  try {
    const { volumeName, daysBack = 30 } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('Volume name is required'));
    }

    const stats = await backupService.extractExecutionStats(volumeName, daysBack);

    return res.json(apiSuccess({
      stats,
      count: stats.length,
    }));
  } catch (error) {
    console.error('Failed to extract execution stats:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to extract execution stats'
    ));
  }
});

/**
 * Get complete backup data for an instance
 * POST /api/backup/full
 */
router.post('/full', async (req: Request, res: Response) => {
  try {
    const { volumeName, daysBack = 30 } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('Volume name is required'));
    }

    const backupData = await backupService.getBackupData(volumeName, daysBack);

    return res.json(apiSuccess(backupData));
  } catch (error) {
    console.error('Failed to get backup data:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get backup data'
    ));
  }
});

/**
 * Get quick stats without full workflow data
 * POST /api/backup/quick-stats
 */
router.post('/quick-stats', async (req: Request, res: Response) => {
  try {
    const { volumeName } = req.body;

    if (!volumeName) {
      return res.status(400).json(apiError('Volume name is required'));
    }

    const stats = await backupService.getQuickStats(volumeName);

    return res.json(apiSuccess(stats));
  } catch (error) {
    console.error('Failed to get quick stats:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get quick stats'
    ));
  }
});

/**
 * Import a workflow directly into n8n database
 * POST /api/backup/import-workflow
 */
router.post('/import-workflow', async (req: Request, res: Response) => {
  try {
    const { volumeName, workflow } = req.body;

    if (!volumeName || !workflow) {
      return res.status(400).json(apiError('volumeName and workflow are required'));
    }

    const { workflowImportService } = await import('../services/workflow-import.service');
    await workflowImportService.importWorkflow(volumeName, workflow);

    return res.json(apiSuccess({
      message: 'Workflow imported successfully',
      workflowId: workflow.id,
    }));
  } catch (error) {
    console.error('Failed to import workflow:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to import workflow'
    ));
  }
});

export default router;

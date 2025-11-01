import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { apiSuccess, apiError } from '../utils/api-response';
import { ContainerLogsService } from '../services/container-logs.service';

const execAsync = promisify(exec);
const router = Router();
const logsService = new ContainerLogsService();

/**
 * GET /api/logs
 * Get daemon logs from systemd journal
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Try to get logs from systemd journal first
    try {
      const { stdout } = await execAsync('journalctl -u n8n-daemon -n 100 --no-pager');
      return res.json(apiSuccess({
        logs: stdout.trim(),
        source: 'systemd-journal'
      }));
    } catch (journalError) {
      // If journal access fails (permissions), provide alternative info
      console.warn('Cannot access systemd journal:', journalError);
      
      // Return basic daemon info instead
      const daemonInfo = [
        `Daemon is running (PID: ${process.pid})`,
        `Started at: ${new Date().toISOString()}`,
        `Node.js version: ${process.version}`,
        `Platform: ${process.platform}`,
        `Architecture: ${process.arch}`,
        `Working directory: ${process.cwd()}`,
        '',
        'Note: Cannot access systemd journal logs due to insufficient permissions.',
        'To fix this, add the daemon user to the systemd-journal group:',
        '  sudo usermod -a -G systemd-journal daemon',
        '  sudo systemctl restart n8n-daemon',
        '',
        'Or view logs directly with:',
        '  sudo journalctl -u n8n-daemon -f'
      ].join('\n');
      
      return res.json(apiSuccess({
        logs: daemonInfo,
        source: 'daemon-info',
        warning: 'Cannot access systemd journal - insufficient permissions'
      }));
    }
  } catch (error) {
    console.error('Failed to get logs:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get logs'
    ));
  }
});

/**
 * POST /api/logs/container
 * Get container logs
 */
router.post('/container', async (req: Request, res: Response) => {
  try {
    const { containerId, tail = 100, level = 'all', search } = req.body;

    if (!containerId) {
      return res.status(400).json(apiError('Container ID is required'));
    }

    const logs = await logsService.getContainerLogs(containerId, { tail });
    
    // Split logs into lines for filtering
    let logLines = logs.split('\n');
    
    // Filter by level if specified
    if (level !== 'all') {
      const levelPattern = new RegExp(`\\b${level}\\b`, 'i');
      logLines = logLines.filter(line => levelPattern.test(line));
    }

    // Filter by search term if specified
    if (search) {
      const searchPattern = new RegExp(search, 'i');
      logLines = logLines.filter(line => searchPattern.test(line));
    }

    return res.json(apiSuccess({
      logs: logLines.join('\n'),
    }));
  } catch (error) {
    console.error('Failed to get container logs:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get container logs'
    ));
  }
});

export default router;

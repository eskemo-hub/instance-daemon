import { Router, Request, Response } from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { apiSuccess, apiError } from '../utils/api-response';
import { ContainerLogsService } from '../services/container-logs.service';
import Docker from 'dockerode';

const execAsync = promisify(exec);
const router = Router();
const logsService = new ContainerLogsService();

/**
 * GET /api/logs
 * Get daemon logs from systemd journal
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Try to get logs from systemd journal with sudo
    try {
      const { stdout } = await execAsync('sudo journalctl -u n8n-daemon -n 100 --no-pager');
      return res.json(apiSuccess({
        logs: stdout.trim(),
        source: 'systemd-journal'
      }));
    } catch (journalError) {
      // If journal access fails, try without sudo as fallback
      try {
        const { stdout } = await execAsync('journalctl -u n8n-daemon -n 100 --no-pager');
        return res.json(apiSuccess({
          logs: stdout.trim(),
          source: 'systemd-journal'
        }));
      } catch (fallbackError) {
        // If both fail, provide daemon info instead
        console.warn('Cannot access systemd journal (tried with and without sudo):', fallbackError);
        
        // Return basic daemon info instead
        const daemonInfo = [
          `Daemon is running (PID: ${process.pid})`,
          `Started at: ${new Date().toISOString()}`,
          `Node.js version: ${process.version}`,
          `Platform: ${process.platform}`,
          `Architecture: ${process.arch}`,
          `Working directory: ${process.cwd()}`,
          '',
          'Note: Cannot access systemd journal logs.',
          'View logs directly with:',
          '  sudo journalctl -u n8n-daemon -f'
        ].join('\n');
        
        return res.json(apiSuccess({
          logs: daemonInfo,
          source: 'daemon-info',
          warning: 'Cannot access systemd journal'
        }));
      }
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

/**
 * GET /api/logs/stream
 * Server-Sent Events: stream daemon journal or container logs
 */
router.get('/stream', async (req: Request, res: Response) => {
  const source = (req.query.source as 'journal' | 'container') || 'journal';
  const containerId = req.query.containerId as string | undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // No need to flush headers explicitly; SSE works with default headers

  const send = (line: string): void => {
    const msg = line.replace(/\r/g, '').trim();
    if (msg.length > 0) {
      res.write(`data: ${msg}\n\n`);
    }
  };

  const end = (): void => {
    try { res.end(); } catch {}
  };

  req.on('close', end);

  try {
    if (source === 'journal') {
      const journal = spawn('journalctl', ['-u', 'n8n-daemon', '-f', '--no-pager', '-o', 'cat']);

      journal.stdout.on('data', (chunk: Buffer) => {
        send(chunk.toString('utf8'));
      });
      journal.stderr.on('data', (chunk: Buffer) => {
        send(chunk.toString('utf8'));
      });
      journal.on('close', end);

      req.on('close', () => {
        try { journal.kill('SIGTERM'); } catch {}
      });
    } else {
      if (!containerId) {
        send('Container ID is required for container log streaming');
        return end();
      }

      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(containerId);

      // Decode Docker multiplexed log frames into plain text lines
      const decodeFrames = (buffer: Buffer): string[] => {
        const lines: string[] = [];
        let offset = 0;
        while (offset + 8 <= buffer.length) {
          const payloadSize = buffer.readUInt32BE(offset + 4);
          if (offset + 8 + payloadSize > buffer.length) break;
          const frame = buffer.slice(offset + 8, offset + 8 + payloadSize).toString('utf8');
          if (frame.trim().length > 0) {
            lines.push(frame);
          }
          offset += 8 + payloadSize;
        }
        return lines;
      };

      container.logs({ stdout: true, stderr: true, follow: true, timestamps: true }, (err: unknown, stream: NodeJS.ReadableStream | undefined) => {
        if (err || !stream) {
          send('Failed to stream container logs');
          return end();
        }

        stream.on('data', (chunk: Buffer) => {
          const lines = decodeFrames(chunk);
          for (const line of lines) send(line);
        });
        stream.on('end', end);
        stream.on('error', end);

        req.on('close', () => {
          try { /* best-effort cleanup */ stream.removeAllListeners(); } catch {}
        });
      });
    }
  } catch (error) {
    send(error instanceof Error ? error.message : 'Failed to start log stream');
    end();
  }
});

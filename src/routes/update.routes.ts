import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { apiSuccess, apiError } from '../utils/api-response';

const execAsync = promisify(exec);
const router = Router();

/**
 * POST /api/update/check
 * Check for updates from GitHub
 */
router.post('/check', async (_req: Request, res: Response) => {
  try {
    const installDir = process.env.INSTALL_DIR || '/opt/n8n-daemon/daemon';
    
    // Fetch latest from GitHub
    await execAsync(`cd ${installDir} && git fetch origin`);
    
    // Check for changes specifically in the daemon directory
    const { stdout } = await execAsync(`cd ${installDir} && git log HEAD..origin/main --oneline -- .`);
    const commits = stdout.trim().split('\n').filter(line => line.length > 0);
    const commitsAhead = commits.length;
    
    const hasUpdates = commitsAhead > 0;
    
    // Get current version info
    let versionInfo = {
      currentVersion: 'unknown',
      currentCommit: 'unknown',
      branch: 'main',
      lastUpdate: new Date().toISOString()
    };
    
    try {
      const { stdout: commitHash } = await execAsync(`cd ${installDir} && git rev-parse --short HEAD`);
      const { stdout: branch } = await execAsync(`cd ${installDir} && git rev-parse --abbrev-ref HEAD`);
      const { stdout: lastCommit } = await execAsync(`cd ${installDir} && git log -1 --format=%cd --date=iso`);
      const packageJson = require('../../package.json');
      
      versionInfo = {
        currentVersion: packageJson.version,
        currentCommit: commitHash.trim(),
        branch: branch.trim(),
        lastUpdate: lastCommit.trim()
      };
    } catch (versionError) {
      console.error('Failed to get version info:', versionError);
    }
    
    return res.json(apiSuccess({
      hasUpdates,
      commitsAhead,
      ...versionInfo
    }));
  } catch (error) {
    console.error('Failed to check for updates:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to check for updates'
    ));
  }
});

/**
 * POST /api/update/apply
 * Apply updates from GitHub (triggers update script)
 */
router.post('/apply', async (req: Request, res: Response) => {
  try {
    const installDir = process.env.INSTALL_DIR || '/opt/n8n-daemon/daemon';
    const updateScript = `${installDir}/update-from-github.sh`;
    
    // Get GitHub token and branch from request body
    const { githubToken, githubBranch } = req.body || {};
    
    // Check if update script exists
    try {
      await execAsync(`test -f ${updateScript}`);
    } catch {
      return res.status(404).json(apiError('Update script not found'));
    }
    
    // Trigger update in background (daemon will restart)
    // We need to respond before the daemon restarts
    res.json(apiSuccess({
      message: 'Update started. Daemon will restart automatically.',
      status: 'updating',
    }));
    
    // Execute update script after response is sent
    setTimeout(() => {
      console.log('Starting update process...');
      console.log('Update script path:', updateScript);
      console.log('GitHub branch:', githubBranch || 'main');
      console.log('GitHub token provided:', !!githubToken);
      
      // Pass GITHUB_TOKEN from request or environment
      const env = {
        ...process.env,
        GITHUB_TOKEN: githubToken || process.env.GITHUB_TOKEN || '',
        GITHUB_BRANCH: githubBranch || process.env.GITHUB_BRANCH || 'main',
      };
      
      // Trigger update via systemd service to run independently
      const logFile = '/tmp/n8n-daemon-update.log';
      
      // Create environment file for the update service
      const envContent = `GITHUB_TOKEN=${githubToken || process.env.GITHUB_TOKEN || ''}
GITHUB_BRANCH=${githubBranch || process.env.GITHUB_BRANCH || 'main'}
`;
      
      require('fs').writeFileSync('/tmp/n8n-update.env', envContent);
      
      // Trigger the update service
      const command = `systemctl start n8n-daemon-update.service`;
      
      console.log('Triggering update service');
      console.log('Update logs will be in:', logFile);
      
      exec(command, (error, _stdout, stderr) => {
        if (error) {
          console.error('Failed to start update service:', error);
          console.error('stderr:', stderr);
        } else {
          console.log('Update service started successfully');
        }
      });
    }, 1000);
    
    return; // Explicit return for TypeScript
  } catch (error) {
    console.error('Failed to apply update:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to apply update'
    ));
  }
});

/**
 * GET /api/update/version
 * Get current daemon version info
 */
router.get('/version', async (_req: Request, res: Response) => {
  try {
    const installDir = process.env.INSTALL_DIR || '/opt/n8n-daemon/daemon';
    
    // Get current commit hash
    const { stdout: commitHash } = await execAsync(`cd ${installDir} && git rev-parse --short HEAD`);
    
    // Get current branch
    const { stdout: branch } = await execAsync(`cd ${installDir} && git rev-parse --abbrev-ref HEAD`);
    
    // Get last commit date
    const { stdout: lastCommit } = await execAsync(`cd ${installDir} && git log -1 --format=%cd --date=iso`);
    
    // Get package version
    const packageJson = require('../../package.json');
    
    return res.json(apiSuccess({
      version: packageJson.version,
      commit: commitHash.trim(),
      branch: branch.trim(),
      lastUpdate: lastCommit.trim(),
    }));
  } catch (error) {
    console.error('Failed to get version info:', error);
    return res.status(500).json(apiError(
      error instanceof Error ? error.message : 'Failed to get version info'
    ));
  }
});

export default router;

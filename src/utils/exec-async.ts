import { exec, spawn, ExecOptions, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import logger from './logger';

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptionsWithTimeout extends ExecOptions {
  timeout?: number;
  stdio?: 'pipe' | 'ignore' | 'inherit' | Array<'pipe' | 'ignore' | 'inherit'>;
}

/**
 * Execute a command asynchronously with timeout support
 * @param command - Command to execute
 * @param options - Execution options including timeout
 * @returns Promise with stdout and stderr
 */
export async function execCommand(
  command: string,
  options: ExecOptionsWithTimeout = {}
): Promise<ExecResult> {
  const { timeout = 30000, ...execOptions } = options;
  
  logger.debug({ command, timeout }, 'Executing command');
  
  try {
    const result = await execAsync(command, {
      ...execOptions,
      timeout
    });
    
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString()
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ command, error: errorMessage }, 'Command execution failed');
    throw error;
  }
}

/**
 * Execute a command with streaming output
 * @param command - Command to execute
 * @param args - Command arguments
 * @param options - Spawn options
 * @returns Promise that resolves when command completes
 */
export function spawnCommand(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.debug({ command, args }, 'Spawning command');
    
    const process = spawn(command, args, {
      ...options,
      stdio: options.stdio || 'inherit'
    });

    let stdout = '';
    let stderr = '';

    if (process.stdout) {
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (process.stderr) {
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    process.on('close', (code) => {
      if (code === 0) {
        logger.debug({ command, code }, 'Command completed successfully');
        resolve();
      } else {
        logger.error({ command, code, stderr }, 'Command failed');
        reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
      }
    });

    process.on('error', (error) => {
      logger.error({ command, error: error.message }, 'Command spawn error');
      reject(error);
    });
  });
}

/**
 * Execute a command and return stdout as string
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Promise with stdout string
 */
export async function execCommandStdout(
  command: string,
  options: ExecOptionsWithTimeout = {}
): Promise<string> {
  const result = await execCommand(command, options);
  return result.stdout.trim();
}


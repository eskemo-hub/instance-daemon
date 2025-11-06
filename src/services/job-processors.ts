import { ComposeStackService } from './compose-stack.service';
import { DockerService } from './docker.service';
import { BackupService } from './backup.service';
import { ComposeStackConfig } from '../types';
import logger from '../utils/logger';
import { jobQueueService } from './job-queue.service';

const composeStackService = new ComposeStackService();
const dockerService = new DockerService();
const backupService = new BackupService();

/**
 * Job processors for different job types
 */
export class JobProcessors {
  /**
   * Process compose_create job
   */
  static async processComposeCreate(payload: { config: ComposeStackConfig }): Promise<any> {
    logger.info({ name: payload.config.name }, 'Processing compose_create job');
    const result = await composeStackService.createStack(payload.config);
    return {
      stackName: result.name,
      status: result.status,
      services: result.services
    };
  }

  /**
   * Process compose_delete job
   */
  static async processComposeDelete(payload: { stackName: string; removeVolumes: boolean }): Promise<any> {
    logger.info({ stackName: payload.stackName }, 'Processing compose_delete job');
    await composeStackService.removeStack(payload.stackName, payload.removeVolumes);
    return { success: true };
  }

  /**
   * Process backup job
   */
  static async processBackup(payload: { containerId: string; backupPath?: string }): Promise<any> {
    logger.info({ containerId: payload.containerId }, 'Processing backup job');
    const result = await backupService.createBackup(payload.containerId, payload.backupPath);
    return result;
  }

  /**
   * Process restore job
   */
  static async processRestore(payload: { containerId: string; backupPath: string }): Promise<any> {
    logger.info({ containerId: payload.containerId, backupPath: payload.backupPath }, 'Processing restore job');
    const result = await backupService.restoreBackup(payload.containerId, payload.backupPath);
    return result;
  }

  /**
   * Process cleanup job
   */
  static async processCleanup(payload: { type: string; options?: any }): Promise<any> {
    logger.info({ type: payload.type }, 'Processing cleanup job');
    // Implement cleanup logic based on type
    return { success: true };
  }
}

/**
 * Register job processors with job queue
 */
export function registerJobProcessors(): void {
  // This will be called by the job queue service when processing jobs
  // The job queue service will call these processors based on job type
  logger.info('Job processors registered');
}


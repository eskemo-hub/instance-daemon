import { databaseService } from './database.service';
import logger from '../utils/logger';
import { JobProcessors } from './job-processors';

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Job status
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Job type
 */
export type JobType = 'compose_create' | 'compose_delete' | 'backup' | 'restore' | 'cleanup' | 'custom';

/**
 * Job entry
 */
export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: any;
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/**
 * Job Queue Service
 * Manages async jobs with persistence
 */
export class JobQueueService {
  private processing: Set<string> = new Set();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Create a new job
   */
  async createJob(type: JobType, payload: any): Promise<string> {
    const id = generateId();
    const now = Date.now();

    const db = databaseService.getDatabase();
    db.prepare(`
      INSERT INTO jobs (id, type, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, type, 'pending', JSON.stringify(payload), now, now);

    logger.info({ id, type }, 'Job created');

    // Try to process if we have capacity
    this.processNext();

    return id;
  }

  /**
   * Get job by ID
   */
  getJob(id: string): Job | null {
    const db = databaseService.getDatabase();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined
    };
  }

  /**
   * Update job status
   */
  private updateJobStatus(
    id: string,
    status: JobStatus,
    result?: any,
    error?: string
  ): void {
    const db = databaseService.getDatabase();
    const now = Date.now();
    const completedAt = status === 'completed' || status === 'failed' ? now : null;

    db.prepare(`
      UPDATE jobs
      SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(
      status,
      result ? JSON.stringify(result) : null,
      error || null,
      now,
      completedAt,
      id
    );
  }

  /**
   * Process next job in queue
   */
  private async processNext(): Promise<void> {
    if (this.processing.size >= this.maxConcurrent) {
      return;
    }

    const db = databaseService.getDatabase();
    const row = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as any;

    if (!row) {
      return;
    }

    const jobId = row.id;
    this.processing.add(jobId);

    // Update status to processing
    this.updateJobStatus(jobId, 'processing');

    // Process job asynchronously
    this.processJob(jobId, row.type, JSON.parse(row.payload))
      .finally(() => {
        this.processing.delete(jobId);
        // Try to process next job
        this.processNext();
      });
  }

  /**
   * Process a job
   */
  private async processJob(id: string, type: JobType, payload: any): Promise<void> {
    logger.info({ id, type }, 'Processing job');

    try {
      // This would be extended with actual job processors
      // For now, it's a placeholder
      const result = await this.executeJob(type, payload);

      this.updateJobStatus(id, 'completed', result);
      logger.info({ id, type }, 'Job completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateJobStatus(id, 'failed', undefined, errorMessage);
      logger.error({ id, type, error: errorMessage }, 'Job failed');
    }
  }

  /**
   * Execute job based on type
   */
  private async executeJob(type: JobType, payload: any): Promise<any> {
    switch (type) {
      case 'compose_create':
        return await JobProcessors.processComposeCreate(payload);
      case 'compose_delete':
        return await JobProcessors.processComposeDelete(payload);
      case 'backup':
        return await JobProcessors.processBackup(payload);
      case 'restore':
        return await JobProcessors.processRestore(payload);
      case 'cleanup':
        return await JobProcessors.processCleanup(payload);
      default:
        throw new Error(`Job type ${type} not implemented`);
    }
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus, limit: number = 100): Job[] {
    const db = databaseService.getDatabase();
    const rows = db.prepare(`
      SELECT * FROM jobs
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(status, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      status: row.status,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined
    }));
  }

  /**
   * Get job statistics
   */
  getStats(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const db = databaseService.getDatabase();
    const stats = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `).all() as any[];

    const result = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const stat of stats) {
      result[stat.status as JobStatus] = stat.count;
    }

    return result;
  }

  /**
   * Cleanup old completed jobs
   */
  cleanupOldJobs(olderThanDays: number = 7): number {
    const db = databaseService.getDatabase();
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    const result = db.prepare(`
      DELETE FROM jobs
      WHERE status IN ('completed', 'failed')
      AND completed_at < ?
    `).run(cutoff);

    logger.info({ deleted: result.changes, olderThanDays }, 'Cleaned up old jobs');
    return result.changes;
  }
}

export const jobQueueService = new JobQueueService();


import logger from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Dead letter queue entry
 */
export interface DLQEntry {
  id: string;
  operation: string;
  payload: any;
  error: string;
  timestamp: number;
  retryCount: number;
}

/**
 * Dead Letter Queue Service
 * Stores failed operations that exceeded max retries
 */
export class DeadLetterQueueService {
  private queue: DLQEntry[] = [];
  private readonly dlqDir: string;
  private readonly dlqFile: string;
  private maxSize: number;

  constructor(dlqDir: string = '/opt/n8n-daemon/dlq', maxSize: number = 1000) {
    this.dlqDir = dlqDir;
    this.dlqFile = path.join(dlqDir, 'dlq.json');
    this.maxSize = maxSize;

    // Ensure DLQ directory exists
    if (!fs.existsSync(this.dlqDir)) {
      fs.mkdirSync(this.dlqDir, { recursive: true, mode: 0o755 });
    }

    // Load existing DLQ entries
    this.load();
  }

  /**
   * Add entry to dead letter queue
   */
  add(operation: string, payload: any, error: Error | string, retryCount: number): void {
    const entry: DLQEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      operation,
      payload,
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
      retryCount
    };

    this.queue.push(entry);

    // Enforce max size (FIFO)
    if (this.queue.length > this.maxSize) {
      const removed = this.queue.shift();
      logger.warn({ id: removed?.id }, 'DLQ entry removed due to max size');
    }

    logger.error(
      {
        id: entry.id,
        operation,
        retryCount,
        error: entry.error
      },
      'Entry added to dead letter queue'
    );

    // Persist to disk
    this.save();
  }

  /**
   * Get all entries
   */
  getAll(): DLQEntry[] {
    return [...this.queue];
  }

  /**
   * Get entries by operation type
   */
  getByOperation(operation: string): DLQEntry[] {
    return this.queue.filter(entry => entry.operation === operation);
  }

  /**
   * Get entry by ID
   */
  getById(id: string): DLQEntry | undefined {
    return this.queue.find(entry => entry.id === id);
  }

  /**
   * Remove entry from queue
   */
  remove(id: string): boolean {
    const index = this.queue.findIndex(entry => entry.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.queue = [];
    this.save();
    logger.info('Dead letter queue cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    size: number;
    operations: Record<string, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const operations: Record<string, number> = {};
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;

    for (const entry of this.queue) {
      operations[entry.operation] = (operations[entry.operation] || 0) + 1;
      
      if (oldestEntry === null || entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
      if (newestEntry === null || entry.timestamp > newestEntry) {
        newestEntry = entry.timestamp;
      }
    }

    return {
      size: this.queue.length,
      operations,
      oldestEntry,
      newestEntry
    };
  }

  /**
   * Load DLQ from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.dlqFile)) {
        const data = fs.readFileSync(this.dlqFile, 'utf8');
        this.queue = JSON.parse(data);
        logger.info({ count: this.queue.length }, 'Loaded dead letter queue from disk');
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to load dead letter queue'
      );
    }
  }

  /**
   * Save DLQ to disk
   */
  private save(): void {
    try {
      fs.writeFileSync(this.dlqFile, JSON.stringify(this.queue, null, 2), { mode: 0o644 });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to save dead letter queue'
      );
    }
  }
}

export const deadLetterQueue = new DeadLetterQueueService();


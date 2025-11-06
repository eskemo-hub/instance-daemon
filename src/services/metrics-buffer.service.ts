import { ContainerStats } from './container-stats.service';
import axios from 'axios';
import logger from '../utils/logger';

/**
 * Metrics buffer for batching and sending metrics
 */
export class MetricsBufferService {
  private buffer: ContainerStats[] = [];
  private sendInterval: NodeJS.Timeout | null = null;
  private maxBufferSize: number;
  private sendIntervalMs: number;
  private platformUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private retryDelay: number;
  private isSending: boolean = false;
  private failedMetrics: ContainerStats[] = [];

  constructor(
    platformUrl: string,
    apiKey: string,
    options: {
      maxBufferSize?: number;
      sendIntervalMs?: number;
      maxRetries?: number;
      retryDelay?: number;
    } = {}
  ) {
    this.platformUrl = platformUrl;
    this.apiKey = apiKey;
    this.maxBufferSize = options.maxBufferSize || 100;
    this.sendIntervalMs = options.sendIntervalMs || 300000; // 5 minutes default
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
  }

  /**
   * Start the buffer service
   */
  start(): void {
    if (this.sendInterval) {
      logger.warn('Metrics buffer already started');
      return;
    }

    logger.info({
      maxBufferSize: this.maxBufferSize,
      sendIntervalMs: this.sendIntervalMs
    }, 'Starting metrics buffer service');

    // Send buffered metrics at intervals
    this.sendInterval = setInterval(() => {
      this.flush();
    }, this.sendIntervalMs);
  }

  /**
   * Stop the buffer service
   */
  stop(): void {
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    // Flush remaining metrics on stop
    this.flush();
  }

  /**
   * Add metrics to buffer
   */
  addMetrics(metrics: ContainerStats[]): void {
    this.buffer.push(...metrics);

    logger.debug({
      bufferSize: this.buffer.length,
      added: metrics.length
    }, 'Metrics added to buffer');

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      logger.info({ bufferSize: this.buffer.length }, 'Buffer full, flushing');
      this.flush();
    }
  }

  /**
   * Flush buffer and send metrics
   */
  async flush(): Promise<void> {
    if (this.isSending) {
      logger.debug('Flush already in progress, skipping');
      return;
    }

    if (this.buffer.length === 0 && this.failedMetrics.length === 0) {
      return;
    }

    this.isSending = true;

    try {
      // Combine buffer and failed metrics
      const metricsToSend = [...this.buffer, ...this.failedMetrics];
      this.buffer = [];
      this.failedMetrics = [];

      if (metricsToSend.length === 0) {
        return;
      }

      logger.info({ count: metricsToSend.length }, 'Flushing metrics buffer');

      await this.sendWithRetry(metricsToSend);

      logger.info({ count: metricsToSend.length }, 'Metrics sent successfully');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to flush metrics buffer'
      );
      // Metrics will be retried on next flush
    } finally {
      this.isSending = false;
    }
  }

  /**
   * Send metrics with retry logic
   */
  private async sendWithRetry(metrics: ContainerStats[], attempt: number = 1): Promise<void> {
    try {
      await axios.post(
        `${this.platformUrl}/api/monitoring/metrics`,
        { metrics },
        {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        }
      );
    } catch (error) {
      if (attempt < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(
          { attempt, maxRetries: this.maxRetries, delay, error: error instanceof Error ? error.message : String(error) },
          'Failed to send metrics, retrying'
        );
        await this.sleep(delay);
        return this.sendWithRetry(metrics, attempt + 1);
      } else {
        // Max retries reached, add to failed metrics for next flush
        logger.error(
          { count: metrics.length, error: error instanceof Error ? error.message : String(error) },
          'Failed to send metrics after max retries, will retry on next flush'
        );
        this.failedMetrics.push(...metrics);
        throw error;
      }
    }
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    bufferSize: number;
    failedMetricsCount: number;
    isSending: boolean;
  } {
    return {
      bufferSize: this.buffer.length,
      failedMetricsCount: this.failedMetrics.length,
      isSending: this.isSending
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


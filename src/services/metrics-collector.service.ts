import { containerStatsService, ContainerStats } from './container-stats.service';
import { MetricsBufferService } from './metrics-buffer.service';
import logger from '../utils/logger';

/**
 * MetricsCollectorService - Collects and stores historical metrics
 * Now uses batching and buffering for improved reliability
 */
export class MetricsCollectorService {
    private platformUrl: string;
    private apiKey: string;
    private collectionInterval: NodeJS.Timeout | null = null;
    private bufferService: MetricsBufferService;

    constructor() {
        this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        this.apiKey = process.env.PLATFORM_API_KEY || '';
        
        // Initialize buffer service with configurable options
        this.bufferService = new MetricsBufferService(
            this.platformUrl,
            this.apiKey,
            {
                maxBufferSize: parseInt(process.env.METRICS_BUFFER_SIZE || '100', 10),
                sendIntervalMs: parseInt(process.env.METRICS_SEND_INTERVAL_MS || '300000', 10), // 5 minutes
                maxRetries: parseInt(process.env.METRICS_MAX_RETRIES || '3', 10),
                retryDelay: parseInt(process.env.METRICS_RETRY_DELAY_MS || '5000', 10)
            }
        );
    }

    /**
     * Start collecting metrics at regular intervals
     */
    start(intervalSeconds: number = 60) {
        if (this.collectionInterval) {
            logger.warn('Metrics collector already running');
            return;
        }

        logger.info({ intervalSeconds }, 'Starting metrics collector');
        
        // Start buffer service
        this.bufferService.start();
        
        // Collect immediately
        this.collectMetrics();

        // Then collect at intervals
        this.collectionInterval = setInterval(() => {
            this.collectMetrics();
        }, intervalSeconds * 1000);
    }

    /**
     * Stop collecting metrics
     */
    stop() {
        if (this.collectionInterval) {
            clearInterval(this.collectionInterval);
            this.collectionInterval = null;
        }
        
        // Stop buffer service (will flush remaining metrics)
        this.bufferService.stop();
        
        logger.info('Metrics collector stopped');
    }

    /**
     * Collect metrics for all n8n containers
     */
    private async collectMetrics() {
        try {
            const containers = await containerStatsService.listN8nContainers();
            const runningContainers = containers.filter(c => c.status === 'running');

            if (runningContainers.length === 0) {
                return;
            }

            const containerIds = runningContainers.map(c => c.id);
            const stats = await containerStatsService.getMultipleContainerStats(containerIds);

            // Add metrics to buffer (will be sent in batches)
            this.bufferService.addMetrics(stats);

            logger.debug({ count: stats.length }, 'Metrics collected and added to buffer');

        } catch (error) {
            logger.error(
                { error: error instanceof Error ? error.message : String(error) },
                'Error collecting metrics'
            );
        }
    }

    /**
     * Get buffer statistics
     */
    getBufferStats() {
        return this.bufferService.getStats();
    }

    /**
     * Manually flush metrics buffer
     */
    async flushMetrics() {
        await this.bufferService.flush();
    }
}

export const metricsCollectorService = new MetricsCollectorService();


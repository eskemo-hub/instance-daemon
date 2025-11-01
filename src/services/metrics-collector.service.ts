import { containerStatsService, ContainerStats } from './container-stats.service';
import axios from 'axios';

/**
 * MetricsCollectorService - Collects and stores historical metrics
 */
export class MetricsCollectorService {
    private platformUrl: string;
    private apiKey: string;
    private collectionInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        this.apiKey = process.env.PLATFORM_API_KEY || '';
    }

    /**
     * Start collecting metrics at regular intervals
     */
    start(intervalSeconds: number = 60) {
        if (this.collectionInterval) {
            console.log('Metrics collector already running');
            return;
        }

        console.log(`Starting metrics collector (interval: ${intervalSeconds}s)`);
        
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
            console.log('Metrics collector stopped');
        }
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

            // Send metrics to platform
            await this.sendMetricsToPlatform(stats);

        } catch (error) {
            console.error('Error collecting metrics:', error);
        }
    }

    /**
     * Send metrics to platform API
     */
    private async sendMetricsToPlatform(stats: ContainerStats[]) {
        try {
            await axios.post(
                `${this.platformUrl}/api/monitoring/metrics`,
                { metrics: stats },
                {
                    headers: {
                        'X-API-Key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000,
                }
            );
        } catch (error) {
            console.error('Error sending metrics to platform:', error);
        }
    }
}

export const metricsCollectorService = new MetricsCollectorService();

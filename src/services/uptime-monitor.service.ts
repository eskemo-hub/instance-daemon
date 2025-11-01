import axios from 'axios';
import Docker from 'dockerode';

/**
 * UptimeMonitorService - Monitors instance uptime and health
 */

export interface UptimeCheck {
    containerId: string;
    containerName: string;
    status: 'UP' | 'DOWN' | 'DEGRADED';
    responseTime?: number;
    errorMessage?: string;
    timestamp: string;
}

export class UptimeMonitorService {
    private docker: Docker;
    private platformUrl: string;
    private apiKey: string;
    private monitorInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        this.platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        this.apiKey = process.env.PLATFORM_API_KEY || '';
    }

    /**
     * Start uptime monitoring
     */
    start(intervalSeconds: number = 30) {
        if (this.monitorInterval) {
            console.log('Uptime monitor already running');
            return;
        }

        console.log(`Starting uptime monitor (interval: ${intervalSeconds}s)`);
        
        // Check immediately
        this.checkUptime();

        // Then check at intervals
        this.monitorInterval = setInterval(() => {
            this.checkUptime();
        }, intervalSeconds * 1000);
    }

    /**
     * Stop uptime monitoring
     */
    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            console.log('Uptime monitor stopped');
        }
    }

    /**
     * Check uptime for all containers
     */
    private async checkUptime() {
        try {
            const containers = await this.docker.listContainers({ all: true });
            const n8nContainers = containers.filter(c => c.Image.includes('n8n'));

            const checks: UptimeCheck[] = [];

            for (const containerInfo of n8nContainers) {
                const check = await this.checkContainer(containerInfo);
                checks.push(check);
            }

            // Send uptime data to platform
            await this.sendUptimeDataToPlatform(checks);

        } catch (error) {
            console.error('Error checking uptime:', error);
        }
    }

    /**
     * Check individual container health
     */
    private async checkContainer(containerInfo: any): Promise<UptimeCheck> {
        const containerId = containerInfo.Id;
        const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';
        const startTime = Date.now();

        try {
            const container = this.docker.getContainer(containerId);
            const info = await container.inspect();

            // Check if container is running
            if (info.State.Status !== 'running') {
                return {
                    containerId,
                    containerName,
                    status: 'DOWN',
                    errorMessage: `Container status: ${info.State.Status}`,
                    timestamp: new Date().toISOString(),
                };
            }

            // Check if container is healthy (if health check is configured)
            if (info.State.Health) {
                const health = info.State.Health.Status;
                if (health === 'unhealthy') {
                    return {
                        containerId,
                        containerName,
                        status: 'DOWN',
                        errorMessage: 'Container health check failed',
                        timestamp: new Date().toISOString(),
                    };
                } else if (health === 'starting') {
                    return {
                        containerId,
                        containerName,
                        status: 'DEGRADED',
                        errorMessage: 'Container is starting',
                        timestamp: new Date().toISOString(),
                    };
                }
            }

            const responseTime = Date.now() - startTime;

            return {
                containerId,
                containerName,
                status: 'UP',
                responseTime,
                timestamp: new Date().toISOString(),
            };

        } catch (error) {
            return {
                containerId,
                containerName,
                status: 'DOWN',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            };
        }
    }

    /**
     * Send uptime data to platform
     */
    private async sendUptimeDataToPlatform(checks: UptimeCheck[]) {
        try {
            await axios.post(
                `${this.platformUrl}/api/monitoring/uptime`,
                { checks },
                {
                    headers: {
                        'X-API-Key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000,
                }
            );
        } catch (error) {
            console.error('Error sending uptime data to platform:', error);
        }
    }
}

export const uptimeMonitorService = new UptimeMonitorService();

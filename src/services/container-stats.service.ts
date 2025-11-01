import Docker from 'dockerode';

/**
 * ContainerStatsService handles real-time container resource monitoring
 */

export interface ContainerStats {
    containerId: string;
    containerName: string;
    cpuPercent: number;
    memoryUsed: number;
    memoryLimit: number;
    memoryPercent: number;
    networkRx: number;
    networkTx: number;
    blockRead: number;
    blockWrite: number;
    pids: number;
    timestamp: string;
}

export class ContainerStatsService {
    private docker: Docker;

    constructor() {
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }

    /**
     * Get real-time stats for a specific container
     */
    async getContainerStats(containerId: string): Promise<ContainerStats> {
        try {
            const container = this.docker.getContainer(containerId);

            // Get container info for name
            const info = await container.inspect();
            const containerName = info.Name.replace(/^\//, '');

            // Get stats (stream: false returns a single snapshot)
            const stats: any = await container.stats({ stream: false });

            // Calculate CPU percentage
            const cpuPercent = this.calculateCpuPercent(stats);

            // Memory stats
            const memoryUsed = stats.memory_stats.usage || 0;
            const memoryLimit = stats.memory_stats.limit || 0;
            const memoryPercent = memoryLimit > 0 ? (memoryUsed / memoryLimit) * 100 : 0;

            // Network stats
            const { networkRx, networkTx } = this.calculateNetworkStats(stats);

            // Block I/O stats
            const { blockRead, blockWrite } = this.calculateBlockIOStats(stats);

            // PIDs
            const pids = stats.pids_stats?.current || 0;

            return {
                containerId,
                containerName,
                cpuPercent: Math.round(cpuPercent * 100) / 100,
                memoryUsed,
                memoryLimit,
                memoryPercent: Math.round(memoryPercent * 100) / 100,
                networkRx,
                networkTx,
                blockRead,
                blockWrite,
                pids,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            throw new Error(`Failed to get container stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get stats for multiple containers
     */
    async getMultipleContainerStats(containerIds: string[]): Promise<ContainerStats[]> {
        const statsPromises = containerIds.map(id =>
            this.getContainerStats(id).catch(error => {
                console.error(`Failed to get stats for container ${id}:`, error);
                return null;
            })
        );

        const results = await Promise.all(statsPromises);
        return results.filter((stat): stat is ContainerStats => stat !== null);
    }

    /**
     * Calculate CPU percentage from Docker stats
     */
    private calculateCpuPercent(stats: any): number {
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
            (stats.precpu_stats.cpu_usage?.total_usage || 0);
        const systemDelta = stats.cpu_stats.system_cpu_usage -
            (stats.precpu_stats.system_cpu_usage || 0);
        const numberCpus = stats.cpu_stats.online_cpus || 1;

        if (systemDelta > 0 && cpuDelta > 0) {
            return (cpuDelta / systemDelta) * numberCpus * 100;
        }
        return 0;
    }

    /**
     * Calculate network stats
     */
    private calculateNetworkStats(stats: any): { networkRx: number; networkTx: number } {
        let networkRx = 0;
        let networkTx = 0;

        if (stats.networks) {
            for (const network of Object.values(stats.networks) as any[]) {
                networkRx += network.rx_bytes || 0;
                networkTx += network.tx_bytes || 0;
            }
        }

        return { networkRx, networkTx };
    }

    /**
     * Calculate block I/O stats
     */
    private calculateBlockIOStats(stats: any): { blockRead: number; blockWrite: number } {
        let blockRead = 0;
        let blockWrite = 0;

        if (stats.blkio_stats?.io_service_bytes_recursive) {
            for (const entry of stats.blkio_stats.io_service_bytes_recursive) {
                if (entry.op === 'Read' || entry.op === 'read') {
                    blockRead += entry.value || 0;
                } else if (entry.op === 'Write' || entry.op === 'write') {
                    blockWrite += entry.value || 0;
                }
            }
        }

        return { blockRead, blockWrite };
    }

    /**
     * Get list of all running n8n containers with basic info
     */
    async listN8nContainers(): Promise<Array<{ id: string; name: string; status: string }>> {
        try {
            const containers = await this.docker.listContainers({ all: true });

            // Filter n8n containers (by image name)
            const n8nContainers = containers
                .filter(container => container.Image.includes('n8n'))
                .map(container => ({
                    id: container.Id,
                    name: container.Names[0]?.replace(/^\//, '') || 'unknown',
                    status: container.State,
                }));

            return n8nContainers;
        } catch (error) {
            throw new Error(`Failed to list containers: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

// Export singleton instance
export const containerStatsService = new ContainerStatsService();

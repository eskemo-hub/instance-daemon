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

            // Get container info for name and limits
            const info = await container.inspect();
            const containerName = info.Name.replace(/^\//, '');

            // Get stats (stream: false returns a single snapshot)
            const stats: any = await container.stats({ stream: false });

            // Calculate CPU percentage
            const cpuPercent = this.calculateCpuPercent(stats, info);

            // Memory stats - use container limit if set, otherwise use stats limit
            // If stats limit equals host memory, check if container has a configured limit
            const memoryUsed = stats.memory_stats?.usage || 0;
            let memoryLimit = stats.memory_stats?.limit || 0;
            let hasMemoryLimit = false;
            
            // Check if container has a memory limit configured
            const configuredMemoryLimit = info.HostConfig?.Memory;
            if (configuredMemoryLimit && configuredMemoryLimit > 0) {
                memoryLimit = configuredMemoryLimit;
                hasMemoryLimit = true;
            } else {
                // If no limit is set, memoryLimit will be host's total memory from stats
                // We can detect this by checking if the limit seems unreasonably high
                // or by checking if HostConfig.Memory is 0 or undefined
                // For now, we'll use the stats limit but note that it represents host memory
                hasMemoryLimit = false;
            }
            
            // Calculate memory percent - if no limit, set to 0 to avoid misleading percentages
            const memoryPercent = hasMemoryLimit && memoryLimit > 0 
                ? (memoryUsed / memoryLimit) * 100 
                : 0;

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
                memoryLimit: hasMemoryLimit ? memoryLimit : 0, // Return 0 if no limit to indicate unlimited
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
     * If container has CPU quota/period limits, calculate relative to that
     * Otherwise, calculate as percentage of total system CPU
     */
    private calculateCpuPercent(stats: any, containerInfo?: any): number {
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
            (stats.precpu_stats.cpu_usage?.total_usage || 0);
        const systemDelta = stats.cpu_stats.system_cpu_usage -
            (stats.precpu_stats.system_cpu_usage || 0);
        const numberCpus = stats.cpu_stats.online_cpus || 1;

        if (systemDelta > 0 && cpuDelta > 0) {
            // Check if container has CPU quota/period limits
            if (containerInfo?.HostConfig?.CpuQuota && containerInfo?.HostConfig?.CpuPeriod) {
                const cpuQuota = containerInfo.HostConfig.CpuQuota;
                const cpuPeriod = containerInfo.HostConfig.CpuPeriod;
                
                // Calculate effective CPU cores from quota/period
                // quota = -1 means no limit, otherwise quota/period = number of cores
                if (cpuQuota > 0 && cpuPeriod > 0) {
                    const effectiveCores = cpuQuota / cpuPeriod;
                    // Calculate CPU usage relative to the quota
                    const cpuUsagePercent = (cpuDelta / systemDelta) * numberCpus * 100;
                    // Return as percentage of allocated cores (can exceed 100% if using more than allocated)
                    return cpuUsagePercent;
                }
            }
            
            // No CPU quota set - calculate as percentage of total system CPU
            // This shows how much of the server's total CPU this container is using
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

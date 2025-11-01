import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * HealthService collects system health metrics
 * 
 * Requirements:
 * - 13.2: Daemon SHALL report CPU usage, memory usage, disk space, and Docker service status
 */
export class HealthService {
  private previousCpuUsage: { idle: number; total: number } | null = null;

  /**
   * Get CPU usage percentage
   * Calculates CPU usage by comparing current and previous CPU times
   */
  async getCpuUsage(): Promise<number> {
    const cpus = os.cpus();
    
    let idle = 0;
    let total = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    });
    
    if (this.previousCpuUsage) {
      const idleDiff = idle - this.previousCpuUsage.idle;
      const totalDiff = total - this.previousCpuUsage.total;
      const usage = 100 - (100 * idleDiff / totalDiff);
      
      this.previousCpuUsage = { idle, total };
      return Math.round(usage * 100) / 100; // Round to 2 decimal places
    }
    
    // First call - store values and return 0
    this.previousCpuUsage = { idle, total };
    return 0;
  }

  /**
   * Get memory usage information
   * Returns used and total memory in bytes
   */
  async getMemoryUsage(): Promise<{ used: number; total: number }> {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    return {
      used: usedMemory,
      total: totalMemory
    };
  }

  /**
   * Get disk usage information
   * Returns used and total disk space in bytes for the root filesystem
   */
  async getDiskUsage(): Promise<{ used: number; total: number }> {
    try {
      // Use df command to get disk usage for root filesystem
      const { stdout } = await execAsync('df -B1 / | tail -1');
      
      // Parse df output: Filesystem 1B-blocks Used Available Use% Mounted
      const parts = stdout.trim().split(/\s+/);
      
      if (parts.length >= 4) {
        const total = parseInt(parts[1], 10);
        const used = parseInt(parts[2], 10);
        
        return {
          used: used,
          total: total
        };
      }
      
      throw new Error('Unable to parse df output');
    } catch (error) {
      console.error('Error getting disk usage:', error);
      // Return fallback values
      return {
        used: 0,
        total: 0
      };
    }
  }

  /**
   * Check if Docker service is running
   * Attempts to execute 'docker info' to verify Docker daemon is accessible
   */
  async getDockerStatus(): Promise<boolean> {
    try {
      await execAsync('docker info', { timeout: 5000 });
      return true;
    } catch (error) {
      console.error('Docker status check failed:', error);
      return false;
    }
  }
}

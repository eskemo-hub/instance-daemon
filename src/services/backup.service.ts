import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * BackupService handles reading n8n SQLite databases from Docker volumes
 * and extracting workflow and execution data for backup and analytics
 */

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: any;
  connections: any;
  settings: any;
  tags?: any;
  staticData?: any;
  versionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  waitTill?: string;
  status: string;
}

export interface ExecutionStatsDaily {
  date: string;
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  waitingCount: number;
  avgDuration: number | null;
  maxDuration: number | null;
  minDuration: number | null;
}

export interface BackupData {
  workflows: N8nWorkflow[];
  executionStats: ExecutionStatsDaily[];
  totalWorkflows: number;
  activeWorkflows: number;
  totalExecutions: number;
  storageUsed: number;
}

export class BackupService {
  private readonly VOLUME_BASE_PATH = '/var/lib/docker/volumes';

  /**
   * Get the path to the n8n database file in a Docker volume
   */
  private getDatabasePath(volumeName: string): string {
    return path.join(this.VOLUME_BASE_PATH, volumeName, '_data', 'database.sqlite');
  }

  /**
   * Check if database file exists and is accessible
   */
  private async checkDatabaseExists(volumeName: string): Promise<boolean> {
    const dbPath = this.getDatabasePath(volumeName);
    try {
      await fs.promises.access(dbPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get database file size in bytes
   */
  private async getDatabaseSize(volumeName: string): Promise<number> {
    const dbPath = this.getDatabasePath(volumeName);
    try {
      const stats = await fs.promises.stat(dbPath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Open n8n SQLite database in read-only mode
   */
  private openDatabase(volumeName: string): Database.Database {
    const dbPath = this.getDatabasePath(volumeName);
    
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath}`);
    }

    try {
      return new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (error) {
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract all workflows from n8n database
   */
  async extractWorkflows(volumeName: string): Promise<N8nWorkflow[]> {
    const exists = await this.checkDatabaseExists(volumeName);
    if (!exists) {
      throw new Error(`Database not found for volume: ${volumeName}`);
    }

    const db = this.openDatabase(volumeName);
    
    try {
      // n8n stores workflows in workflow_entity table
      const workflows = db.prepare(`
        SELECT 
          id,
          name,
          active,
          nodes,
          connections,
          settings,
          staticData,
          versionId,
          createdAt,
          updatedAt
        FROM workflow_entity
        ORDER BY updatedAt DESC
      `).all() as any[];

      // Parse JSON fields and get tags
      const workflowsWithTags = workflows.map(w => {
        // Get tags for this workflow
        const tags = db.prepare(`
          SELECT t.id, t.name
          FROM tag_entity t
          INNER JOIN workflows_tags wt ON wt.tagId = t.id
          WHERE wt.workflowId = ?
        `).all(w.id);

        return {
          id: String(w.id),
          name: w.name,
          active: Boolean(w.active),
          nodes: typeof w.nodes === 'string' ? JSON.parse(w.nodes) : w.nodes,
          connections: typeof w.connections === 'string' ? JSON.parse(w.connections) : w.connections,
          settings: typeof w.settings === 'string' ? JSON.parse(w.settings) : w.settings,
          tags: tags.length > 0 ? tags : undefined,
          staticData: w.staticData ? (typeof w.staticData === 'string' ? JSON.parse(w.staticData) : w.staticData) : undefined,
          versionId: w.versionId ? String(w.versionId) : undefined,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
        };
      });

      return workflowsWithTags;
    } finally {
      db.close();
    }
  }

  /**
   * Extract execution statistics aggregated by day
   */
  async extractExecutionStats(volumeName: string, daysBack: number = 30): Promise<ExecutionStatsDaily[]> {
    const exists = await this.checkDatabaseExists(volumeName);
    if (!exists) {
      throw new Error(`Database not found for volume: ${volumeName}`);
    }

    const db = this.openDatabase(volumeName);
    
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - daysBack);
      const sinceDateStr = sinceDate.toISOString();

      // n8n stores executions in execution_entity table
      const stats = db.prepare(`
        SELECT 
          DATE(startedAt) as date,
          COUNT(*) as totalExecutions,
          SUM(CASE WHEN finished = 1 AND status = 'success' THEN 1 ELSE 0 END) as successCount,
          SUM(CASE WHEN finished = 1 AND status = 'error' THEN 1 ELSE 0 END) as errorCount,
          SUM(CASE WHEN finished = 0 OR waitTill IS NOT NULL THEN 1 ELSE 0 END) as waitingCount,
          AVG(
            CASE 
              WHEN finished = 1 AND stoppedAt IS NOT NULL 
              THEN (julianday(stoppedAt) - julianday(startedAt)) * 86400000 
              ELSE NULL 
            END
          ) as avgDuration,
          MAX(
            CASE 
              WHEN finished = 1 AND stoppedAt IS NOT NULL 
              THEN (julianday(stoppedAt) - julianday(startedAt)) * 86400000 
              ELSE NULL 
            END
          ) as maxDuration,
          MIN(
            CASE 
              WHEN finished = 1 AND stoppedAt IS NOT NULL 
              THEN (julianday(stoppedAt) - julianday(startedAt)) * 86400000 
              ELSE NULL 
            END
          ) as minDuration
        FROM execution_entity
        WHERE startedAt >= ?
        GROUP BY DATE(startedAt)
        ORDER BY date DESC
      `).all(sinceDateStr) as any[];

      return stats.map(s => ({
        date: s.date,
        totalExecutions: s.totalExecutions,
        successCount: s.successCount,
        errorCount: s.errorCount,
        waitingCount: s.waitingCount,
        avgDuration: s.avgDuration,
        maxDuration: s.maxDuration,
        minDuration: s.minDuration,
      }));
    } finally {
      db.close();
    }
  }

  /**
   * Get complete backup data for an instance
   */
  async getBackupData(volumeName: string, daysBack: number = 30): Promise<BackupData> {
    const workflows = await this.extractWorkflows(volumeName);
    const executionStats = await this.extractExecutionStats(volumeName, daysBack);
    const storageUsed = await this.getDatabaseSize(volumeName);

    const activeWorkflows = workflows.filter(w => w.active).length;
    const totalExecutions = executionStats.reduce((sum, stat) => sum + stat.totalExecutions, 0);

    return {
      workflows,
      executionStats,
      totalWorkflows: workflows.length,
      activeWorkflows,
      totalExecutions,
      storageUsed,
    };
  }

  /**
   * Get quick stats without full workflow data (for health checks)
   */
  async getQuickStats(volumeName: string): Promise<{
    totalWorkflows: number;
    activeWorkflows: number;
    storageUsed: number;
  }> {
    const exists = await this.checkDatabaseExists(volumeName);
    if (!exists) {
      return {
        totalWorkflows: 0,
        activeWorkflows: 0,
        storageUsed: 0,
      };
    }

    const db = this.openDatabase(volumeName);
    
    try {
      const result = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active
        FROM workflow_entity
      `).get() as any;

      const storageUsed = await this.getDatabaseSize(volumeName);

      return {
        totalWorkflows: result.total || 0,
        activeWorkflows: result.active || 0,
        storageUsed,
      };
    } finally {
      db.close();
    }
  }

  /**
   * Create a Docker container backup (backup volume data)
   * This creates a tar archive of the container's volume
   */
  async createBackup(containerId: string, backupPath?: string): Promise<{ backupPath: string; size: number }> {
    const { execCommand } = await import('../utils/exec-async');
    const { DockerService } = await import('./docker.service');
    const dockerService = new DockerService();
    
    // Get container info to find volume
    const containers = await dockerService.listAllContainers(false);
    const container = containers.find(c => c.id === containerId || c.id.startsWith(containerId));
    
    if (!container) {
      throw new Error(`Container ${containerId} not found`);
    }

    // Extract volume name from container (assuming volume name pattern)
    // This is a simplified implementation - you may need to inspect the container to get actual volume mounts
    const volumeName = container.name.replace(/[^a-zA-Z0-9]/g, '_');
    const volumePath = this.getDatabasePath(volumeName.replace('_data', ''));
    const volumeDir = path.dirname(volumePath);

    // Generate backup path if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultBackupPath = `/opt/n8n-daemon/backups/${containerId}-${timestamp}.tar.gz`;
    const finalBackupPath = backupPath || defaultBackupPath;

    // Ensure backup directory exists
    const backupDir = path.dirname(finalBackupPath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Create tar archive of volume
    await execCommand(`tar -czf "${finalBackupPath}" -C "${volumeDir}" .`);

    // Get backup size
    const stats = fs.statSync(finalBackupPath);
    
    return {
      backupPath: finalBackupPath,
      size: stats.size
    };
  }

  /**
   * Restore a Docker container backup
   * This restores volume data from a tar archive
   */
  async restoreBackup(containerId: string, backupPath: string): Promise<{ success: boolean }> {
    const { execCommand } = await import('../utils/exec-async');
    const { DockerService } = await import('./docker.service');
    const dockerService = new DockerService();
    
    // Check backup file exists
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Get container info to find volume
    const containers = await dockerService.listAllContainers(false);
    const container = containers.find(c => c.id === containerId || c.id.startsWith(containerId));
    
    if (!container) {
      throw new Error(`Container ${containerId} not found`);
    }

    // Extract volume name from container
    const volumeName = container.name.replace(/[^a-zA-Z0-9]/g, '_');
    const volumePath = this.getDatabasePath(volumeName.replace('_data', ''));
    const volumeDir = path.dirname(volumePath);

    // Ensure volume directory exists
    if (!fs.existsSync(volumeDir)) {
      fs.mkdirSync(volumeDir, { recursive: true });
    }

    // Stop container before restore (if running)
    try {
      await dockerService.stopContainer(containerId);
    } catch (error) {
      // Container might already be stopped
    }

    // Extract backup
    await execCommand(`tar -xzf "${backupPath}" -C "${volumeDir}"`);

    return { success: true };
  }
}

// Export singleton instance
export const backupService = new BackupService();

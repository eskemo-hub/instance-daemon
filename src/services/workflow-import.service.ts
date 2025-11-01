import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * WorkflowImportService handles direct SQLite workflow imports
 * This allows importing workflows directly into the n8n database
 */

export interface WorkflowImportData {
  id: string;
  name: string;
  active: boolean;
  nodes: any;
  connections: any;
  settings: any;
  staticData?: any;
}

export class WorkflowImportService {
  private readonly VOLUME_BASE_PATH = '/var/lib/docker/volumes';

  /**
   * Get the path to the n8n database file
   */
  private getDatabasePath(volumeName: string): string {
    return path.join(this.VOLUME_BASE_PATH, volumeName, '_data', 'database.sqlite');
  }

  /**
   * Open n8n SQLite database in read-write mode
   */
  private openDatabase(volumeName: string): Database.Database {
    const dbPath = this.getDatabasePath(volumeName);
    
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath}`);
    }

    try {
      return new Database(dbPath, { readonly: false, fileMustExist: true });
    } catch (error) {
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Import a workflow directly into the n8n database
   */
  async importWorkflow(volumeName: string, workflow: WorkflowImportData): Promise<void> {
    const db = this.openDatabase(volumeName);
    
    try {
      // Check if workflow already exists
      const existing = db.prepare('SELECT id FROM workflow_entity WHERE id = ?').get(workflow.id);

      const now = new Date().toISOString();

      if (existing) {
        // Update existing workflow
        db.prepare(`
          UPDATE workflow_entity
          SET name = ?,
              active = ?,
              nodes = ?,
              connections = ?,
              settings = ?,
              staticData = ?,
              updatedAt = ?
          WHERE id = ?
        `).run(
          workflow.name,
          workflow.active ? 1 : 0,
          JSON.stringify(workflow.nodes),
          JSON.stringify(workflow.connections),
          JSON.stringify(workflow.settings),
          workflow.staticData ? JSON.stringify(workflow.staticData) : null,
          now,
          workflow.id
        );
      } else {
        // Insert new workflow
        db.prepare(`
          INSERT INTO workflow_entity (
            id, name, active, nodes, connections, settings, staticData, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          workflow.id,
          workflow.name,
          workflow.active ? 1 : 0,
          JSON.stringify(workflow.nodes),
          JSON.stringify(workflow.connections),
          JSON.stringify(workflow.settings),
          workflow.staticData ? JSON.stringify(workflow.staticData) : null,
          now,
          now
        );
      }
    } finally {
      db.close();
    }
  }

  /**
   * Import multiple workflows
   */
  async importWorkflows(volumeName: string, workflows: WorkflowImportData[]): Promise<void> {
    for (const workflow of workflows) {
      await this.importWorkflow(volumeName, workflow);
    }
  }

  /**
   * Delete a workflow from the database
   */
  async deleteWorkflow(volumeName: string, workflowId: string): Promise<void> {
    const db = this.openDatabase(volumeName);
    
    try {
      // Delete workflow
      db.prepare('DELETE FROM workflow_entity WHERE id = ?').run(workflowId);
      
      // Delete associated tags
      db.prepare('DELETE FROM workflows_tags WHERE workflowId = ?').run(workflowId);
      
      // Note: Executions are typically kept for history
    } finally {
      db.close();
    }
  }

  /**
   * Check if a workflow exists
   */
  async workflowExists(volumeName: string, workflowId: string): Promise<boolean> {
    const db = this.openDatabase(volumeName);
    
    try {
      const result = db.prepare('SELECT id FROM workflow_entity WHERE id = ?').get(workflowId);
      return !!result;
    } finally {
      db.close();
    }
  }
}

// Export singleton instance
export const workflowImportService = new WorkflowImportService();

import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcrypt';

/**
 * N8nApiKeyService handles automatic API key creation for n8n instances
 */

export class N8nApiKeyService {
  private readonly VOLUME_BASE_PATH = '/var/lib/docker/volumes';

  /**
   * Get the path to the n8n database file
   */
  private getDatabasePath(volumeName: string): string {
    return path.join(this.VOLUME_BASE_PATH, volumeName, '_data', 'database.sqlite');
  }

  /**
   * Open n8n SQLite database
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
   * Generate a secure API key
   */
  private generateApiKey(): string {
    // Generate a random 32-character API key
    return 'n8n_api_' + crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash API key for storage (n8n uses bcrypt)
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    return bcrypt.hash(apiKey, 10);
  }

  /**
   * Create an API key in the n8n database
   * Returns the plain API key (store this in platform database)
   */
  async createApiKey(volumeName: string, label: string = 'Platform Auto-Generated'): Promise<string> {
    // Wait a bit for n8n to initialize database
    await this.waitForDatabase(volumeName);

    const db = this.openDatabase(volumeName);
    
    try {
      // Generate API key
      const apiKey = this.generateApiKey();
      const hashedKey = await this.hashApiKey(apiKey);

      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      // Check if api_key table exists (n8n v1.0+)
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='api_key'
      `).get();

      if (tableExists) {
        // Insert API key into database
        db.prepare(`
          INSERT INTO api_key (
            id, label, apiKey, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?)
        `).run(id, label, hashedKey, now, now);
      } else {
        console.warn('API key table not found - n8n may not support API keys yet');
        throw new Error('API key table not found in database');
      }

      return apiKey; // Return plain key for storage
    } finally {
      db.close();
    }
  }

  /**
   * Wait for n8n database to be initialized
   */
  private async waitForDatabase(volumeName: string, maxAttempts: number = 30): Promise<void> {
    const dbPath = this.getDatabasePath(volumeName);
    
    for (let i = 0; i < maxAttempts; i++) {
      if (fs.existsSync(dbPath)) {
        // Check if database is initialized (has tables)
        try {
          const db = this.openDatabase(volumeName);
          const tables = db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table'
          `).all();
          db.close();
          
          if (tables.length > 0) {
            return; // Database is ready
          }
        } catch (error) {
          // Database not ready yet
        }
      }
      
      // Wait 1 second before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Timeout waiting for n8n database to initialize');
  }

  /**
   * Check if an API key exists for this instance
   */
  async hasApiKey(volumeName: string): Promise<boolean> {
    try {
      const db = this.openDatabase(volumeName);
      
      try {
        const result = db.prepare(`
          SELECT COUNT(*) as count FROM api_key
        `).get() as { count: number };
        
        return result.count > 0;
      } finally {
        db.close();
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * List all API keys (returns labels only, not actual keys)
   */
  async listApiKeys(volumeName: string): Promise<Array<{ id: string; label: string; createdAt: string }>> {
    const db = this.openDatabase(volumeName);
    
    try {
      const keys = db.prepare(`
        SELECT id, label, createdAt
        FROM api_key
        ORDER BY createdAt DESC
      `).all() as Array<{ id: string; label: string; createdAt: string }>;
      
      return keys;
    } finally {
      db.close();
    }
  }

  /**
   * Delete an API key
   */
  async deleteApiKey(volumeName: string, keyId: string): Promise<void> {
    const db = this.openDatabase(volumeName);
    
    try {
      db.prepare('DELETE FROM api_key WHERE id = ?').run(keyId);
    } finally {
      db.close();
    }
  }

  /**
   * Rotate API key (delete old, create new)
   */
  async rotateApiKey(volumeName: string, oldKeyId?: string): Promise<string> {
    if (oldKeyId) {
      await this.deleteApiKey(volumeName, oldKeyId);
    }
    
    return this.createApiKey(volumeName, 'Platform Auto-Generated (Rotated)');
  }
}

// Export singleton instance
export const n8nApiKeyService = new N8nApiKeyService();

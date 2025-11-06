import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Database service for state persistence
 * Uses SQLite for local state storage
 */
export class DatabaseService {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = '/opt/n8n-daemon/daemon.db') {
    this.dbPath = dbPath;
    this.initialize();
  }

  /**
   * Initialize database and create tables
   */
  private initialize(): void {
    try {
      // Ensure directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 });
      }

      // Open database
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
      this.db.pragma('foreign_keys = ON');

      // Create tables
      this.createTables();

      logger.info({ dbPath: this.dbPath }, 'Database initialized');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to initialize database'
      );
      throw error;
    }
  }

  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) return;

    // Jobs table for async operations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    `);

    // Metrics cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics_cache (
        container_id TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (container_id, metric_type, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_cache_container ON metrics_cache(container_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_cache_timestamp ON metrics_cache(timestamp);
    `);

    // Configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Audit log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        operation TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        user_id TEXT,
        ip_address TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_log_operation ON audit_log(operation);
      CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
    `);
  }

  /**
   * Get database instance
   */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Vacuum database (cleanup and optimize)
   */
  vacuum(): void {
    if (this.db) {
      this.db.exec('VACUUM');
      logger.info('Database vacuumed');
    }
  }
}

export const databaseService = new DatabaseService();


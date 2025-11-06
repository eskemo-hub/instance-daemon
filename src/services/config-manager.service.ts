import * as fs from 'fs';
import * as path from 'path';
import { databaseService } from './database.service';
import logger from '../utils/logger';
import { EventEmitter } from 'events';

/**
 * Configuration entry
 */
export interface ConfigEntry {
  key: string;
  value: any;
  version: number;
  updatedAt: number;
  updatedBy?: string;
}

/**
 * Configuration Manager Service
 * Manages configuration with hot-reload, validation, and versioning
 */
export class ConfigManagerService extends EventEmitter {
  private config: Map<string, ConfigEntry> = new Map();
  private configFile: string;
  private watchInterval: NodeJS.Timeout | null = null;
  private lastModified: number = 0;

  constructor(configFile: string = '/opt/n8n-daemon/config.json') {
    super();
    this.configFile = configFile;
    this.load();
  }

  /**
   * Load configuration from file and database
   */
  private load(): void {
    // Load from file if exists
    if (fs.existsSync(this.configFile)) {
      try {
        const fileData = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
        const stats = fs.statSync(this.configFile);
        this.lastModified = stats.mtimeMs;

        for (const [key, value] of Object.entries(fileData)) {
          this.config.set(key, {
            key,
            value,
            version: 1,
            updatedAt: Date.now()
          });
        }

        logger.info({ count: this.config.size }, 'Configuration loaded from file');
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to load configuration from file'
        );
      }
    }

    // Load from database (overrides file)
    try {
      const db = databaseService.getDatabase();
      const rows = db.prepare('SELECT * FROM config').all() as any[];

      for (const row of rows) {
        const entry: ConfigEntry = {
          key: row.key,
          value: JSON.parse(row.value),
          version: row.version || 1,
          updatedAt: row.updated_at
        };
        this.config.set(row.key, entry);
      }

      if (rows.length > 0) {
        logger.info({ count: rows.length }, 'Configuration loaded from database');
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to load configuration from database'
      );
    }
  }

  /**
   * Start watching for configuration changes
   */
  startWatching(intervalSeconds: number = 30): void {
    if (this.watchInterval) {
      logger.warn('Configuration watcher already running');
      return;
    }

    logger.info({ intervalSeconds }, 'Starting configuration watcher');

    this.watchInterval = setInterval(() => {
      this.checkForChanges();
    }, intervalSeconds * 1000);
  }

  /**
   * Stop watching for configuration changes
   */
  stopWatching(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
      logger.info('Configuration watcher stopped');
    }
  }

  /**
   * Check for configuration file changes
   */
  private checkForChanges(): void {
    if (!fs.existsSync(this.configFile)) {
      return;
    }

    try {
      const stats = fs.statSync(this.configFile);
      if (stats.mtimeMs > this.lastModified) {
        logger.info('Configuration file changed, reloading');
        this.load();
        this.emit('config-changed');
        this.lastModified = stats.mtimeMs;
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to check configuration changes'
      );
    }
  }

  /**
   * Get configuration value
   */
  get<T = any>(key: string, defaultValue?: T): T | undefined {
    const entry = this.config.get(key);
    return entry ? (entry.value as T) : defaultValue;
  }

  /**
   * Set configuration value
   */
  set(key: string, value: any, updatedBy?: string): void {
    const existing = this.config.get(key);
    const version = existing ? existing.version + 1 : 1;

    const entry: ConfigEntry = {
      key,
      value,
      version,
      updatedAt: Date.now(),
      updatedBy
    };

    this.config.set(key, entry);

    // Persist to database
    try {
      const db = databaseService.getDatabase();
      db.prepare(`
        INSERT OR REPLACE INTO config (key, value, updated_at)
        VALUES (?, ?, ?)
      `).run(key, JSON.stringify(value), entry.updatedAt);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), key },
        'Failed to save configuration'
      );
    }

    this.emit('config-updated', { key, value, version });
    logger.info({ key, version }, 'Configuration updated');
  }

  /**
   * Delete configuration value
   */
  delete(key: string): boolean {
    const deleted = this.config.delete(key);

    if (deleted) {
      try {
        const db = databaseService.getDatabase();
        db.prepare('DELETE FROM config WHERE key = ?').run(key);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), key },
          'Failed to delete configuration'
        );
      }

      this.emit('config-deleted', { key });
    }

    return deleted;
  }

  /**
   * Get all configuration
   */
  getAll(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, entry] of this.config) {
      result[key] = entry.value;
    }
    return result;
  }

  /**
   * Get configuration with metadata
   */
  getWithMetadata(key: string): ConfigEntry | undefined {
    return this.config.get(key);
  }

  /**
   * Validate configuration
   */
  validate(config: Record<string, any>, schema: Record<string, (value: any) => boolean>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    for (const [key, validator] of Object.entries(schema)) {
      if (!(key in config)) {
        errors.push(`Missing required configuration: ${key}`);
        continue;
      }

      if (!validator(config[key])) {
        errors.push(`Invalid configuration value for ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get configuration history (versions)
   */
  getHistory(key: string): ConfigEntry[] {
    // In a full implementation, this would query a history table
    const entry = this.config.get(key);
    return entry ? [entry] : [];
  }

  /**
   * Export configuration
   */
  export(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /**
   * Import configuration
   */
  import(configJson: string, validate: boolean = true): {
    success: boolean;
    imported: number;
    errors: string[];
  } {
    try {
      const config = JSON.parse(configJson);
      const errors: string[] = [];
      let imported = 0;

      for (const [key, value] of Object.entries(config)) {
        try {
          this.set(key, value, 'import');
          imported++;
        } catch (error) {
          errors.push(`Failed to import ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return {
        success: errors.length === 0,
        imported,
        errors
      };
    } catch (error) {
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
}

export const configManager = new ConfigManagerService();


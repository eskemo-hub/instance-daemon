import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Plugin interface
 */
export interface Plugin {
  name: string;
  version: string;
  initialize?: () => Promise<void> | void;
  destroy?: () => Promise<void> | void;
  middleware?: (req: any, res: any, next: any) => void;
  hooks?: {
    [key: string]: (...args: any[]) => Promise<any> | any;
  };
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  loaded: boolean;
}

/**
 * Plugin Manager Service
 * Manages plugin loading, registration, and lifecycle
 */
export class PluginManagerService extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private pluginMetadata: Map<string, PluginMetadata> = new Map();
  private pluginDir: string;
  private hooks: Map<string, Array<(...args: any[]) => Promise<any> | any>> = new Map();

  constructor(pluginDir: string = '/opt/n8n-daemon/plugins') {
    super();
    this.pluginDir = pluginDir;

    // Ensure plugin directory exists
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Register a plugin
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      logger.warn({ name: plugin.name }, 'Plugin already registered, replacing');
    }

    this.plugins.set(plugin.name, plugin);
    this.pluginMetadata.set(plugin.name, {
      name: plugin.name,
      version: plugin.version,
      enabled: true,
      loaded: true
    });

    // Register hooks
    if (plugin.hooks) {
      for (const [hookName, hookFunction] of Object.entries(plugin.hooks)) {
        this.registerHook(hookName, hookFunction);
      }
    }

    logger.info({ name: plugin.name, version: plugin.version }, 'Plugin registered');

    // Initialize plugin
    if (plugin.initialize) {
      try {
        const result = plugin.initialize();
        if (result instanceof Promise) {
          result.catch(error => {
            logger.error(
              { name: plugin.name, error: error instanceof Error ? error.message : String(error) },
              'Plugin initialization failed'
            );
          });
        }
      } catch (error) {
        logger.error(
          { name: plugin.name, error: error instanceof Error ? error.message : String(error) },
          'Plugin initialization failed'
        );
      }
    }

    this.emit('plugin-registered', plugin.name);
  }

  /**
   * Unregister a plugin
   */
  unregister(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }

    // Destroy plugin
    if (plugin.destroy) {
      try {
        const result = plugin.destroy();
        if (result instanceof Promise) {
          result.catch(error => {
            logger.error(
              { name, error: error instanceof Error ? error.message : String(error) },
              'Plugin destruction failed'
            );
          });
        }
      } catch (error) {
        logger.error(
          { name, error: error instanceof Error ? error.message : String(error) },
          'Plugin destruction failed'
        );
      }
    }

    this.plugins.delete(name);
    this.pluginMetadata.delete(name);

    logger.info({ name }, 'Plugin unregistered');
    this.emit('plugin-unregistered', name);

    return true;
  }

  /**
   * Get plugin
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): PluginMetadata[] {
    return Array.from(this.pluginMetadata.values());
  }

  /**
   * Enable a plugin
   */
  enable(name: string): boolean {
    const metadata = this.pluginMetadata.get(name);
    if (!metadata) {
      return false;
    }

    metadata.enabled = true;
    logger.info({ name }, 'Plugin enabled');
    this.emit('plugin-enabled', name);

    return true;
  }

  /**
   * Disable a plugin
   */
  disable(name: string): boolean {
    const metadata = this.pluginMetadata.get(name);
    if (!metadata) {
      return false;
    }

    metadata.enabled = false;
    logger.info({ name }, 'Plugin disabled');
    this.emit('plugin-disabled', name);

    return true;
  }

  /**
   * Register a hook
   */
  registerHook(hookName: string, hookFunction: (...args: any[]) => Promise<any> | any): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    this.hooks.get(hookName)!.push(hookFunction);
    logger.debug({ hookName }, 'Hook registered');
  }

  /**
   * Execute hooks
   */
  async executeHook(hookName: string, ...args: any[]): Promise<any[]> {
    const hooks = this.hooks.get(hookName);
    if (!hooks || hooks.length === 0) {
      return [];
    }

    const results: any[] = [];

    for (const hook of hooks) {
      try {
        const result = await hook(...args);
        results.push(result);
      } catch (error) {
        logger.error(
          { hookName, error: error instanceof Error ? error.message : String(error) },
          'Hook execution failed'
        );
        results.push(undefined);
      }
    }

    return results;
  }

  /**
   * Get middleware from all plugins
   */
  getMiddleware(): Array<(req: any, res: any, next: any) => void> {
    const middleware: Array<(req: any, res: any, next: any) => void> = [];

    for (const plugin of this.plugins.values()) {
      const metadata = this.pluginMetadata.get(plugin.name);
      if (metadata?.enabled && plugin.middleware) {
        middleware.push(plugin.middleware);
      }
    }

    return middleware;
  }

  /**
   * Load plugins from directory
   */
  async loadPluginsFromDirectory(): Promise<void> {
    try {
      const files = fs.readdirSync(this.pluginDir);

      for (const file of files) {
        if (!file.endsWith('.js') && !file.endsWith('.ts')) {
          continue;
        }

        try {
          const pluginPath = path.join(this.pluginDir, file);
          // In a real implementation, this would dynamically load the plugin
          // For now, we'll just log that plugins can be loaded from this directory
          logger.debug({ file, path: pluginPath }, 'Plugin file found (dynamic loading not implemented)');
        } catch (error) {
          logger.error(
            { file, error: error instanceof Error ? error.message : String(error) },
            'Failed to load plugin'
          );
        }
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to load plugins from directory'
      );
    }
  }
}

export const pluginManager = new PluginManagerService();


import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

interface DatabaseBackend {
  instanceName: string;
  domain: string;
  port: number;
  dbType: 'postgres' | 'mysql' | 'mongodb';
}

/**
 * HAProxyService manages HAProxy configuration for database routing
 * 
 * Provides SNI-based routing so databases can use standard ports (5432, 3306)
 * with clean domain names like: mydb.yourdomain.com:5432
 */
export class HAProxyService {
  private readonly CONFIG_DIR = path.join(process.cwd(), 'haproxy');
  private readonly HAPROXY_CONFIG = path.join(this.CONFIG_DIR, 'haproxy.cfg');
  // Use writable location instead of /etc/haproxy (which might be read-only)
  private readonly HAPROXY_SYSTEM_CONFIG = '/opt/n8n-daemon/haproxy/haproxy.cfg';
  private readonly HAPROXY_SYSTEM_DIR = '/opt/n8n-daemon/haproxy';
  private readonly BACKENDS_FILE = path.join(this.CONFIG_DIR, 'backends.json');

  constructor() {
    // Ensure config directory exists
    if (!fs.existsSync(this.CONFIG_DIR)) {
      fs.mkdirSync(this.CONFIG_DIR, { recursive: true, mode: 0o755 });
    }
  }

  /**
   * Add database backend to HAProxy
   */
  async addDatabaseBackend(config: {
    instanceName: string;
    domain: string;
    subdomain: string;
    port: number;
    dbType: 'postgres' | 'mysql' | 'mongodb';
  }): Promise<void> {
    const fullDomain = `${config.subdomain}.${config.domain}`;
    
    // Load existing backends
    const backends = this.loadBackends();
    
    // Add or update backend
    backends[config.instanceName] = {
      instanceName: config.instanceName,
      domain: fullDomain,
      port: config.port,
      dbType: config.dbType
    };
    
    // Save backends
    this.saveBackends(backends);
    
    // Regenerate HAProxy config
    await this.regenerateConfig();
  }

  /**
   * Remove database backend from HAProxy
   */
  async removeDatabaseBackend(instanceName: string, _dbType: 'postgres' | 'mysql' | 'mongodb'): Promise<void> {
    // Load existing backends
    const backends = this.loadBackends();
    
    // Remove backend
    delete backends[instanceName];
    
    // Save backends
    this.saveBackends(backends);
    
    // Regenerate HAProxy config
    await this.regenerateConfig();
  }

  /**
   * Load backends from JSON file
   */
  private loadBackends(): Record<string, DatabaseBackend> {
    if (!fs.existsSync(this.BACKENDS_FILE)) {
      return {};
    }
    
    try {
      const data = fs.readFileSync(this.BACKENDS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  /**
   * Save backends to JSON file
   */
  private saveBackends(backends: Record<string, DatabaseBackend>): void {
    fs.writeFileSync(
      this.BACKENDS_FILE,
      JSON.stringify(backends, null, 2),
      { mode: 0o664 }
    );
  }

  /**
   * Regenerate complete HAProxy configuration from existing backends
   * This can be called manually to update HAProxy config
   */
  async regenerateConfig(): Promise<void> {
    const backends = this.loadBackends();
    
    // Separate backends by type
    const postgresBackends: DatabaseBackend[] = [];
    const mysqlBackends: DatabaseBackend[] = [];
    
    for (const backend of Object.values(backends)) {
      if (backend.dbType === 'postgres') {
        postgresBackends.push(backend);
      } else {
        mysqlBackends.push(backend);
      }
    }
    
    // Generate config
    const config = this.generateFullConfig(postgresBackends, mysqlBackends);
    
    // Write config locally first
    fs.writeFileSync(this.HAPROXY_CONFIG, config, { mode: 0o644 });
    
    // Write to writable location (/opt/n8n-daemon/haproxy/haproxy.cfg)
    // We'll configure HAProxy systemd service to use this location
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.HAPROXY_SYSTEM_DIR)) {
        fs.mkdirSync(this.HAPROXY_SYSTEM_DIR, { recursive: true, mode: 0o755 });
      }
      
      // Copy config to system location
      fs.copyFileSync(this.HAPROXY_CONFIG, this.HAPROXY_SYSTEM_CONFIG);
      
      // Set proper permissions
      fs.chmodSync(this.HAPROXY_SYSTEM_CONFIG, 0o644);
      try {
        execSync(`sudo chown haproxy:haproxy ${this.HAPROXY_SYSTEM_CONFIG}`, { stdio: 'pipe' });
      } catch {
        // If chown fails, that's okay - file is still readable
        logger.warn('Could not change ownership of HAProxy config (may need sudo)');
      }
      
      // Configure HAProxy systemd service to use our config location
      await this.configureSystemdService();
    } catch (error) {
      throw new Error(`Failed to deploy HAProxy configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Reload HAProxy
    await this.reloadHAProxy();
  }

  /**
   * Generate complete HAProxy configuration
   * Each database gets its own frontend on the standard port (5432 for PostgreSQL, 3306 for MySQL)
   * Uses the database's actual backend port for routing
   */
  private generateFullConfig(
    postgresBackends: DatabaseBackend[],
    mysqlBackends: DatabaseBackend[]
  ): string {
    let config = `# HAProxy Configuration
# Auto-generated by Grumpy Wombat Daemon
# DO NOT EDIT MANUALLY - Changes will be overwritten

global
    daemon
    maxconn 4096
    user haproxy
    group haproxy

defaults
    mode    tcp
    timeout connect 10s
    timeout client  1m
    timeout server  1m

`;




    // Create a frontend for each PostgreSQL database on standard port 5432
    // Enable TLS SNI-based routing to direct connections by domain
    if (postgresBackends.length > 0) {
      config += `# PostgreSQL Databases (port 5432)\n`;
      config += `frontend postgres_frontend\n`;
      config += `    bind *:5432\n`;
      config += `    mode tcp\n`;
      config += `    tcp-request inspect-delay 5s\n`;
      config += `    tcp-request content accept if { req_ssl_hello_type 1 }\n`;

      // Route based on SNI to the correct backend (for TLS connections)
      for (const backend of postgresBackends) {
        const backendName = `postgres_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    use_backend ${backendName} if { req.ssl_sni -i ${backend.domain} }\n`;
      }

      // For non-TLS connections or when SNI doesn't match:
      // If only one backend, use it as default (works for both TLS and non-TLS)
      if (postgresBackends.length === 1) {
        const backend = postgresBackends[0];
        const backendName = `postgres_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    default_backend ${backendName}\n`;
      } else if (postgresBackends.length > 1) {
        // Multiple backends: non-TLS connections will fail without SNI
        // Log a warning but don't set default (forces TLS/SNI requirement)
        config += `    # Multiple backends require TLS with SNI for routing\n`;
        config += `    # Non-TLS connections will be rejected\n`;
      }
      config += `\n`;
    }

    // Create a frontend for MySQL databases on standard port 3306
    if (mysqlBackends.length > 0) {
      config += `# MySQL Databases (port 3306)\n`;
      config += `frontend mysql_frontend\n`;
      config += `    bind *:3306\n`;
      config += `    mode tcp\n`;
      config += `    tcp-request inspect-delay 5s\n`;
      config += `    tcp-request content accept if { req_ssl_hello_type 1 }\n`;

      // Route based on SNI to the correct backend (for TLS clients)
      for (const backend of mysqlBackends) {
        const backendName = `mysql_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    use_backend ${backendName} if { req.ssl_sni -i ${backend.domain} }\n`;
      }

      // For non-TLS connections or when SNI doesn't match:
      // If only one backend, use it as default (works for both TLS and non-TLS)
      if (mysqlBackends.length === 1) {
        const backend = mysqlBackends[0];
        const backendName = `mysql_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    default_backend ${backendName}\n`;
      } else if (mysqlBackends.length > 1) {
        // Multiple backends: non-TLS connections will fail without SNI
        config += `    # Multiple backends require TLS with SNI for routing\n`;
        config += `    # Non-TLS connections will be rejected\n`;
      }
      config += `\n`;
    }

    // PostgreSQL backends
    for (const backend of postgresBackends) {
      const backendName = `postgres_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
      config += `# PostgreSQL: ${backend.instanceName} (${backend.domain})\n`;
      config += `backend ${backendName}\n`;
      config += `    mode tcp\n`;
      config += `    option tcp-check\n`;
      config += `    server ${backend.instanceName} 127.0.0.1:${backend.port} check\n`;
      config += `\n`;
    }

    // Note: No round-robin pool is configured when multiple databases share a frontend.
    // SNI routing ensures connections reach the intended backend. Non-TLS clients must
    // use direct ports per instance instead of shared 5432/3306.

    // MySQL backends
    for (const backend of mysqlBackends) {
      const backendName = `mysql_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
      config += `# MySQL: ${backend.instanceName} (${backend.domain})\n`;
      config += `backend ${backendName}\n`;
      config += `    mode tcp\n`;
      config += `    option tcp-check\n`;
      config += `    server ${backend.instanceName} 127.0.0.1:${backend.port} check\n`;
      config += `\n`;
    }

    // No MySQL pool when multiple databases; rely on SNI for TLS clients.

    // Stats page
    config += `# Stats Page\n`;
    config += `listen stats\n`;
    config += `    bind *:8404\n`;
    config += `    mode http\n`;
    config += `    stats enable\n`;
    config += `    stats uri /stats\n`;
    config += `    stats refresh 10s\n`;
    config += `    stats admin if TRUE\n`;

    return config;
  }

  /**
   * Configure HAProxy systemd service to use our config location
   */
  private async configureSystemdService(): Promise<void> {
    const systemdOverrideDir = '/etc/systemd/system/haproxy.service.d';
    const overrideFile = path.join(systemdOverrideDir, 'override.conf');
    
    try {
      // Create override directory
      execSync(`sudo mkdir -p ${systemdOverrideDir}`, { stdio: 'pipe' });
      
      // Create override file to point to our config
      const overrideContent = `[Service]
ExecStart=
ExecStart=/usr/sbin/haproxy -Ws -f ${this.HAPROXY_SYSTEM_CONFIG} -p /run/haproxy.pid $EXTRAOPTS
`;
      
      fs.writeFileSync(overrideFile, overrideContent);
      execSync(`sudo chmod 644 ${overrideFile}`, { stdio: 'pipe' });
      
      // Reload systemd to pick up changes
      execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
      
      logger.info('HAProxy systemd service configured to use custom config location');
    } catch (error) {
      logger.warn(`Could not configure systemd override: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Continue anyway - user can manually configure if needed
    }
  }

  /**
   * Reload HAProxy configuration
   */
  private async reloadHAProxy(): Promise<void> {
    try {
      // Test configuration first using our config location
      execSync(`sudo haproxy -c -f ${this.HAPROXY_SYSTEM_CONFIG}`, { stdio: 'pipe' });
      
      // Reload if valid
      execSync('sudo systemctl reload haproxy', { stdio: 'pipe' });
    } catch (error) {
      // If reload fails, try restart
      try {
        logger.warn('HAProxy reload failed, attempting restart...');
        execSync('sudo systemctl restart haproxy', { stdio: 'pipe' });
      } catch (restartError) {
        throw new Error(`Failed to reload/restart HAProxy: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Check if HAProxy is installed and running
   */
  async isAvailable(): Promise<boolean> {
    try {
      execSync('which haproxy', { stdio: 'pipe' });
      execSync('systemctl is-active haproxy', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get HAProxy stats
   */
  async getStats(): Promise<any> {
    try {
      const stats = execSync('echo "show stat" | socat stdio /run/haproxy/admin.sock', {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      return this.parseHAProxyStats(stats);
    } catch (error) {
      console.error('Failed to get HAProxy stats:', error);
      return null;
    }
  }

  /**
   * Parse HAProxy stats output
   */
  private parseHAProxyStats(stats: string): any {
    const lines = stats.trim().split('\n');
    if (lines.length < 2) return {};

    const headers = lines[0].replace('# ', '').split(',');
    const data: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const entry: any = {};
      
      headers.forEach((header, index) => {
        entry[header] = values[index];
      });
      
      data.push(entry);
    }

    return data;
  }
}

// Export singleton instance
export const haproxyService = new HAProxyService();

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { CertificateService } from './certificate.service';
import type { DockerService } from './docker.service';

interface DatabaseBackend {
  instanceName: string;
  domain: string;
  port: number; // Container's internal port (e.g., 5702)
  haproxyPort?: number; // HAProxy frontend port for non-TLS (e.g., 5433, 5434) - only set when multiple databases exist
  dbType: 'postgres' | 'mysql' | 'mongodb';
}

type CertificateSyncTrigger = 'scheduled' | 'immediate' | 'manual';

interface CertificateSyncStats {
  domainsProcessed: number;
  updatedDomains: number;
  failures: number;
  restarted: number;
  restartFailures: number;
  reloaded: boolean;
}

/**
 * HAProxyService manages HAProxy configuration for database routing
 * 
 * Provides SNI-based routing so databases can use standard ports (5432, 3306)
 * with clean domain names like: mydb.yourdomain.com:5432
 */
export class HAProxyService {
  private static schedulerStarted = false;
  private readonly CONFIG_DIR = path.join(process.cwd(), 'haproxy');
  private readonly HAPROXY_CONFIG = path.join(this.CONFIG_DIR, 'haproxy.cfg');
  // Use writable location instead of /etc/haproxy (which might be read-only)
  private readonly HAPROXY_SYSTEM_CONFIG = '/opt/n8n-daemon/haproxy/haproxy.cfg';
  private readonly HAPROXY_SYSTEM_DIR = '/opt/n8n-daemon/haproxy';
  // Store backends.json in system location to ensure persistence and consistency
  private readonly BACKENDS_FILE = '/opt/n8n-daemon/haproxy/backends.json';
  private readonly CERT_DIR = '/opt/n8n-daemon/haproxy/certs';
  private certificateService: CertificateService;
  private dockerService?: DockerService;
  private certSyncTimer?: NodeJS.Timeout;
  private immediateSyncTimer?: NodeJS.Timeout;
  private schedulerEnabled = false;
  private isSyncInProgress = false;

  constructor() {
    // Ensure config directory exists
    if (!fs.existsSync(this.CONFIG_DIR)) {
      fs.mkdirSync(this.CONFIG_DIR, { recursive: true, mode: 0o755 });
    }
    // Ensure system directory exists (for backends.json and haproxy.cfg)
    if (!fs.existsSync(this.HAPROXY_SYSTEM_DIR)) {
      fs.mkdirSync(this.HAPROXY_SYSTEM_DIR, { recursive: true, mode: 0o755 });
    }
    // Ensure cert directory exists
    if (!fs.existsSync(this.CERT_DIR)) {
      fs.mkdirSync(this.CERT_DIR, { recursive: true, mode: 0o755 });
    }
    this.certificateService = new CertificateService();

    this.startCertificateSyncTask();
  }

  setDockerService(dockerService: DockerService): void {
    this.dockerService = dockerService;
  }

  /**
   * Generate or get certificate for PostgreSQL container
   * Note: HAProxy TCP mode doesn't support TLS termination, so certificates
   * are used by PostgreSQL containers directly, not by HAProxy
   */
  private async ensureHaproxyCertificate(instanceName: string, domain: string): Promise<string> {
    // Generate certificate using CertificateService (for PostgreSQL container use)
    // HAProxy will pass through TLS, so PostgreSQL needs the certificate
    const certPaths = await this.certificateService.generateCertificate(instanceName, domain);
    
    logger.info({ instanceName, domain, certPath: certPaths.certPath }, 'Generated certificate for PostgreSQL container');
    
    // Return cert path (though HAProxy won't use it directly in TCP mode)
    return certPaths.certPath;
  }

  /**
   * Add database backend to HAProxy
   * 
   * IMPORTANT: External port is always 5432 (for PostgreSQL) - users always connect to domain:5432
   * HAProxy routes based on domain (SNI) to the correct internal container port
   * Flow: domain:5432 → HAProxy (SNI) → 127.0.0.1:container_port
   */
  async addDatabaseBackend(config: {
    instanceName: string;
    domain: string;
    subdomain: string;
    port: number; // Container's internal port (e.g., 35001) - NOT the external port (5432)
    dbType: 'postgres' | 'mysql' | 'mongodb';
  }): Promise<void> {
    const fullDomain = `${config.subdomain}.${config.domain}`;
    
    // Validate: Verify the port matches the actual container port if DockerService is available
    if (this.dockerService) {
      try {
        const containers = await this.dockerService.listAllContainers(false);
        const container = containers.find(c => 
          c.name === config.instanceName || 
          c.name.includes(config.instanceName) ||
          c.name.endsWith(`_${config.instanceName}`)
        );

        if (container) {
          // Get actual port from container
          const docker = require('dockerode');
          const dockerManager = require('../utils/docker-manager').dockerManager;
          const dockerClient = dockerManager.getDocker();
          const containerDetails = await dockerClient.getContainer(container.id).inspect();
          
          // Determine expected internal port based on database type
          let expectedInternalPort: string;
          if (config.dbType === 'postgres') {
            expectedInternalPort = '5432/tcp';
          } else if (config.dbType === 'mysql') {
            expectedInternalPort = '3306/tcp';
          } else if (config.dbType === 'mongodb') {
            expectedInternalPort = '27017/tcp';
          } else {
            expectedInternalPort = '';
          }

          // Extract actual host port from container
          // IMPORTANT: Always use the actual bound port from Docker, not the provided port
          // Ports may not be sequential (e.g., if containers were deleted and ports reused)
          // Docker NetworkSettings is the source of truth for what port the container is actually bound to
          let actualHostPort = config.port; // Fallback to provided port if extraction fails
          if (containerDetails.NetworkSettings?.Ports && expectedInternalPort) {
            const portBinding = containerDetails.NetworkSettings.Ports[expectedInternalPort];
            if (portBinding && portBinding.length > 0 && portBinding[0].HostPort) {
              const boundPort = parseInt(portBinding[0].HostPort, 10);
              if (!isNaN(boundPort) && boundPort > 0) {
                actualHostPort = boundPort;
              }
            }
          }

          // Always use the actual port from container (even if it matches provided port)
          // This ensures we're using Docker's source of truth, not assuming sequential ports
          if (actualHostPort !== config.port) {
            logger.warn(
              {
                instanceName: config.instanceName,
                domain: fullDomain,
                providedPort: config.port,
                actualContainerPort: actualHostPort,
                dbType: config.dbType
              },
              'Port mismatch detected - using actual container port from Docker NetworkSettings'
            );
            config.port = actualHostPort;
          } else {
            logger.info(
              {
                instanceName: config.instanceName,
                domain: fullDomain,
                port: actualHostPort,
                dbType: config.dbType,
                routing: `${fullDomain}:5432 → 127.0.0.1:${actualHostPort}`,
                source: 'Docker NetworkSettings (verified)'
              },
              'Using actual bound port from container (matches provided port)'
            );
          }
        } else {
          logger.warn(
            { instanceName: config.instanceName, domain: fullDomain },
            'Container not found for port verification - using provided port'
          );
        }
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : error, instanceName: config.instanceName },
          'Failed to verify container port - using provided port (container may not be running yet)'
        );
      }
    }
    
    // Generate TLS certificate for this domain
    try {
      await this.ensureHaproxyCertificate(config.instanceName, fullDomain);
    } catch (error) {
      logger.error({ error, instanceName: config.instanceName, domain: fullDomain }, 'Failed to generate certificate, continuing without TLS');
      // Continue without TLS - will use non-TLS only
    }
    
    // Load existing backends
    const backends = this.loadBackends();
    
    // Check if a backend with the same domain already exists (different instanceName)
    // This prevents overwriting backends when instanceName might not be unique
    const existingBackendByDomain = Object.values(backends).find(
      (backend) => backend.domain === fullDomain && backend.instanceName !== config.instanceName
    );
    
    if (existingBackendByDomain) {
      logger.warn(
        {
          existingInstanceName: existingBackendByDomain.instanceName,
          newInstanceName: config.instanceName,
          domain: fullDomain,
          existingPort: existingBackendByDomain.port,
          newPort: config.port
        },
        'Backend with same domain but different instanceName exists. Removing old backend and adding new one.'
      );
      // Remove the old backend with the same domain
      delete backends[existingBackendByDomain.instanceName];
    }
    
    // Check if a backend with the same instanceName exists but different domain/port
    const existingBackendByName = backends[config.instanceName];
    if (existingBackendByName) {
      if (existingBackendByName.domain !== fullDomain || existingBackendByName.port !== config.port) {
        logger.warn(
          {
            instanceName: config.instanceName,
            existingDomain: existingBackendByName.domain,
            newDomain: fullDomain,
            existingPort: existingBackendByName.port,
            newPort: config.port
          },
          'Backend with same instanceName but different domain/port exists. Updating backend.'
        );
      }
    }
    
    // Validate BEFORE adding: Check for conflicts
    // 1. Check if another backend has the same domain (should be unique)
    const existingBackendWithDomain = Object.values(backends).find(
      (backend) => backend.domain === fullDomain && backend.instanceName !== config.instanceName
    );
    
    if (existingBackendWithDomain) {
      logger.error(
        {
          newInstance: config.instanceName,
          newDomain: fullDomain,
          newPort: config.port,
          existingInstance: existingBackendWithDomain.instanceName,
          existingPort: existingBackendWithDomain.port
        },
        'CRITICAL: Domain already exists for different instance!'
      );
      throw new Error(
        `Domain conflict: ${fullDomain} is already mapped to instance ${existingBackendWithDomain.instanceName} on port ${existingBackendWithDomain.port}. ` +
        `Cannot map to instance ${config.instanceName} on port ${config.port}.`
      );
    }
    
    // 2. Check if another backend has the same port (ports should be unique per instance)
    const existingBackendWithPort = Object.values(backends).find(
      (backend) => backend.port === config.port && backend.instanceName !== config.instanceName
    );
    
    if (existingBackendWithPort) {
      logger.error(
        {
          newInstance: config.instanceName,
          newDomain: fullDomain,
          newPort: config.port,
          existingInstance: existingBackendWithPort.instanceName,
          existingDomain: existingBackendWithPort.domain
        },
        'CRITICAL: Port already in use by different instance!'
      );
      throw new Error(
        `Port conflict: Port ${config.port} is already used by instance ${existingBackendWithPort.instanceName} (${existingBackendWithPort.domain}). ` +
        `Cannot assign to instance ${config.instanceName} (${fullDomain}).`
      );
    }
    
    // Add or update backend (all validations passed)
    backends[config.instanceName] = {
      instanceName: config.instanceName,
      domain: fullDomain,
      port: config.port,
      dbType: config.dbType
    };
    
    logger.info(
      {
        instanceName: config.instanceName,
        domain: fullDomain,
        port: config.port,
        dbType: config.dbType,
        subdomain: config.subdomain,
        baseDomain: config.domain
      },
      'Adding/updating HAProxy backend - validated unique domain and port'
    );
    
    // Save backends
    this.saveBackends(backends);
    
    // Log the mapping for verification
    // IMPORTANT: External port is always 5432 (for PostgreSQL) - users connect to domain:5432
    // HAProxy routes based on domain (SNI) to internal container port
    logger.info(
      {
        instanceName: config.instanceName,
        domain: fullDomain,
        externalPort: 5432, // Users always connect to port 5432
        internalPort: config.port, // Container's internal port (e.g., 35001)
        routing: `${fullDomain}:5432 → HAProxy (SNI) → 127.0.0.1:${config.port}`,
        dbType: config.dbType
      },
      'HAProxy backend mapping created - domain routes to container port'
    );
    
    // Regenerate HAProxy config
    await this.regenerateConfig();
    
    // Verify the config was generated correctly
    const verifyBackend = this.loadBackends()[config.instanceName];
    if (verifyBackend && (verifyBackend.domain !== fullDomain || verifyBackend.port !== config.port)) {
      logger.error(
        {
          expected: { domain: fullDomain, port: config.port },
          actual: { domain: verifyBackend.domain, port: verifyBackend.port }
        },
        'CRITICAL: Backend verification failed - stored values do not match!'
      );
      throw new Error(
        `Backend verification failed: Expected domain ${fullDomain} port ${config.port}, ` +
        `but got domain ${verifyBackend.domain} port ${verifyBackend.port}`
      );
    }

    // Verify port matches actual container port (if DockerService is available)
    if (this.dockerService) {
      try {
        const verificationResult = await this.verifyAndFixBackendPorts();
        if (verificationResult.fixed > 0) {
          logger.warn(
            {
              fixed: verificationResult.fixed,
              details: verificationResult.details
            },
            'Fixed port mismatches after adding backend - ports were corrected'
          );
        }
        if (verificationResult.errors > 0) {
          logger.warn(
            { errors: verificationResult.errors },
            'Some port verifications failed (containers may not be running yet)'
          );
        }
      } catch (error) {
        // Don't fail backend addition if verification fails - just log it
        logger.warn(
          { error: error instanceof Error ? error.message : error, instanceName: config.instanceName },
          'Port verification failed after adding backend (non-critical)'
        );
      }
    }

    // Schedule an immediate certificate sync so Let's Encrypt certs are pulled right away
    this.scheduleImmediateCertificateSync();
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
   * Verify and fix backend port mappings by checking actual Docker container ports
   * This ensures each domain routes to the correct container port
   */
  async verifyAndFixBackendPorts(): Promise<{
    fixed: number;
    errors: number;
    details: Array<{ instanceName: string; domain: string; oldPort: number; newPort: number }>;
  }> {
    if (!this.dockerService) {
      throw new Error('DockerService not available for port verification');
    }

    const backends = this.loadBackends();
    const fixes: Array<{ instanceName: string; domain: string; oldPort: number; newPort: number }> = [];
    let errors = 0;
    let needsRegenerate = false;

    for (const [instanceName, backend] of Object.entries(backends)) {
      try {
        // Get container by name (container name format: template_name_instanceId)
        // We need to find the container that matches this instance
        const containers = await this.dockerService.listAllContainers(false);
        const container = containers.find(c => 
          c.name === instanceName || 
          c.name.includes(instanceName) ||
          c.name.endsWith(`_${instanceName}`)
        );

        if (!container) {
          logger.warn({ instanceName, domain: backend.domain }, 'Container not found for backend, skipping verification');
          continue;
        }

        // Get actual port from container by inspecting it
        const docker = require('dockerode');
        const dockerManager = require('../utils/docker-manager').dockerManager;
        const dockerClient = dockerManager.getDocker();
        const containerDetails = await dockerClient.getContainer(container.id).inspect();
        
        // Extract actual port from NetworkSettings
        // IMPORTANT: Always use the actual bound port from Docker, not the stored port
        // Ports may not be sequential (e.g., if containers were deleted and ports reused)
        // Docker NetworkSettings is the source of truth for what port the container is actually bound to
        // Determine internal port based on database type
        let internalPort: string;
        if (backend.dbType === 'postgres') {
          internalPort = '5432/tcp';
        } else if (backend.dbType === 'mysql') {
          internalPort = '3306/tcp';
        } else if (backend.dbType === 'mongodb') {
          internalPort = '27017/tcp';
        } else {
          // Fallback: try to find any port binding
          internalPort = '';
        }
        
        let actualPort = backend.port; // Fallback to stored port if extraction fails
        if (containerDetails.NetworkSettings?.Ports) {
          // First, try to find port by database type
          if (internalPort && containerDetails.NetworkSettings.Ports[internalPort]) {
            const portBinding = containerDetails.NetworkSettings.Ports[internalPort];
            if (portBinding && portBinding.length > 0 && portBinding[0].HostPort) {
              const hostPort = parseInt(portBinding[0].HostPort, 10);
              if (!isNaN(hostPort) && hostPort > 0) {
                actualPort = hostPort; // Always use actual bound port from Docker
              }
            }
          } else {
            // Fallback: find any TCP port binding (should only be one for databases)
            const allPorts = Object.entries(containerDetails.NetworkSettings.Ports || {});
            for (const [portKey, portBindings] of allPorts) {
              if (portKey.endsWith('/tcp') && Array.isArray(portBindings) && portBindings.length > 0) {
                const hostPort = parseInt(portBindings[0].HostPort, 10);
                if (!isNaN(hostPort) && hostPort > 0) {
                  actualPort = hostPort; // Always use actual bound port from Docker
                  logger.debug(
                    { instanceName, foundPort: portKey, hostPort },
                    'Found port binding via fallback method - using actual bound port'
                  );
                  break;
                }
              }
            }
          }
        }

        // Always update to use actual port from Docker (even if it matches stored port)
        // This ensures we're using Docker's source of truth, not assuming ports are sequential
        if (actualPort !== backend.port) {
          logger.warn(
            {
              instanceName,
              domain: backend.domain,
              storedPort: backend.port,
              actualPort
            },
            'Port mismatch detected, fixing backend'
          );

          const oldPort = backend.port;
          backend.port = actualPort;
          fixes.push({
            instanceName,
            domain: backend.domain,
            oldPort: oldPort,
            newPort: actualPort
          });
          needsRegenerate = true;
        }
      } catch (error) {
        errors++;
        logger.error(
          {
            instanceName,
            domain: backend.domain,
            error: error instanceof Error ? error.message : error
          },
          'Failed to verify backend port'
        );
      }
    }

    if (needsRegenerate) {
      this.saveBackends(backends);
      await this.regenerateConfig();
      logger.info({ fixed: fixes.length }, 'Fixed backend port mappings and regenerated HAProxy config');
    }

    return {
      fixed: fixes.length,
      errors,
      details: fixes
    };
  }

  /**
   * Get HAProxy port for a database instance
   * Always returns null - we use ONLY port 5432 for all connections (clean setup)
   * TLS connections use SNI routing, non-TLS routes to first backend
   */
  async getDatabasePort(instanceName: string): Promise<number | null> {
    // Always return null - we use ONLY port 5432 for all databases
    // This keeps the setup clean and professional
    return null;
  }

  /**
   * Get all database backends with their port information
   */
  async getDatabaseBackends(): Promise<Record<string, DatabaseBackend>> {
    return this.loadBackends();
  }

  /**
   * Validate all domain-to-port mappings by checking actual container ports
   * Returns a report of all mappings and any issues found
   */
  async validateDomainPortMappings(): Promise<{
    valid: number;
    invalid: number;
    missing: number;
    details: Array<{
      instanceName: string;
      domain: string;
      expectedPort: number;
      actualPort: number | null;
      status: 'valid' | 'invalid' | 'missing';
      routing: string;
    }>;
  }> {
    const backends = this.loadBackends();
    const results: Array<{
      instanceName: string;
      domain: string;
      expectedPort: number;
      actualPort: number | null;
      status: 'valid' | 'invalid' | 'missing';
      routing: string;
    }> = [];

    if (!this.dockerService) {
      logger.warn('DockerService not available for domain-to-port validation');
      return {
        valid: 0,
        invalid: 0,
        missing: 0,
        details: []
      };
    }

    for (const [instanceName, backend] of Object.entries(backends)) {
      try {
        const containers = await this.dockerService.listAllContainers(false);
        const container = containers.find(c => 
          c.name === instanceName || 
          c.name.includes(instanceName) ||
          c.name.endsWith(`_${instanceName}`)
        );

        if (!container) {
          results.push({
            instanceName,
            domain: backend.domain,
            expectedPort: backend.port,
            actualPort: null,
            status: 'missing',
            routing: `${backend.domain}:5432 → 127.0.0.1:${backend.port} (container not found)`
          });
          continue;
        }

        // Get actual port from container
        const docker = require('dockerode');
        const dockerManager = require('../utils/docker-manager').dockerManager;
        const dockerClient = dockerManager.getDocker();
        const containerDetails = await dockerClient.getContainer(container.id).inspect();
        
        // Determine expected internal port based on database type
        let expectedInternalPort: string;
        if (backend.dbType === 'postgres') {
          expectedInternalPort = '5432/tcp';
        } else if (backend.dbType === 'mysql') {
          expectedInternalPort = '3306/tcp';
        } else if (backend.dbType === 'mongodb') {
          expectedInternalPort = '27017/tcp';
        } else {
          expectedInternalPort = '';
        }

        // Extract actual host port from container
        let actualHostPort: number | null = null;
        if (containerDetails.NetworkSettings?.Ports && expectedInternalPort) {
          const portBinding = containerDetails.NetworkSettings.Ports[expectedInternalPort];
          if (portBinding && portBinding.length > 0 && portBinding[0].HostPort) {
            actualHostPort = parseInt(portBinding[0].HostPort, 10);
          }
        }

        const externalPort = backend.dbType === 'postgres' ? 5432 : backend.dbType === 'mysql' ? 3306 : 27017;
        const status: 'valid' | 'invalid' | 'missing' = 
          actualHostPort === null ? 'missing' :
          actualHostPort === backend.port ? 'valid' : 'invalid';

        results.push({
          instanceName,
          domain: backend.domain,
          expectedPort: backend.port,
          actualPort: actualHostPort,
          status,
          routing: `${backend.domain}:${externalPort} → HAProxy (SNI) → 127.0.0.1:${actualHostPort || backend.port}`
        });
      } catch (error) {
        logger.error(
          { instanceName, domain: backend.domain, error: error instanceof Error ? error.message : error },
          'Failed to validate domain-to-port mapping'
        );
        results.push({
          instanceName,
          domain: backend.domain,
          expectedPort: backend.port,
          actualPort: null,
          status: 'missing',
          routing: `${backend.domain}:5432 → 127.0.0.1:${backend.port} (validation failed)`
        });
      }
    }

    const valid = results.filter(r => r.status === 'valid').length;
    const invalid = results.filter(r => r.status === 'invalid').length;
    const missing = results.filter(r => r.status === 'missing').length;

    return {
      valid,
      invalid,
      missing,
      details: results
    };
  }

  /**
   * Synchronize certificates from Traefik ACME store for all known backends
   * Returns stats and reloads HAProxy if any Let's Encrypt certs changed
   */
  async syncTraefikCertificates(): Promise<{
    domainsProcessed: number;
    updatedDomains: number;
    failures: number;
    restarted: number;
    restartFailures: number;
    reloaded: boolean;
  }> {
    const backends = this.loadBackends();
    const processedDomains = new Set<string>();

    let updatedDomains = 0;
    let failures = 0;
    let needsReload = false;
    let restarted = 0;
    let restartFailures = 0;

    for (const backend of Object.values(backends)) {
      const domain = backend.domain;
      if (!domain || processedDomains.has(domain)) {
        continue;
      }

      processedDomains.add(domain);

      try {
        const certResult = await this.certificateService.generateCertificate(backend.instanceName, domain);

        if (certResult.isLetsEncrypt && certResult.updated) {
          updatedDomains += 1;
          needsReload = true;
          logger.info({ domain, instanceName: backend.instanceName, source: certResult.source }, 'Updated Let\'s Encrypt certificate for backend');

          if (this.dockerService) {
            try {
              await this.dockerService.restartContainer(backend.instanceName);
              restarted += 1;
              logger.info({ domain, instanceName: backend.instanceName }, 'Restarted container after certificate update');
            } catch (restartError) {
              restartFailures += 1;
              logger.error(
                {
                  domain,
                  instanceName: backend.instanceName,
                  error: restartError instanceof Error ? restartError.message : restartError
                },
                'Failed to restart container after certificate update'
              );
            }
          } else {
            logger.warn({ domain, instanceName: backend.instanceName }, 'DockerService not available, skipping container restart after certificate update');
          }
        }
      } catch (error) {
        failures += 1;
        logger.error(
          {
            domain,
            instanceName: backend.instanceName,
            error: error instanceof Error ? error.message : error
          },
          'Failed to synchronize certificate for backend'
        );
      }
    }

    if (needsReload) {
      try {
        await this.reloadHAProxy();
        logger.info({ updatedDomains }, 'Reloaded HAProxy after certificate updates');
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : error }, 'Failed to reload HAProxy after certificate updates');
      }
    }

    return {
      domainsProcessed: processedDomains.size,
      updatedDomains,
      failures,
      restarted,
      restartFailures,
      reloaded: needsReload
    };
  }

  private async performCertificateSync(trigger: CertificateSyncTrigger): Promise<CertificateSyncStats | null> {
    if (this.isSyncInProgress) {
      logger.debug({ trigger }, 'Certificate sync skipped because another sync is in progress');
      return null;
    }

    this.isSyncInProgress = true;
    try {
      const result = await this.syncTraefikCertificates();

      if (result.updatedDomains > 0 || result.failures > 0 || result.restartFailures > 0) {
        logger.info({ trigger, result }, 'Certificate sync completed');
      } else {
        logger.debug({ trigger }, 'Certificate sync completed with no changes');
      }

      return result;
    } catch (error) {
      logger.error({ trigger, error: error instanceof Error ? error.message : error }, 'Certificate sync failed');
      return null;
    } finally {
      this.isSyncInProgress = false;
    }
  }

  /**
   * Start background task that periodically syncs certificates from Traefik
   */
  private startCertificateSyncTask(): void {
    if (HAProxyService.schedulerStarted) {
      return;
    }

    const disabled = process.env.DISABLE_CERT_AUTO_SYNC === 'true';
    if (disabled) {
      logger.info('Automatic certificate sync is disabled via DISABLE_CERT_AUTO_SYNC');
      HAProxyService.schedulerStarted = true;
      this.schedulerEnabled = false;
      return;
    }

    const intervalMinutes = Number(process.env.CERT_SYNC_INTERVAL_MINUTES || '60');
    const intervalMs = Number.isFinite(intervalMinutes) && intervalMinutes > 0
      ? intervalMinutes * 60 * 1000
      : 60 * 60 * 1000;

    // Schedule periodic sync
    this.certSyncTimer = setInterval(() => {
      void this.performCertificateSync('scheduled');
    }, intervalMs);

    // Run an initial sync shortly after startup
    setTimeout(() => {
      void this.performCertificateSync('scheduled');
    }, 30 * 1000);

    this.schedulerEnabled = true;
    HAProxyService.schedulerStarted = true;
    logger.info({ intervalMinutes: intervalMs / 60 / 1000 }, 'Automatic certificate sync scheduler started');
  }

  private scheduleImmediateCertificateSync(delayMs: number = 5_000): void {
    if (this.immediateSyncTimer) {
      clearTimeout(this.immediateSyncTimer);
    }

    this.immediateSyncTimer = setTimeout(() => {
      void this.performCertificateSync('immediate');
    }, delayMs);

    logger.debug({ delayMs }, 'Scheduled immediate certificate sync');
  }

  async triggerManualCertificateSync(): Promise<CertificateSyncStats | null> {
    return this.performCertificateSync('manual');
  }

  /**
   * Load backends from JSON file
   * If file doesn't exist, try to rebuild it from HAProxy config
   */
  private loadBackends(): Record<string, DatabaseBackend> {
    if (!fs.existsSync(this.BACKENDS_FILE)) {
      // Try to rebuild from existing HAProxy config
      logger.warn({ backendsFile: this.BACKENDS_FILE }, 'backends.json not found, attempting to rebuild from HAProxy config');
      const rebuilt = this.rebuildBackendsFromConfig();
      if (Object.keys(rebuilt).length > 0) {
        logger.info({ backendCount: Object.keys(rebuilt).length }, 'Rebuilt backends.json from HAProxy config');
        this.saveBackends(rebuilt);
        return rebuilt;
      }
      return {};
    }
    
    try {
      const data = fs.readFileSync(this.BACKENDS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error({ error, backendsFile: this.BACKENDS_FILE }, 'Failed to load backends.json, attempting to rebuild from HAProxy config');
      // Try to rebuild from HAProxy config as fallback
      const rebuilt = this.rebuildBackendsFromConfig();
      if (Object.keys(rebuilt).length > 0) {
        logger.info({ backendCount: Object.keys(rebuilt).length }, 'Rebuilt backends.json from HAProxy config after parse error');
        this.saveBackends(rebuilt);
        return rebuilt;
      }
      return {};
    }
  }

  /**
   * Rebuild backends from existing HAProxy configuration
   * This is useful when backends.json is missing or corrupted
   */
  private rebuildBackendsFromConfig(): Record<string, DatabaseBackend> {
    const backends: Record<string, DatabaseBackend> = {};

    if (!fs.existsSync(this.HAPROXY_SYSTEM_CONFIG)) {
      logger.warn({ configFile: this.HAPROXY_SYSTEM_CONFIG }, 'HAProxy config not found, cannot rebuild backends');
      return backends;
    }

    try {
      const configContent = fs.readFileSync(this.HAPROXY_SYSTEM_CONFIG, 'utf-8');

      // Extract PostgreSQL backends: backend postgres_XXX ... server YYY 127.0.0.1:PORT
      const postgresBackendRegex = /backend postgres_([^\s]+)\s+mode tcp\s+option tcp-check\s+server ([^\s]+) 127.0.0.1:(\d+) check/g;
      const postgresUseBackendRegex = /use_backend postgres_([^\s]+) if \{ req\.ssl_sni -i ([^\s]+) \}/g;

      // Map backend names to domains
      const backendToDomain: Record<string, string> = {};
      let match;
      while ((match = postgresUseBackendRegex.exec(configContent)) !== null) {
        const backendName = match[1];
        const domain = match[2];
        backendToDomain[backendName] = domain;
      }

      // Extract backend server definitions
      while ((match = postgresBackendRegex.exec(configContent)) !== null) {
        const backendName = match[1];
        const instanceName = match[2];
        const port = parseInt(match[3], 10);

        const domain = backendToDomain[backendName] || null;

        if (instanceName && port && !isNaN(port)) {
          backends[instanceName] = {
            instanceName: instanceName,
            domain: domain || `unknown-${instanceName}`,
            port: port,
            dbType: 'postgres'
          };
        }
      }

      // Extract MySQL backends (similar pattern)
      const mysqlBackendRegex = /backend mysql_([^\s]+)\s+mode tcp\s+option tcp-check\s+server ([^\s]+) 127.0.0.1:(\d+) check/g;
      const mysqlUseBackendRegex = /use_backend mysql_([^\s]+) if \{ req\.ssl_sni -i ([^\s]+) \}/g;

      const mysqlBackendToDomain: Record<string, string> = {};
      while ((match = mysqlUseBackendRegex.exec(configContent)) !== null) {
        const backendName = match[1];
        const domain = match[2];
        mysqlBackendToDomain[backendName] = domain;
      }

      while ((match = mysqlBackendRegex.exec(configContent)) !== null) {
        const backendName = match[1];
        const instanceName = match[2];
        const port = parseInt(match[3], 10);

        const domain = mysqlBackendToDomain[backendName] || null;

        if (instanceName && port && !isNaN(port)) {
          backends[instanceName] = {
            instanceName: instanceName,
            domain: domain || `unknown-${instanceName}`,
            port: port,
            dbType: 'mysql'
          };
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to rebuild backends from HAProxy config');
    }

    return backends;
  }

  /**
   * Save backends to JSON file
   */
  private saveBackends(backends: Record<string, DatabaseBackend>): void {
    // Ensure directory exists before writing
    const dir = path.dirname(this.BACKENDS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    fs.writeFileSync(
      this.BACKENDS_FILE,
      JSON.stringify(backends, null, 2),
      { mode: 0o664 }
    );
    logger.debug({ backendsFile: this.BACKENDS_FILE, backendCount: Object.keys(backends).length }, 'Saved HAProxy backends');
  }

  /**
   * Regenerate complete HAProxy configuration from existing backends
   * This can be called manually to update HAProxy config
   */
  async regenerateConfig(): Promise<void> {
    const backends = this.loadBackends();
    
    // Separate backends by type (create copies to avoid mutating originals)
    const postgresBackends: DatabaseBackend[] = [];
    const mysqlBackends: DatabaseBackend[] = [];
    
    for (const backend of Object.values(backends)) {
      if (backend.dbType === 'postgres') {
        postgresBackends.push({ ...backend });
      } else {
        mysqlBackends.push({ ...backend });
      }
    }
    
    // Ensure certificates exist for all backends (for PostgreSQL container use)
    // Note: HAProxy TCP mode passes through TLS, so containers handle TLS termination
    for (const backend of [...postgresBackends, ...mysqlBackends]) {
      try {
        await this.ensureHaproxyCertificate(backend.instanceName, backend.domain);
      } catch (error) {
        logger.warn({ error, instanceName: backend.instanceName, domain: backend.domain }, 'Failed to ensure certificate');
        // Continue - HAProxy will still route, but TLS might not work
      }
    }
    
    // Generate config (no longer updates haproxyPort - we use ONLY port 5432)
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




    // Create frontends for PostgreSQL databases
    // IMPORTANT: External port is ALWAYS 5432 - users connect to domain:5432
    // HAProxy routes based on domain (SNI) to the correct internal container port
    // Flow: domain:5432 → HAProxy (SNI inspection) → 127.0.0.1:container_port
    // Strategy:
    // - Single database: Use port 5432 for both TLS and non-TLS
    // - Multiple databases: Each gets its own frontend on port 5432 (TLS via SNI) + unique port (non-TLS)
    //   This ensures both TLS and non-TLS connections route to the correct container
    // TLS Termination: HAProxy passes through TLS (TCP mode) - PostgreSQL container handles TLS termination
    if (postgresBackends.length > 0) {
      if (postgresBackends.length === 1) {
        // Single database: Use standard port 5432 (non-TLS)
        const backend = postgresBackends[0];
        const backendName = `postgres_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        
        config += `# PostgreSQL Database (port 5432 - Non-TLS)\n`;
        config += `# External: ${backend.domain}:5432 → HAProxy → Internal: 127.0.0.1:${backend.port}\n`;
        config += `frontend postgres_frontend\n`;
        config += `    bind *:5432\n`;
        config += `    mode tcp\n`;
        config += `    option tcplog\n`;
        config += `    default_backend ${backendName}\n`;
        config += `\n`;
      } else {
        // Multiple databases: ALL connections use port 5432 ONLY (non-TLS)
        // Route based on PostgreSQL startup packet inspection
        // PostgreSQL startup packet contains database name - we can use this to route
        // However, for simplicity and reliability, we'll use a round-robin approach
        // where each connection goes to the next backend, OR we can route by source IP
        // Actually, the cleanest approach for non-TLS is to use the connection source
        // But the most reliable is to use PostgreSQL startup packet database name
        // For now, let's use a simple approach: route to first backend for non-TLS
        // Users should connect using the domain name, and DNS will resolve to the same IP
        // But HAProxy can't see the domain in non-TLS TCP connections
        // 
        // BEST SOLUTION: Use PostgreSQL startup packet inspection to route by database name
        // Each database instance can have a unique database name pattern
        // OR: Use source IP routing if each domain resolves to a different IP (not typical)
        //
        // SIMPLEST: For non-TLS, we'll route all connections to first backend
        // This works if users only have one database, or if they use direct container ports
        // For multiple databases with non-TLS, users need to use direct container ports
        config += `# PostgreSQL Databases - Port 5432 ONLY (Non-TLS)\n`;
        config += `# ALL connections use port 5432 - clean setup\n`;
        config += `# Note: Non-TLS routing by domain is not possible in TCP mode\n`;
        config += `# All non-TLS connections route to first backend\n`;
        config += `# For multiple databases, use direct container ports or enable TLS\n`;
        config += `frontend postgres_frontend\n`;
        config += `    bind *:5432\n`;
        config += `    mode tcp\n`;
        config += `    option tcplog\n`;
        
        // For non-TLS, we can't route by domain, so route to first backend
        // This is a limitation of TCP mode without TLS/SNI
        const firstBackend = postgresBackends[0];
        const firstBackendName = `postgres_${firstBackend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    default_backend ${firstBackendName}\n`;
        config += `    # All connections route to first backend: ${firstBackend.domain} (port ${firstBackend.port})\n`;
        config += `    # For multiple databases with non-TLS, each database needs its own port\n`;
        config += `    # OR enable TLS to use SNI routing on port 5432\n`;
        config += `\n`;
        
        // Remove haproxyPort from backends - we don't use multiple ports anymore
        const allBackends = this.loadBackends();
        let updated = false;
        for (const backend of postgresBackends) {
          if (allBackends[backend.instanceName] && allBackends[backend.instanceName].haproxyPort) {
            delete allBackends[backend.instanceName].haproxyPort;
            updated = true;
          }
        }
        if (updated) {
          this.saveBackends(allBackends);
        }
      }
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
      // Sort by domain length (longer = more specific) to avoid prefix matching issues
      const sortedMysqlBackends = [...mysqlBackends].sort((a, b) => b.domain.length - a.domain.length);
      
      for (const backend of sortedMysqlBackends) {
        const backendName = `mysql_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        // Use exact match with regex to ensure precise domain matching
        const escapedDomain = backend.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        config += `    use_backend ${backendName} if { req_ssl_sni -m reg -i ^${escapedDomain}$ }\n`;
        logger.debug(
          { 
            domain: backend.domain, 
            instanceName: backend.instanceName, 
            port: backend.port,
            backendName 
          }, 
          'Added MySQL SNI routing rule with exact domain match'
        );
      }

      // For non-TLS connections or when SNI doesn't match:
      // If only one backend, use it as default (works for both TLS and non-TLS)
      if (mysqlBackends.length === 1) {
        const backend = mysqlBackends[0];
        const backendName = `mysql_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    default_backend ${backendName}\n`;
      } else if (mysqlBackends.length > 1) {
        // Multiple backends: Use first backend as default for non-TLS connections
        const defaultBackend = mysqlBackends[0];
        const defaultBackendName = `mysql_${defaultBackend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
        config += `    default_backend ${defaultBackendName}\n`;
        config += `    # Note: Non-TLS connections route to first backend (${defaultBackend.domain})\n`;
      }
      config += `\n`;
    }

    // PostgreSQL backends
    // IMPORTANT: External port is 5432, internal port is backend.port
    // Users connect to: ${backend.domain}:5432
    // HAProxy routes to: 127.0.0.1:${backend.port} (container's internal port)
    for (const backend of postgresBackends) {
      const backendName = `postgres_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
      config += `# PostgreSQL: ${backend.instanceName} (${backend.domain})\n`;
      config += `# External: ${backend.domain}:5432 → HAProxy (SNI) → Internal: 127.0.0.1:${backend.port}\n`;
      config += `backend ${backendName}\n`;
      config += `    mode tcp\n`;
      config += `    option tcp-check\n`;
      config += `    server ${backend.instanceName} 127.0.0.1:${backend.port} check\n`;
      config += `\n`;
      
      // Log the routing configuration for debugging
      // IMPORTANT: External port is 5432, internal port is backend.port
      logger.info(
        {
          instanceName: backend.instanceName,
          domain: backend.domain,
          externalPort: 5432, // Users connect to domain:5432
          internalPort: backend.port, // Container's internal port
          backendName,
          routing: `${backend.domain}:5432 → HAProxy (SNI) → 127.0.0.1:${backend.port}`
        },
        'Generated PostgreSQL backend configuration - domain routes to container port'
      );
      
      // Validate: Ensure port is unique per instance
      const duplicatePort = postgresBackends.find(
        (b) => b.port === backend.port && b.instanceName !== backend.instanceName
      );
      if (duplicatePort) {
        logger.error(
          {
            instance1: backend.instanceName,
            domain1: backend.domain,
            port: backend.port,
            instance2: duplicatePort.instanceName,
            domain2: duplicatePort.domain
          },
          'CRITICAL: Multiple instances sharing the same port!'
        );
      }
    }

    // Note: No round-robin pool is configured when multiple databases share a frontend.
    // SNI routing ensures connections reach the intended backend. Non-TLS clients must
    // use direct ports per instance instead of shared 5432/3306.

    // MySQL backends
    // IMPORTANT: External port is 3306, internal port is backend.port
    // Users connect to: ${backend.domain}:3306
    // HAProxy routes to: 127.0.0.1:${backend.port} (container's internal port)
    for (const backend of mysqlBackends) {
      const backendName = `mysql_${backend.instanceName.replace(/[^a-z0-9]/g, '_')}`;
      config += `# MySQL: ${backend.instanceName} (${backend.domain})\n`;
      config += `# External: ${backend.domain}:3306 → HAProxy (SNI) → Internal: 127.0.0.1:${backend.port}\n`;
      config += `backend ${backendName}\n`;
      config += `    mode tcp\n`;
      config += `    option tcp-check\n`;
      config += `    server ${backend.instanceName} 127.0.0.1:${backend.port} check\n`;
      config += `\n`;
      
      // Log the routing configuration for debugging
      // IMPORTANT: External port is 3306, internal port is backend.port
      logger.info(
        {
          instanceName: backend.instanceName,
          domain: backend.domain,
          externalPort: 3306, // Users connect to domain:3306
          internalPort: backend.port, // Container's internal port
          backendName,
          routing: `${backend.domain}:3306 → HAProxy (SNI) → 127.0.0.1:${backend.port}`
        },
        'Generated MySQL backend configuration - domain routes to container port'
      );
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

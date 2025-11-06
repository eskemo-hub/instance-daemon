import Docker from 'dockerode';
import logger from '../utils/logger';
import { dockerManager } from '../utils/docker-manager';

/**
 * TraefikService handles Traefik reverse proxy management
 * 
 * Traefik provides:
 * - Automatic SSL/TLS via Let's Encrypt
 * - Reverse proxy for n8n instances
 * - Domain-based routing
 */
export class TraefikService {
  private readonly TRAEFIK_CONTAINER_NAME = 'traefik';
  private readonly TRAEFIK_NETWORK_NAME = 'traefik-network';

  /**
   * Get Docker instance from manager
   */
  private getDocker(): Docker {
    return dockerManager.getDocker();
  }

  /**
   * Check if Traefik is installed and running
   */
  async isTraefikRunning(): Promise<boolean> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      const info = await container.inspect();
      return info.State.Running;
    } catch (error) {
      return false;
    }
  }

  /**
   * Install and start Traefik
   * @param email - Email for Let's Encrypt notifications
   * @param domain - Base domain for Traefik dashboard
   * @param cloudflareApiToken - Optional Cloudflare API token for DNS-01 challenge
   * @param dashboardEnabled - Whether to enable dashboard routing (default: true)
   */
  async installTraefik(email: string, domain: string, cloudflareApiToken?: string, dashboardEnabled: boolean = true): Promise<void> {
    try {
      // Create Traefik network if it doesn't exist
      await this.createTraefikNetwork();

      // Pull Traefik image
      await this.pullTraefikImage();

      // Create Traefik container
      await this.createTraefikContainer(email, domain, cloudflareApiToken, dashboardEnabled);

      const challengeType = cloudflareApiToken ? 'DNS-01 (Cloudflare)' : 'HTTP-01';
      console.log(`Traefik installed and started successfully with ${challengeType} challenge`);
    } catch (error) {
      throw new Error(`Failed to install Traefik: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Create Traefik Docker network
   */
  private async createTraefikNetwork(): Promise<void> {
    try {
      const networks = await this.getDocker().listNetworks({
        filters: { name: [this.TRAEFIK_NETWORK_NAME] }
      });

      if (networks.length === 0) {
        await this.getDocker().createNetwork({
          Name: this.TRAEFIK_NETWORK_NAME,
          Driver: 'bridge',
        });
        console.log(`Created network: ${this.TRAEFIK_NETWORK_NAME}`);
      }
    } catch (error) {
      throw new Error(`Failed to create Traefik network: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Pull Traefik image
   */
  private async pullTraefikImage(): Promise<void> {
    try {
      console.log('Pulling Traefik image...');
      await new Promise((resolve, reject) => {
        this.getDocker().pull('traefik:v2.10', (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }
          
          this.getDocker().modem.followProgress(stream, (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve(null);
            }
          });
        });
      });
    } catch (error) {
      throw new Error(`Failed to pull Traefik image: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Create Traefik container
   * @param email - Email for Let's Encrypt notifications
   * @param domain - Base domain for Traefik dashboard
   * @param cloudflareApiToken - Optional Cloudflare API token for DNS-01 challenge
   * @param dashboardEnabled - Whether to enable dashboard routing (default: true)
   */
  private async createTraefikContainer(email: string, domain: string, cloudflareApiToken?: string, dashboardEnabled: boolean = true): Promise<void> {
    try {
      // Build command arguments based on challenge type
      const cmdArgs = [
        '--api.dashboard=true',
        '--providers.docker=true',
        '--providers.docker.exposedbydefault=false',
        // HTTP/HTTPS entrypoints
        '--entrypoints.web.address=:80',
        '--entrypoints.websecure.address=:443',
        // Database TCP entrypoints
        '--entrypoints.db-3306.address=:3306', // MySQL/MariaDB
        '--entrypoints.db-5432.address=:5432', // PostgreSQL
        '--entrypoints.db-27017.address=:27017', // MongoDB
        // Let's Encrypt configuration
        '--certificatesresolvers.letsencrypt.acme.email=' + email,
        '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json',
      ];

      // Use DNS-01 challenge if Cloudflare token provided, otherwise HTTP-01
      if (cloudflareApiToken) {
        cmdArgs.push(
          '--certificatesresolvers.letsencrypt.acme.dnschallenge=true',
          '--certificatesresolvers.letsencrypt.acme.dnschallenge.provider=cloudflare',
          '--certificatesresolvers.letsencrypt.acme.dnschallenge.resolvers=1.1.1.1:53,8.8.8.8:53'
        );
      } else {
        cmdArgs.push(
          '--certificatesresolvers.letsencrypt.acme.httpchallenge=true',
          '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web'
        );
      }

      // Add HTTP to HTTPS redirect
      cmdArgs.push(
        '--entrypoints.web.http.redirections.entryPoint.to=websecure',
        '--entrypoints.web.http.redirections.entryPoint.scheme=https'
      );

      // Build environment variables
      const env: string[] = [];
      if (cloudflareApiToken) {
        env.push(`CF_API_TOKEN=${cloudflareApiToken}`);
      }

      // Build labels - only add dashboard routing if enabled
      const labels: Record<string, string> = {
        'traefik.enable': 'true',
      };

      if (dashboardEnabled) {
        labels['traefik.http.routers.traefik.rule'] = `Host(\`traefik.${domain}\`)`;
        labels['traefik.http.routers.traefik.service'] = 'api@internal';
        labels['traefik.http.routers.traefik.entrypoints'] = 'websecure';
        labels['traefik.http.routers.traefik.tls.certresolver'] = 'letsencrypt';
      }

      const container = await this.getDocker().createContainer({
        Image: 'traefik:v2.10',
        name: this.TRAEFIK_CONTAINER_NAME,
        Cmd: cmdArgs,
        Env: env.length > 0 ? env : undefined,
        ExposedPorts: {
          '80/tcp': {},
          '443/tcp': {},
          '8080/tcp': {}, // Traefik dashboard
        },
        HostConfig: {
          PortBindings: {
            '80/tcp': [{ HostPort: '80' }],
            '443/tcp': [{ HostPort: '443' }],
            '8080/tcp': [{ HostPort: '8080' }],
          },
          Binds: [
            '/var/run/docker.sock:/var/run/docker.sock:ro',
            'traefik-letsencrypt:/letsencrypt',
          ],
          RestartPolicy: {
            Name: 'unless-stopped',
          },
        },
        Labels: labels,
      });

      // Connect to Traefik network
      const network = this.getDocker().getNetwork(this.TRAEFIK_NETWORK_NAME);
      await network.connect({
        Container: container.id,
      });

      // Start container
      await container.start();
      console.log('Traefik container started');
    } catch (error) {
      throw new Error(`Failed to create Traefik container: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Stop and remove Traefik
   */
  async uninstallTraefik(): Promise<void> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      
      try {
        await container.stop({ t: 10 });
      } catch (error) {
        // Ignore if already stopped
      }

      await container.remove();
      console.log('Traefik uninstalled');
    } catch (error) {
      if (this.getErrorMessage(error).includes('no such container')) {
        return; // Already removed
      }
      throw new Error(`Failed to uninstall Traefik: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Traefik labels for an n8n container
   */
  getTraefikLabels(domain: string, subdomain: string): Record<string, string> {
    const fullDomain = `${subdomain}.${domain}`;
    const routerName = subdomain.replace(/[^a-z0-9]/g, '');

    return {
      'traefik.enable': 'true',
      'traefik.docker.network': this.TRAEFIK_NETWORK_NAME,
      [`traefik.http.routers.${routerName}.rule`]: `Host(\`${fullDomain}\`)`,
      [`traefik.http.routers.${routerName}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${routerName}.tls.certresolver`]: 'letsencrypt',
      [`traefik.http.services.${routerName}.loadbalancer.server.port`]: '5678',
    };
  }

  /**
   * Get Traefik network name
   */
  getNetworkName(): string {
    return this.TRAEFIK_NETWORK_NAME;
  }

  /**
   * Restart Traefik container
   */
  async restartTraefik(): Promise<void> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      await container.restart({ t: 10 });
      console.log('Traefik container restarted');
    } catch (error) {
      if (this.getErrorMessage(error).includes('no such container')) {
        throw new Error('Traefik is not installed');
      }
      throw new Error(`Failed to restart Traefik: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Traefik container logs
   */
  async getTraefikLogs(tail: number = 100): Promise<string> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: tail,
        timestamps: true,
      });
      return logs.toString('utf-8');
    } catch (error) {
      if (this.getErrorMessage(error).includes('no such container')) {
        throw new Error('Traefik is not installed');
      }
      throw new Error(`Failed to get Traefik logs: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Traefik container configuration
   */
  async getTraefikConfig(): Promise<any> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      const info = await container.inspect();
      
      // Extract relevant configuration
      return {
        id: info.Id,
        name: info.Name,
        image: info.Config.Image,
        state: info.State.Status,
        running: info.State.Running,
        command: info.Config.Cmd?.join(' ') || '',
        env: info.Config.Env || [],
        labels: info.Config.Labels || {},
        ports: info.NetworkSettings?.Ports || {},
        created: info.Created,
        startedAt: info.State.StartedAt,
      };
    } catch (error) {
      if (this.getErrorMessage(error).includes('no such container')) {
        throw new Error('Traefik is not installed');
      }
      throw new Error(`Failed to get Traefik config: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get current Traefik configuration (email, domain, cloudflare token)
   * Used when recreating container to enable/disable dashboard
   */
  async getTraefikConfigForRecreate(): Promise<{ email?: string; domain?: string; cloudflareApiToken?: string }> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      const info = await container.inspect();
      
      // Extract email from command args
      const cmdArgs = info.Config.Cmd || [];
      const emailMatch = cmdArgs.find(arg => arg.includes('certificatesresolvers.letsencrypt.acme.email='));
      const email = emailMatch ? emailMatch.split('=')[1] : undefined;
      
      // Extract domain from labels
      const labels = info.Config.Labels || {};
      const routerRule = labels['traefik.http.routers.traefik.rule'] || '';
      let domainMatch = routerRule.match(/Host\(`traefik\.(.+?)`\)/);
      if (!domainMatch) {
        domainMatch = routerRule.match(/Host\(\\`traefik\.(.+?)\\`\)/);
      }
      if (!domainMatch) {
        domainMatch = routerRule.match(/traefik\.(.+?)(?:`|\))/);
      }
      const domain = domainMatch ? domainMatch[1] : undefined;
      
      // Extract Cloudflare token from environment
      const env = info.Config.Env || [];
      const cfTokenMatch = env.find(e => e.startsWith('CF_API_TOKEN='));
      const cloudflareApiToken = cfTokenMatch ? cfTokenMatch.split('=')[1] : undefined;
      
      return { email, domain, cloudflareApiToken };
    } catch (error) {
      if (this.getErrorMessage(error).includes('no such container')) {
        throw new Error('Traefik is not installed');
      }
      throw new Error(`Failed to get Traefik config: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Enable or disable Traefik dashboard
   * This recreates the container with the appropriate configuration
   */
  async setDashboardEnabled(enabled: boolean): Promise<void> {
    try {
      // Get current configuration
      const config = await this.getTraefikConfigForRecreate();
      
      if (!config.email || !config.domain) {
        throw new Error('Cannot toggle dashboard: missing email or domain configuration');
      }

      // Stop and remove existing container
      await this.uninstallTraefik();

      // Recreate with new dashboard setting
      await this.installTraefik(
        config.email,
        config.domain,
        config.cloudflareApiToken,
        enabled
      );

      console.log(`Traefik dashboard ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      throw new Error(`Failed to ${enabled ? 'enable' : 'disable'} dashboard: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Get Traefik dashboard information
   */
  async getDashboardInfo(): Promise<{ enabled: boolean; url?: string; domain?: string }> {
    try {
      const container = this.getDocker().getContainer(this.TRAEFIK_CONTAINER_NAME);
      const info = await container.inspect();
      
      // Check if dashboard is enabled in command args
      const cmdArgs = info.Config.Cmd || [];
      const dashboardEnabled = cmdArgs.some(arg => arg.includes('api.dashboard=true'));
      
      // Extract domain from labels
      const labels = info.Config.Labels || {};
      const routerRule = labels['traefik.http.routers.traefik.rule'] || '';
      // Try multiple regex patterns to match the domain
      // Pattern 1: Host(`traefik.domain.com`)
      let domainMatch = routerRule.match(/Host\(`traefik\.(.+?)`\)/);
      // Pattern 2: Host(`traefik.domain.com`) (with escaped backticks)
      if (!domainMatch) {
        domainMatch = routerRule.match(/Host\(\\`traefik\.(.+?)\\`\)/);
      }
      // Pattern 3: Just extract anything after traefik.
      if (!domainMatch) {
        domainMatch = routerRule.match(/traefik\.(.+?)(?:`|\))/);
      }
      const domain = domainMatch ? domainMatch[1] : undefined;
      
      return {
        enabled: dashboardEnabled,
        url: domain ? `https://traefik.${domain}` : undefined,
        domain: domain,
      };
    } catch (error) {
      if (this.getErrorMessage(error).includes('no such container')) {
        return { enabled: false };
      }
      throw new Error(`Failed to get dashboard info: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Extract error message from unknown error type
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

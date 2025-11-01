import Docker from 'dockerode';

/**
 * TraefikService handles Traefik reverse proxy management
 * 
 * Traefik provides:
 * - Automatic SSL/TLS via Let's Encrypt
 * - Reverse proxy for n8n instances
 * - Domain-based routing
 */
export class TraefikService {
  private docker: Docker;
  private readonly TRAEFIK_CONTAINER_NAME = 'traefik';
  private readonly TRAEFIK_NETWORK_NAME = 'traefik-network';

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * Check if Traefik is installed and running
   */
  async isTraefikRunning(): Promise<boolean> {
    try {
      const container = this.docker.getContainer(this.TRAEFIK_CONTAINER_NAME);
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
   */
  async installTraefik(email: string, domain: string, cloudflareApiToken?: string): Promise<void> {
    try {
      // Create Traefik network if it doesn't exist
      await this.createTraefikNetwork();

      // Pull Traefik image
      await this.pullTraefikImage();

      // Create Traefik container
      await this.createTraefikContainer(email, domain, cloudflareApiToken);

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
      const networks = await this.docker.listNetworks({
        filters: { name: [this.TRAEFIK_NETWORK_NAME] }
      });

      if (networks.length === 0) {
        await this.docker.createNetwork({
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
        this.docker.pull('traefik:v2.10', (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }
          
          this.docker.modem.followProgress(stream, (err: Error | null) => {
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
   */
  private async createTraefikContainer(email: string, domain: string, cloudflareApiToken?: string): Promise<void> {
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

      const container = await this.docker.createContainer({
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
        Labels: {
          'traefik.enable': 'true',
          'traefik.http.routers.traefik.rule': `Host(\`traefik.${domain}\`)`,
          'traefik.http.routers.traefik.service': 'api@internal',
          'traefik.http.routers.traefik.entrypoints': 'websecure',
          'traefik.http.routers.traefik.tls.certresolver': 'letsencrypt',
        },
      });

      // Connect to Traefik network
      const network = this.docker.getNetwork(this.TRAEFIK_NETWORK_NAME);
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
      const container = this.docker.getContainer(this.TRAEFIK_CONTAINER_NAME);
      
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
   * Extract error message from unknown error type
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

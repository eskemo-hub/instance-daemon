import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

interface CertificateResult {
  certPath: string;
  keyPath: string;
  caPath: string;
  isLetsEncrypt: boolean;
  updated: boolean;
  source: 'traefik' | 'certbot' | 'self-signed';
}

/**
 * CertificateService handles TLS certificate generation for database instances
 * 
 * Supports both:
 * - Let's Encrypt certificates (via certbot) - preferred for production
 * - Self-signed certificates - fallback for development
 * 
 * Each database instance gets its own certificate for isolation.
 */
export class CertificateService {
  private readonly CERT_DIR = path.join(process.cwd(), 'certs');
  private readonly LETSENCRYPT_DIR = '/etc/letsencrypt';
  private readonly TRAEFIK_ACME_PATH = process.env.TRAEFIK_ACME_PATH || '/opt/traefik/acme.json';
  private readonly CERTBOT_EMAIL = process.env.CERTBOT_EMAIL || process.env.LETSENCRYPT_EMAIL;
  private readonly USE_LETSENCRYPT = process.env.USE_LETSENCRYPT === 'true' || !!this.CERTBOT_EMAIL;

  constructor() {
    // Ensure certificate directory exists
    if (!fs.existsSync(this.CERT_DIR)) {
      fs.mkdirSync(this.CERT_DIR, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Generate certificate for a database instance
   * Tries Let's Encrypt first if configured, falls back to self-signed
   * Returns paths to the generated certificate files
   */
  async generateCertificate(instanceName: string, domain?: string): Promise<CertificateResult> {
    // Try to reuse certificate from Traefik ACME store if available
    if (domain) {
      try {
        const traefikCert = await this.getTraefikCertificate(instanceName, domain);
        if (traefikCert) {
          logger.info({ domain, instanceName, updated: traefikCert.updated }, 'Using certificate from Traefik ACME store');
          return { ...traefikCert, isLetsEncrypt: true, source: 'traefik' };
        }
      } catch (error) {
        logger.warn(
          { error: this.getErrorMessage(error), domain, instanceName },
          'Failed to load certificate from Traefik ACME store'
        );
      }
    }

    // If domain is provided and Let's Encrypt is enabled, try to get Let's Encrypt cert via certbot
    if (domain && this.USE_LETSENCRYPT) {
      try {
        const letsEncryptCerts = await this.getLetsEncryptCertificate(domain);
        if (letsEncryptCerts) {
          logger.info({ domain, instanceName, updated: letsEncryptCerts.updated }, 'Using Let\'s Encrypt certificate obtained via certbot');
          return { ...letsEncryptCerts, isLetsEncrypt: true, source: 'certbot' };
        }
      } catch (error) {
        logger.warn(
          { error: this.getErrorMessage(error), domain, instanceName },
          'Failed to obtain Let\'s Encrypt certificate via certbot, falling back to self-signed'
        );
      }
    }

    // Fall back to self-signed certificate
    return this.generateSelfSignedCertificate(instanceName, domain);
  }

  /**
   * Attempt to copy certificate from Traefik's ACME store
   */
  private async getTraefikCertificate(instanceName: string, domain: string): Promise<CertificateResult | null> {
    if (!this.TRAEFIK_ACME_PATH || !fs.existsSync(this.TRAEFIK_ACME_PATH)) {
      return null;
    }

    try {
      const acmeContent = fs.readFileSync(this.TRAEFIK_ACME_PATH, 'utf-8');
      const acmeData = JSON.parse(acmeContent);

      const certificates = this.extractTraefikCertificates(acmeData);
      if (!certificates.length) {
        return null;
      }

      const targetDomain = domain.toLowerCase();

      for (const cert of certificates) {
        const domains = this.extractCertificateDomains(cert);
        if (!domains.length) {
          continue;
        }

        const matchesDomain = domains.some((d) => this.domainMatches(targetDomain, d));
        if (!matchesDomain) {
          continue;
        }

        if (!cert.certificate || !cert.key) {
          continue;
        }

        const certDir = path.join(this.CERT_DIR, instanceName);
        if (!fs.existsSync(certDir)) {
          fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
        }

        const certificateBuffer = Buffer.from(cert.certificate, 'base64');
        const keyBuffer = Buffer.from(cert.key, 'base64');

        const fullchainPath = path.join(certDir, 'fullchain.pem');
        const privkeyPath = path.join(certDir, 'privkey.pem');
        const chainPath = path.join(certDir, 'chain.pem');
        const serverCrtPath = path.join(certDir, 'server.crt');
        const serverKeyPath = path.join(certDir, 'server.key');

        const certUpdated = this.writeFileIfChanged(fullchainPath, certificateBuffer, 0o644);
        const serverCrtUpdated = this.writeFileIfChanged(serverCrtPath, certificateBuffer, 0o644);
        const chainUpdated = this.writeFileIfChanged(chainPath, certificateBuffer, 0o644);
        const keyUpdated = this.writeFileIfChanged(privkeyPath, keyBuffer, 0o600);
        const serverKeyUpdated = this.writeFileIfChanged(serverKeyPath, keyBuffer, 0o600);

        const updated = certUpdated || serverCrtUpdated || chainUpdated || keyUpdated || serverKeyUpdated;

        return {
          certPath: fullchainPath,
          keyPath: privkeyPath,
          caPath: chainPath,
          updated,
          isLetsEncrypt: true,
          source: 'traefik'
        };
      }

      return null;
    } catch (error) {
      logger.warn(
        { error: this.getErrorMessage(error), acmePath: this.TRAEFIK_ACME_PATH },
        'Failed to read certificate from Traefik ACME store'
      );
      return null;
    }
  }

  /**
   * Extract certificates array from Traefik ACME JSON (supports different formats)
   */
  private extractTraefikCertificates(acmeData: any): any[] {
    if (!acmeData || typeof acmeData !== 'object') {
      return [];
    }

    if (Array.isArray(acmeData.Certificates)) {
      return acmeData.Certificates;
    }

    if (acmeData.letsencrypt?.Certificates) {
      return acmeData.letsencrypt.Certificates;
    }

    const certs: any[] = [];
    for (const value of Object.values(acmeData)) {
      if (value && typeof value === 'object' && Array.isArray((value as any).Certificates)) {
        certs.push(...(value as any).Certificates);
      }
    }
    return certs;
  }

  /**
   * Extract domains from a Traefik certificate entry (supports various structures)
   */
  private extractCertificateDomains(cert: any): string[] {
    if (!cert) {
      return [];
    }

    const domains: string[] = [];
    const domainInfo = cert.domain || cert.domains || {};

    const main = domainInfo.main || domainInfo.Main;
    if (typeof main === 'string') {
      domains.push(main.toLowerCase());
    }

    const sans = domainInfo.sans || domainInfo.SANs || [];
    if (Array.isArray(sans)) {
      domains.push(...sans.map((s: string) => s.toLowerCase()));
    }

    return domains;
  }

  /**
   * Determine if target domain matches certificate domain (supports wildcards)
   */
  private domainMatches(targetDomain: string, certDomain: string): boolean {
    if (targetDomain === certDomain) {
      return true;
    }

    if (certDomain.startsWith('*.')) {
      const suffix = certDomain.slice(2);
      return targetDomain.endsWith(`.${suffix}`) || targetDomain === suffix;
    }

    return false;
  }

  /**
   * Get Let's Encrypt certificate for a domain using certbot
   */
  private async getLetsEncryptCertificate(domain: string): Promise<CertificateResult | null> {
    if (!this.CERTBOT_EMAIL) {
      logger.warn('CERTBOT_EMAIL not set, cannot use Let\'s Encrypt');
      return null;
    }

    // Check if certbot is installed
    try {
      execSync('which certbot', { stdio: 'pipe' });
    } catch (error) {
      logger.warn('certbot not found, install with: apt-get install certbot');
      return null;
    }

    // Let's Encrypt certificate paths
    const certPath = `${this.LETSENCRYPT_DIR}/live/${domain}/fullchain.pem`;
    const keyPath = `${this.LETSENCRYPT_DIR}/live/${domain}/privkey.pem`;
    const caPath = `${this.LETSENCRYPT_DIR}/live/${domain}/chain.pem`;

    // Check if certificate already exists
    let existed = fs.existsSync(certPath) && fs.existsSync(keyPath);

    if (existed) {
      logger.debug({ domain, certPath }, 'Let\'s Encrypt certificate already exists');
      return {
        certPath,
        keyPath,
        caPath: fs.existsSync(caPath) ? caPath : certPath,
        updated: false,
        isLetsEncrypt: true,
        source: 'certbot'
      };
    }

    // Obtain certificate using certbot
    // Use standalone mode on port 80 (requires port 80 to be available)
    // Or use DNS challenge if Cloudflare token is available
    try {
      logger.info({ domain, email: this.CERTBOT_EMAIL }, 'Obtaining Let\'s Encrypt certificate');
      
      // Try standalone mode first (requires port 80)
      execSync(
        `certbot certonly --standalone --non-interactive --agree-tos --email ${this.CERTBOT_EMAIL} -d ${domain}`,
        { stdio: 'pipe' }
      );

      // Verify certificate was created
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        logger.info({ domain, certPath }, 'Successfully obtained Let\'s Encrypt certificate');
        return {
          certPath,
          keyPath,
          caPath: fs.existsSync(caPath) ? caPath : certPath,
          updated: !existed,
          isLetsEncrypt: true,
          source: 'certbot'
        };
      }
    } catch (error) {
      logger.error(
        { error: this.getErrorMessage(error), domain },
        'Failed to obtain Let\'s Encrypt certificate'
      );
      return null;
    }

    return null;
  }

  /**
   * Generate self-signed certificate for a database instance
   */
  private generateSelfSignedCertificate(instanceName: string, domain?: string): CertificateResult {
    const certDir = path.join(this.CERT_DIR, instanceName);
    
    // Create instance-specific cert directory
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
    }

    const certPath = path.join(certDir, 'server.crt');
    const keyPath = path.join(certDir, 'server.key');
    const caPath = path.join(certDir, 'ca.crt');

    // Check if certificates already exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { certPath, keyPath, caPath: certPath, isLetsEncrypt: false, updated: false, source: 'self-signed' };
    }

    logger.info({ instanceName, domain }, 'Generating self-signed certificate');

    // Generate private key
    execSync(
      `openssl genrsa -out "${keyPath}" 2048`,
      { stdio: 'pipe' }
    );

    // Set proper permissions on private key (0640 = rw-r-----)
    // PostgreSQL requires u=rw,g=r (0640) or less if owned by root
    fs.chmodSync(keyPath, 0o640);
    
    // Ensure owned by root (needed for PostgreSQL to accept it)
    try {
      execSync(`chown root:root "${keyPath}"`, { stdio: 'pipe' });
    } catch (error) {
      // If we can't chown (not running as root), that's okay
      // The mount will handle ownership
    }

    // Generate self-signed certificate (valid for 10 years)
    const subj = domain 
      ? `/CN=${domain}/O=Grumpy Wombat/C=US`
      : `/CN=${instanceName}/O=Grumpy Wombat/C=US`;

    execSync(
      `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 3650 -subj "${subj}"`,
      { stdio: 'pipe' }
    );

    // Set proper permissions on certificate
    fs.chmodSync(certPath, 0o644);

    // For self-signed, CA is the same as the certificate
    fs.copyFileSync(certPath, caPath);

    return { certPath, keyPath, caPath, isLetsEncrypt: false, updated: true, source: 'self-signed' };
  }

  /**
   * Helper to get error message from error object
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Write file only if contents changed, set permissions when provided
   */
  private writeFileIfChanged(filePath: string, data: Buffer, mode?: number): boolean {
    let changed = true;
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath);
      if (existing.equals(data)) {
        changed = false;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, data);
    }

    if (mode !== undefined) {
      fs.chmodSync(filePath, mode);
    }

    return changed;
  }

  /**
   * Remove certificates for an instance
   */
  async removeCertificate(instanceName: string): Promise<void> {
    const certDir = path.join(this.CERT_DIR, instanceName);
    
    if (fs.existsSync(certDir)) {
      fs.rmSync(certDir, { recursive: true, force: true });
    }
  }

  /**
   * Get certificate info for an instance
   */
  getCertificatePaths(instanceName: string): {
    certPath: string;
    keyPath: string;
    caPath: string;
  } | null {
    const certDir = path.join(this.CERT_DIR, instanceName);
    const certPath = path.join(certDir, 'server.crt');
    const keyPath = path.join(certDir, 'server.key');
    const caPath = path.join(certDir, 'ca.crt');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { certPath, keyPath, caPath };
    }

    return null;
  }

  /**
   * Read CA certificate content (for client download)
   */
  getCACertificateContent(instanceName: string): string | null {
    const certPaths = this.getCertificatePaths(instanceName);
    
    if (!certPaths) {
      return null;
    }

    return fs.readFileSync(certPaths.caPath, 'utf-8');
  }

  /**
   * Renew Let's Encrypt certificate for a domain
   * Should be called periodically (e.g., via cron) to renew certificates
   */
  async renewLetsEncryptCertificate(domain: string): Promise<boolean> {
    if (!this.USE_LETSENCRYPT) {
      return false;
    }

    try {
      logger.info({ domain }, 'Renewing Let\'s Encrypt certificate');
      execSync(
        `certbot renew --cert-name ${domain} --non-interactive`,
        { stdio: 'pipe' }
      );
      logger.info({ domain }, 'Successfully renewed Let\'s Encrypt certificate');
      return true;
    } catch (error) {
      logger.error(
        { error: this.getErrorMessage(error), domain },
        'Failed to renew Let\'s Encrypt certificate'
      );
      return false;
    }
  }

  /**
   * Setup automatic renewal for Let's Encrypt certificates
   * Creates a systemd timer or cron job to renew certificates
   */
  async setupAutoRenewal(): Promise<void> {
    if (!this.USE_LETSENCRYPT) {
      return;
    }

    try {
      // Create renewal script
      const renewalScript = `#!/bin/bash
# Auto-renew Let's Encrypt certificates
certbot renew --quiet --post-hook "systemctl reload haproxy || true"
`;

      const scriptPath = '/opt/n8n-daemon/scripts/renew-certs.sh';
      const scriptDir = path.dirname(scriptPath);
      
      if (!fs.existsSync(scriptDir)) {
        fs.mkdirSync(scriptDir, { recursive: true, mode: 0o755 });
      }

      fs.writeFileSync(scriptPath, renewalScript, { mode: 0o755 });

      // Try to create systemd timer (requires root)
      try {
        const timerService = `[Unit]
Description=Renew Let's Encrypt certificates
After=network.target

[Service]
Type=oneshot
ExecStart=${scriptPath}
`;

        const timerFile = `[Unit]
Description=Renew Let's Encrypt certificates daily
Requires=cert-renewal.service

[Timer]
OnCalendar=daily
RandomizedDelaySec=3600

[Install]
WantedBy=timers.target
`;

        fs.writeFileSync('/etc/systemd/system/cert-renewal.service', timerService, { mode: 0o644 });
        fs.writeFileSync('/etc/systemd/system/cert-renewal.timer', timerFile, { mode: 0o644 });
        
        execSync('systemctl daemon-reload', { stdio: 'pipe' });
        execSync('systemctl enable cert-renewal.timer', { stdio: 'pipe' });
        execSync('systemctl start cert-renewal.timer', { stdio: 'pipe' });
        
        logger.info('Set up systemd timer for Let\'s Encrypt certificate renewal');
      } catch (error) {
        // Fall back to cron if systemd fails
        logger.warn('Could not set up systemd timer, using cron instead');
        const cronEntry = `0 3 * * * ${scriptPath}\n`;
        fs.appendFileSync('/etc/crontab', cronEntry);
        logger.info('Added cron job for Let\'s Encrypt certificate renewal');
      }
    } catch (error) {
      logger.error(
        { error: this.getErrorMessage(error) },
        'Failed to set up automatic certificate renewal'
      );
    }
  }
}

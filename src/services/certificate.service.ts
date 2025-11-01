import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CertificateService handles TLS certificate generation for database instances
 * 
 * Generates self-signed certificates for secure database connections.
 * Each database instance gets its own certificate for isolation.
 */
export class CertificateService {
  private readonly CERT_DIR = path.join(process.cwd(), 'certs');

  constructor() {
    // Ensure certificate directory exists
    if (!fs.existsSync(this.CERT_DIR)) {
      fs.mkdirSync(this.CERT_DIR, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Generate self-signed certificate for a database instance
   * Returns paths to the generated certificate files
   */
  async generateCertificate(instanceName: string, domain?: string): Promise<{
    certPath: string;
    keyPath: string;
    caPath: string;
  }> {
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
      return { certPath, keyPath, caPath: certPath }; // Self-signed, so CA is same as cert
    }

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

    return { certPath, keyPath, caPath };
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
}

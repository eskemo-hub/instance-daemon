import { execSync } from 'child_process';

/**
 * FirewallService manages UFW firewall rules for database instances
 * 
 * Ensures database backend ports are blocked by default and only
 * accessible through HAProxy when public access is enabled.
 */
export class FirewallService {
  /**
   * Block a port from external access
   * The port will only be accessible from localhost (127.0.0.1)
   */
  async blockPort(port: number): Promise<void> {
    try {
      // Check if UFW is installed and active
      if (!this.isUfwAvailable()) {
        console.log('UFW not available, skipping firewall rule');
        return;
      }

      // Delete any existing rules for this port
      try {
        execSync(`sudo ufw delete allow ${port}/tcp`, { stdio: 'pipe' });
      } catch {
        // Rule doesn't exist, that's fine
      }

      // Add deny rule for external access
      // This blocks the port from external IPs but allows localhost
      execSync(`sudo ufw deny from any to any port ${port} proto tcp`, { stdio: 'pipe' });
      
      console.log(`Blocked external access to port ${port}`);
    } catch (error) {
      console.error(`Failed to block port ${port}:`, error);
      // Don't throw - firewall rules are best-effort
    }
  }

  /**
   * Allow a port for external access
   */
  async allowPort(port: number): Promise<void> {
    try {
      if (!this.isUfwAvailable()) {
        console.log('UFW not available, skipping firewall rule');
        return;
      }

      // Delete any existing deny rules
      try {
        execSync(`sudo ufw delete deny from any to any port ${port} proto tcp`, { stdio: 'pipe' });
      } catch {
        // Rule doesn't exist, that's fine
      }

      // Allow the port
      execSync(`sudo ufw allow ${port}/tcp`, { stdio: 'pipe' });
      
      console.log(`Allowed external access to port ${port}`);
    } catch (error) {
      console.error(`Failed to allow port ${port}:`, error);
    }
  }

  /**
   * Remove all firewall rules for a port
   */
  async removePortRules(port: number): Promise<void> {
    try {
      if (!this.isUfwAvailable()) {
        return;
      }

      // Try to delete both allow and deny rules
      try {
        execSync(`sudo ufw delete allow ${port}/tcp`, { stdio: 'pipe' });
      } catch {
        // Ignore
      }

      try {
        execSync(`sudo ufw delete deny from any to any port ${port} proto tcp`, { stdio: 'pipe' });
      } catch {
        // Ignore
      }

      console.log(`Removed firewall rules for port ${port}`);
    } catch (error) {
      console.error(`Failed to remove rules for port ${port}:`, error);
    }
  }

  /**
   * Check if UFW is installed and active
   */
  private isUfwAvailable(): boolean {
    try {
      const status = execSync('sudo ufw status', { encoding: 'utf-8', stdio: 'pipe' });
      const isActive = status.includes('Status: active');
      
      // If UFW is installed but not active, enable it
      if (!isActive && status.includes('Status: inactive')) {
        console.log('UFW is installed but inactive, enabling...');
        this.enableUfw();
        return true;
      }
      
      return isActive;
    } catch {
      return false;
    }
  }

  /**
   * Enable UFW firewall
   */
  private enableUfw(): void {
    try {
      // Allow SSH first to prevent lockout
      execSync('sudo ufw allow 22/tcp', { stdio: 'pipe' });
      
      // Enable UFW (non-interactive)
      execSync('sudo ufw --force enable', { stdio: 'pipe' });
      
      console.log('UFW firewall enabled');
    } catch (error) {
      console.error('Failed to enable UFW:', error);
    }
  }

  /**
   * Ensure HAProxy ports are open (5432, 3306, 27017)
   */
  async ensureHAProxyPortsOpen(): Promise<void> {
    const haproxyPorts = [5432, 3306, 27017, 8404]; // PostgreSQL, MySQL, MongoDB, HAProxy stats
    
    for (const port of haproxyPorts) {
      try {
        await this.allowPort(port);
      } catch (error) {
        console.error(`Failed to open HAProxy port ${port}:`, error);
      }
    }
  }
}

import { databaseService } from './database.service';
import logger from '../utils/logger';

/**
 * API Key usage entry
 */
interface APIKeyUsage {
  timestamp: number;
  apiKey: string; // Hashed or masked
  operation: string;
  ipAddress: string;
  success: boolean;
  duration: number;
}

/**
 * API Key Tracker Service
 * Tracks API key usage for security monitoring
 */
export class APIKeyTrackerService {
  private usageHistory: APIKeyUsage[] = [];
  private maxHistorySize: number = 10000;

  /**
   * Track API key usage
   */
  trackUsage(
    apiKey: string,
    operation: string,
    ipAddress: string,
    success: boolean,
    duration: number
  ): void {
    // Mask API key for logging (show only first 8 chars)
    const maskedKey = this.maskAPIKey(apiKey);

    const usage: APIKeyUsage = {
      timestamp: Date.now(),
      apiKey: maskedKey,
      operation,
      ipAddress,
      success,
      duration
    };

    this.usageHistory.push(usage);

    // Limit history size
    if (this.usageHistory.length > this.maxHistorySize) {
      this.usageHistory.shift();
    }

    // Log suspicious activity
    if (!success) {
      logger.warn(
        {
          apiKey: maskedKey,
          operation,
          ipAddress,
          duration
        },
        'API key usage failure'
      );
    }

    // Store in database for long-term tracking
    this.storeUsage(usage);
  }

  /**
   * Mask API key for logging
   */
  private maskAPIKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '***';
    }
    return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
  }

  /**
   * Store usage in database
   */
  private storeUsage(usage: APIKeyUsage): void {
    try {
      // Could store in a separate table or extend audit_log
      // For now, we'll use the audit_log table with special operation prefix
      const db = databaseService.getDatabase();
      db.prepare(`
        INSERT INTO audit_log (
          timestamp, operation, ip_address, success, metadata
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        usage.timestamp,
        `API_KEY: ${usage.operation}`,
        usage.ipAddress,
        usage.success ? 1 : 0,
        JSON.stringify({
          apiKey: usage.apiKey,
          duration: usage.duration
        })
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to store API key usage'
      );
    }
  }

  /**
   * Get usage statistics for an API key
   */
  getUsageStats(apiKey: string, hours: number = 24): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageDuration: number;
    uniqueIPs: Set<string>;
  } {
    const maskedKey = this.maskAPIKey(apiKey);
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);

    const relevantUsage = this.usageHistory.filter(
      u => u.apiKey === maskedKey && u.timestamp >= cutoff
    );

    const successful = relevantUsage.filter(u => u.success);
    const failed = relevantUsage.filter(u => !u.success);
    const uniqueIPs = new Set(relevantUsage.map(u => u.ipAddress));
    const avgDuration = relevantUsage.length > 0
      ? relevantUsage.reduce((sum, u) => sum + u.duration, 0) / relevantUsage.length
      : 0;

    return {
      totalRequests: relevantUsage.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      averageDuration: avgDuration,
      uniqueIPs
    };
  }

  /**
   * Detect suspicious activity
   */
  detectSuspiciousActivity(apiKey: string, windowMinutes: number = 5): {
    isSuspicious: boolean;
    reasons: string[];
  } {
    const maskedKey = this.maskAPIKey(apiKey);
    const cutoff = Date.now() - (windowMinutes * 60 * 1000);

    const recentUsage = this.usageHistory.filter(
      u => u.apiKey === maskedKey && u.timestamp >= cutoff
    );

    const reasons: string[] = [];
    let isSuspicious = false;

    // Check for high failure rate
    const failures = recentUsage.filter(u => !u.success).length;
    const failureRate = recentUsage.length > 0 ? failures / recentUsage.length : 0;
    if (failureRate > 0.5 && recentUsage.length > 10) {
      isSuspicious = true;
      reasons.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
    }

    // Check for high request rate
    if (recentUsage.length > 100) {
      isSuspicious = true;
      reasons.push(`High request rate: ${recentUsage.length} requests in ${windowMinutes} minutes`);
    }

    // Check for multiple IPs
    const uniqueIPs = new Set(recentUsage.map(u => u.ipAddress));
    if (uniqueIPs.size > 5) {
      isSuspicious = true;
      reasons.push(`Multiple IPs: ${uniqueIPs.size} unique IPs`);
    }

    return { isSuspicious, reasons };
  }
}

export const apiKeyTracker = new APIKeyTrackerService();


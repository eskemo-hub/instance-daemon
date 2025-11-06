import http from 'http';
import https from 'https';
import logger from './logger';

/**
 * Connection pool statistics
 */
export interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  maxConnections: number;
  requestsPerSecond: number;
}

/**
 * Connection Pool Manager
 * Manages HTTP/HTTPS connection pooling and metrics
 */
export class ConnectionPoolManager {
  private httpAgent: http.Agent;
  private httpsAgent: https.Agent;
  private connectionStats: {
    total: number;
    active: number;
    requests: number;
    lastReset: number;
  } = {
    total: 0,
    active: 0,
    requests: 0,
    lastReset: Date.now()
  };

  constructor(options: {
    maxSockets?: number;
    maxFreeSockets?: number;
    keepAlive?: boolean;
    keepAliveMsecs?: number;
    timeout?: number;
  } = {}) {
    const {
      maxSockets = 50,
      maxFreeSockets = 10,
      keepAlive = true,
      keepAliveMsecs = 1000,
      timeout = 5000
    } = options;

    // HTTP agent with connection pooling
    this.httpAgent = new http.Agent({
      keepAlive,
      keepAliveMsecs,
      maxSockets,
      maxFreeSockets,
      timeout
    });

    // HTTPS agent with connection pooling
    this.httpsAgent = new https.Agent({
      keepAlive,
      keepAliveMsecs,
      maxSockets,
      maxFreeSockets,
      timeout
    });

    // Track connection statistics
    this.trackConnections();
  }

  /**
   * Get HTTP agent
   */
  getHttpAgent(): http.Agent {
    return this.httpAgent;
  }

  /**
   * Get HTTPS agent
   */
  getHttpsAgent(): https.Agent {
    return this.httpsAgent;
  }

  /**
   * Track connection statistics
   */
  private trackConnections(): void {
    setInterval(() => {
      const httpSockets = (this.httpAgent as any).sockets || {};
      const httpsSockets = (this.httpsAgent as any).sockets || {};
      const httpFree = (this.httpAgent as any).freeSockets || {};
      const httpsFree = (this.httpsAgent as any).freeSockets || {};

      let active = 0;
      let idle = 0;

      // Count active connections
      for (const key in httpSockets) {
        active += httpSockets[key].length;
      }
      for (const key in httpsSockets) {
        active += httpsSockets[key].length;
      }

      // Count idle connections
      for (const key in httpFree) {
        idle += httpFree[key].length;
      }
      for (const key in httpsFree) {
        idle += httpsFree[key].length;
      }

      this.connectionStats.active = active;
      this.connectionStats.total = active + idle;

      // Reset request counter every minute
      const now = Date.now();
      if (now - this.connectionStats.lastReset > 60000) {
        this.connectionStats.requests = 0;
        this.connectionStats.lastReset = now;
      }
    }, 5000); // Update every 5 seconds
  }

  /**
   * Record a request
   */
  recordRequest(): void {
    this.connectionStats.requests++;
  }

  /**
   * Get connection pool statistics
   */
  getStats(): ConnectionPoolStats {
    const now = Date.now();
    const elapsed = (now - this.connectionStats.lastReset) / 1000; // seconds
    const requestsPerSecond = elapsed > 0 ? this.connectionStats.requests / elapsed : 0;

    return {
      totalConnections: this.connectionStats.total,
      activeConnections: this.connectionStats.active,
      idleConnections: this.connectionStats.total - this.connectionStats.active,
      maxConnections: (this.httpAgent as any).maxSockets || 50,
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100
    };
  }

  /**
   * Destroy all connections
   */
  destroy(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    logger.info('Connection pools destroyed');
  }
}

export const connectionPoolManager = new ConnectionPoolManager({
  maxSockets: 50,
  maxFreeSockets: 10,
  keepAlive: true,
  keepAliveMsecs: 1000,
  timeout: 5000
});


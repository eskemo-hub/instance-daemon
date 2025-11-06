import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { databaseService } from '../services/database.service';

/**
 * Performance metrics
 */
interface PerformanceMetrics {
  method: string;
  path: string;
  duration: number;
  statusCode: number;
  timestamp: number;
}

/**
 * Performance monitoring middleware
 * Tracks request latency and detects slow queries
 */
export function performanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const slowQueryThreshold = parseInt(process.env.SLOW_QUERY_THRESHOLD || '5000', 10); // 5 seconds default

  // Store original end function
  const originalEnd = res.end.bind(res);

  // Override end to capture metrics
  res.end = function(chunk?: any, encoding?: any): Response {
    const duration = Date.now() - startTime;
    const metrics: PerformanceMetrics = {
      method: req.method,
      path: req.path,
      duration,
      statusCode: res.statusCode,
      timestamp: startTime
    };

    // Log slow queries
    if (duration > slowQueryThreshold) {
      logger.warn(
        {
          method: metrics.method,
          path: metrics.path,
          duration,
          statusCode: metrics.statusCode,
          threshold: slowQueryThreshold
        },
        'Slow query detected'
      );
    }

    // Store metrics
    storePerformanceMetrics(metrics);

    // Call original end
    return originalEnd(chunk, encoding);
  };

  next();
}

/**
 * Store performance metrics
 */
function storePerformanceMetrics(metrics: PerformanceMetrics): void {
  try {
    // Store in database for analysis
    const db = databaseService.getDatabase();
    db.prepare(`
      INSERT INTO audit_log (timestamp, operation, success, metadata)
      VALUES (?, ?, ?, ?)
    `).run(
      metrics.timestamp,
      `PERF: ${metrics.method} ${metrics.path}`,
      metrics.statusCode < 400 ? 1 : 0,
      JSON.stringify({
        duration: metrics.duration,
        statusCode: metrics.statusCode
      })
    );
  } catch (error) {
    // Don't fail request if metrics storage fails
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to store performance metrics'
    );
  }
}

/**
 * Get performance statistics
 */
export function getPerformanceStats(options: {
  path?: string;
  method?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
} = {}): {
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  requestCount: number;
  slowQueries: number;
} {
  try {
    const db = databaseService.getDatabase();
    let query = `
      SELECT metadata
      FROM audit_log
      WHERE operation LIKE 'PERF:%'
    `;
    const params: any[] = [];

    if (options.path) {
      query += ' AND operation LIKE ?';
      params.push(`%${options.path}%`);
    }

    if (options.method) {
      query += ' AND operation LIKE ?';
      params.push(`%${options.method}%`);
    }

    if (options.startTime) {
      query += ' AND timestamp >= ?';
      params.push(options.startTime);
    }

    if (options.endTime) {
      query += ' AND timestamp <= ?';
      params.push(options.endTime);
    }

    query += ' ORDER BY timestamp DESC';
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(query).all(...params) as any[];
    const durations: number[] = [];
    const slowQueryThreshold = parseInt(process.env.SLOW_QUERY_THRESHOLD || '5000', 10);
    let slowQueries = 0;

    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.metadata);
        if (metadata.duration) {
          durations.push(metadata.duration);
          if (metadata.duration > slowQueryThreshold) {
            slowQueries++;
          }
        }
      } catch (error) {
        // Skip invalid metadata
      }
    }

    if (durations.length === 0) {
      return {
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        requestCount: 0,
        slowQueries: 0
      };
    }

    const sum = durations.reduce((a, b) => a + b, 0);
    const average = sum / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);

    return {
      averageDuration: Math.round(average),
      minDuration: min,
      maxDuration: max,
      requestCount: durations.length,
      slowQueries
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to get performance statistics'
    );
    return {
      averageDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      requestCount: 0,
      slowQueries: 0
    };
  }
}


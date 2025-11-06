import { Request, Response, NextFunction } from 'express';
import { databaseService } from '../services/database.service';
import logger from '../utils/logger';

/**
 * Audit log entry
 */
interface AuditLogEntry {
  timestamp: number;
  operation: string;
  resourceType?: string;
  resourceId?: string;
  userId?: string;
  ipAddress: string;
  success: boolean;
  errorMessage?: string;
  metadata?: any;
}

/**
 * Audit middleware
 * Logs all API requests for security and compliance
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';

  // Store original end function
  const originalEnd = res.end.bind(res);

  // Override end to capture response
  res.end = function(chunk?: any, encoding?: any): Response {
    const duration = Date.now() - startTime;
    const success = res.statusCode >= 200 && res.statusCode < 400;

    // Extract resource info from path
    const pathParts = req.path.split('/').filter(Boolean);
    const resourceType = pathParts[1] || undefined; // e.g., 'containers', 'compose'
    const resourceId = pathParts[2] || undefined;

    const auditEntry: AuditLogEntry = {
      timestamp: startTime,
      operation: `${req.method} ${req.path}`,
      resourceType,
      resourceId,
      ipAddress,
      success,
      errorMessage: success ? undefined : `HTTP ${res.statusCode}`,
      metadata: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.headers['user-agent']
      }
    };

    // Log to database
    logAuditEntry(auditEntry);

    // Call original end
    return originalEnd(chunk, encoding);
  };

  next();
}

/**
 * Log audit entry to database
 */
function logAuditEntry(entry: AuditLogEntry): void {
  try {
    const db = databaseService.getDatabase();
    db.prepare(`
      INSERT INTO audit_log (
        timestamp, operation, resource_type, resource_id, ip_address,
        success, error_message, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp,
      entry.operation,
      entry.resourceType || null,
      entry.resourceId || null,
      entry.ipAddress,
      entry.success ? 1 : 0,
      entry.errorMessage || null,
      JSON.stringify(entry.metadata || {})
    );
  } catch (error) {
    // Fallback to logger if database fails
    logger.error(
      { error: error instanceof Error ? error.message : String(error), entry },
      'Failed to write audit log'
    );
  }
}

/**
 * Log security event
 */
export function logSecurityEvent(
  event: string,
  details: {
    resourceType?: string;
    resourceId?: string;
    ipAddress?: string;
    userId?: string;
    metadata?: any;
  }
): void {
  const entry: AuditLogEntry = {
    timestamp: Date.now(),
    operation: `SECURITY: ${event}`,
    resourceType: details.resourceType,
    resourceId: details.resourceId,
    userId: details.userId,
    ipAddress: details.ipAddress || 'unknown',
    success: false, // Security events are typically failures
    metadata: details.metadata
  };

  logAuditEntry(entry);
  logger.warn({ event, details }, 'Security event logged');
}

/**
 * Get audit logs
 */
export function getAuditLogs(options: {
  limit?: number;
  offset?: number;
  operation?: string;
  resourceType?: string;
  resourceId?: string;
  startTime?: number;
  endTime?: number;
} = {}): any[] {
  const db = databaseService.getDatabase();
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params: any[] = [];

  if (options.operation) {
    query += ' AND operation LIKE ?';
    params.push(`%${options.operation}%`);
  }

  if (options.resourceType) {
    query += ' AND resource_type = ?';
    params.push(options.resourceType);
  }

  if (options.resourceId) {
    query += ' AND resource_id = ?';
    params.push(options.resourceId);
  }

  if (options.startTime) {
    query += ' AND timestamp >= ?';
    params.push(options.startTime);
  }

  if (options.endTime) {
    query += ' AND timestamp <= ?';
    params.push(options.endTime);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    operation: row.operation,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    userId: row.user_id,
    ipAddress: row.ip_address,
    success: row.success === 1,
    errorMessage: row.error_message,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  }));
}


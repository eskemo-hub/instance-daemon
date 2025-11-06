import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pinoHttp from 'pino-http';
import { containerRoutes } from './routes/container.routes';
import { traefikRoutes } from './routes/traefik.routes';
import { healthRoutes } from './routes/health.routes';
import backupRoutes from './routes/backup.routes';
import statsRoutes from './routes/stats.routes';
import apiKeyRoutes from './routes/api-key.routes';
import logsRoutes from './routes/logs.routes';
import composeRoutes from './routes/compose.routes';
import updateRoutes from './routes/update.routes';
import certificateRoutes from './routes/certificates';
import { cleanupRoutes } from './routes/cleanup.routes';
import { batchRoutes } from './routes/batch.routes';
import { jobsRoutes } from './routes/jobs.routes';
import { configRoutes } from './routes/config.routes';
import { eventsRoutes } from './routes/events.routes';
import { statusRoutes } from './routes/status.routes';
import { metricsRoutes } from './routes/metrics.routes';
import { pluginsRoutes } from './routes/plugins.routes';
import { poolRoutes } from './routes/pool.routes';
import { authMiddleware } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { apiRateLimiter, strictRateLimiter, criticalRateLimiter } from './middleware/rate-limit.middleware';
import { auditMiddleware } from './middleware/audit.middleware';
import { performanceMiddleware } from './middleware/performance.middleware';
import { gracefulDegradationMiddleware } from './middleware/graceful-degradation.middleware';
import { validateEnvironmentOrThrow } from './utils/env-validation';
import logger from './utils/logger';
import { dockerManager } from './utils/docker-manager';
import { metricsExporter } from './services/metrics-exporter.service';

// Load environment variables
dotenv.config();

// Validate environment variables on startup
try {
  validateEnvironmentOrThrow();
} catch (error) {
  logger.fatal({ error: error instanceof Error ? error.message : 'Environment validation failed' }, 'Environment validation failed');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Structured HTTP request logging
app.use(pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500) {
      return 'error';
    } else if (err) {
      return 'error';
    }
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err?.message}`;
  }
}));

// Middleware
app.use(cors());
app.use(express.json());

// Apply audit logging to all routes
app.use(auditMiddleware);

// Apply performance monitoring to all routes
app.use(performanceMiddleware);

// Apply graceful degradation to all routes
app.use(gracefulDegradationMiddleware);

// Apply general rate limiting to all routes
app.use(apiRateLimiter);

// Public routes (no auth required)
app.use('/api/health', healthRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/metrics', metricsRoutes);

// Protected routes (auth required)
// Resource-intensive operations use strict rate limiting
app.use('/api/containers', authMiddleware, strictRateLimiter, containerRoutes);
app.use('/api/traefik', authMiddleware, traefikRoutes);
app.use('/api/backup', authMiddleware, strictRateLimiter, backupRoutes);
app.use('/api/stats', authMiddleware, statsRoutes);
app.use('/api/api-keys', authMiddleware, apiKeyRoutes);
app.use('/api/logs', authMiddleware, logsRoutes);
app.use('/api/compose', authMiddleware, strictRateLimiter, composeRoutes);
app.use('/api/update', authMiddleware, criticalRateLimiter, updateRoutes);
app.use('/api/certificates', authMiddleware, criticalRateLimiter, certificateRoutes);
app.use('/api/cleanup', authMiddleware, strictRateLimiter, cleanupRoutes);
app.use('/api/batch', authMiddleware, strictRateLimiter, batchRoutes);
app.use('/api/jobs', authMiddleware, jobsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/plugins', authMiddleware, pluginsRoutes);
app.use('/api/pool', authMiddleware, poolRoutes);

// Error handling middleware
app.use(errorHandler);

// Process-level error handlers to prevent crashes from unhandled errors
process.on('uncaughtException', (error: Error) => {
  logger.fatal({ 
    error: error.message, 
    stack: error.stack 
  }, 'Uncaught Exception');
  // Don't exit - let the process continue but log the error
  // The daemon should continue running to handle other requests
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.fatal({ 
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: String(promise)
  }, 'Unhandled Rejection');
  // Log but don't exit - the error handler middleware should handle it
});

// Handle DNS errors gracefully
process.on('error', (error: Error) => {
  if (error.message && error.message.includes('getaddrinfo')) {
    logger.warn({ error: error.message }, 'DNS lookup error');
    // Log but don't crash - this might be a transient network issue
  } else {
    logger.fatal({ 
      error: error.message, 
      stack: error.stack 
    }, 'Process error');
  }
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');
  
  // Test Docker connection before shutdown
  try {
    await dockerManager.testConnection();
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Docker connection test failed during shutdown');
  }
  
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
app.listen(PORT, async () => {
  logger.info({ 
    port: PORT, 
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid
  }, 'Daemon server started');
  
  // Test Docker connection on startup
  const dockerConnected = await dockerManager.testConnection();
  if (!dockerConnected) {
    logger.warn('Docker connection test failed on startup, but continuing');
  }

  // Start metrics exporter
  metricsExporter.start(30); // Collect metrics every 30 seconds
  logger.info('Metrics exporter started');
});

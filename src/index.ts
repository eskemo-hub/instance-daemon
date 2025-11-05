import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import { authMiddleware } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { validateEnvironmentOrThrow } from './utils/env-validation';

// Load environment variables
dotenv.config();

// Validate environment variables on startup
try {
  validateEnvironmentOrThrow();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Environment validation failed');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Public routes (no auth required)
app.use('/api/health', healthRoutes);

// Protected routes (auth required)
app.use('/api/containers', authMiddleware, containerRoutes);
app.use('/api/traefik', authMiddleware, traefikRoutes);
app.use('/api/backup', authMiddleware, backupRoutes);
app.use('/api/stats', authMiddleware, statsRoutes);
app.use('/api/api-keys', authMiddleware, apiKeyRoutes);
app.use('/api/logs', authMiddleware, logsRoutes);
app.use('/api/compose', authMiddleware, composeRoutes);
app.use('/api/update', authMiddleware, updateRoutes);
app.use('/api/certificates', authMiddleware, certificateRoutes);

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Daemon server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
